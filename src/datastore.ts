import bcrypt from 'bcryptjs';
import * as pg from 'pg';
import { FOREIGN_KEY_VIOLATION } from 'pg-error-constants';
import * as uuid from 'uuid';
import { FeatureCollection, Geometry } from 'geojson';
import { Survey as RestSurvey } from './routes/api';
import { database } from 'firebase';

export enum StudyScale {
    district,
    city,
    cityCentre,
    neighborhood,
    blockScale,
    singleSite
}

export type StudyType = 'activity' | 'movement';

export interface Study {
    studyId: string;
    title?: string;
    project?: string;
    projectPhase?: string;
    startDate?: Date;
    endDate?: Date;
    scale?: StudyScale;
    areas?: any,
    userId: string;
    type: 'activity' | 'movement';
    map?: FeatureCollection;
    protocolVersion: string;
    notes?: string;
}

export interface User {
    userId: string;
    email: string;
    name: string;
    password: string;
}

export interface Location {
    locationId: string;
    country?: string;
    city?: string;
    namePrimary: string;
    subdivision?: string;
    geometry: Geometry | FeatureCollection;
}

export interface Survey {
    studyId: string;
    locationId: string;
    surveyId: string;
    title?: string;
    startDate?: string,
    endDate?: string,
    timeCharacter?: string;
    representation: string;
    microclimate?: string;
    temperatureCelcius?: number;
    method: string;
    userEmail?: string;
    notes?: string;
}

export interface StudyAccess {
    userEmail: string;
    studyId: string;
}

const validDataPointProperties = new Set([
    'survey_id',
    'data_point_id',
    'gender',
    'age',
    'mode',
    'posture',
    'activities',
    'groups',
    'object',
    'location',
    'creation_date',
    'last_updated',
    'note'
]);

export type Gender = 'male' | 'female' | 'unknown';
export type Age = 'age_0-14' | 'age_15-24' | 'age_25-64' | 'age_65+';
export type Posture = 'standing' | 'sitting_formal' | 'sitting_informal' | 'lying' | 'multiple';
export type Activity = 'commercial' | 'consuming' | 'conversing' |  'cultural' | 'electronic_engagement' | 'recreation_active'| 'recreation_passive'| 'working_civic';
export type Group ='group_1' | 'group_2' | 'group_3-7' | 'group_8+';

export type GehlFields = 'gender' | 'age' | 'mode' | 'posture' | 'activities' | 'groups' | 'object' | 'location' | 'note' | 'creation_date' | 'last_updated';

function setString(s: any) {
    return Array.from(s).toString();
}

function flatMapper<T>(someMap: any, f: (key: string, index?: number) => T | undefined): T[] {
    return Object.keys(someMap).map(f).filter(x => x !== undefined);
}

export function javascriptArrayToPostgresArray(xs) {
    const arrayElements = xs.map(x => {
        if (x === null) {
            throw new Error(`Cannot convert ${JSON.stringify(xs)} into a postgres array because the array contrains the value null.`)
        }
        else if (typeof x === 'string') {
            return `${x}`;
        } else if (Array.isArray(x)) {
            return `${javascriptArrayToPostgresArray(x)}`
        } else if (typeof x === 'object') {
            return x.toString();
        } else {
            return x;
        }
    }).join(', ');
    return `{${arrayElements}}`;
}

function wrapInArray<T>(x: T | T[]) {
    if (Array.isArray(x)) {
        return x;
    } else {
        return [x];
    }
}

function digitToString(d: string) {
    switch (d) {
        case '0': return 'zero';
        case '1': return 'one';
        case '2': return 'two';
        case '3': return 'three';
        case '4': return 'four';
        case '5': return 'five';
        case '6': return 'six';
        case '7': return 'seven';
        case '8': return 'eight';
        case '9': return 'nine';
        default: return d;
    }
}

function replaceDigits(s: string) {
    const asArr = s.split('-');
    const lastTwelve = asArr[asArr.length - 1];
    return Array.from(lastTwelve).slice(1).reduce((acc, curr) => acc.concat(digitToString(curr)), digitToString(lastTwelve[0]));
}

function studyIdToTablename(studyId: string) {
    return 'data_collection.study_'.concat(studyId.replace(/-/g, ''));
}

const genderLocationArray: GehlFields[] = ['gender', 'location'];
const genderLocation: Set<GehlFields> = new Set(genderLocationArray);
// to do this is very brittle, how do you now mess up objects vs object?
// also how about the connection between the enums defined at database creation time?
const allGehlFieldsArray: GehlFields[] = ['gender', 'age', 'mode', 'posture', 'activities', 'groups', 'object', 'location', 'creation_date', 'last_updated', 'note'];
const allGehlFields: Set<GehlFields> = new Set(allGehlFieldsArray);
const allGehlFieldsStrings: Set<string> = allGehlFields;

function createNewTableFromGehlFields(study: Study, tablename: string, fields: GehlFields[]) {
    const asSet = new Set(fields);
    const comparisionString = setString(asSet);
    switch (comparisionString) {
        case setString(genderLocation):
            return `CREATE TABLE ${tablename} (
                    survey_id UUID references data_collection.survey(survey_id) NOT NULL,
                    data_point_id UUID PRIMARY KEY NOT NULL,
                    gender data_collection.gender,
                    creation_date timestamptz,
                    last_updated timestamptz,
                    location geometry NOT NULL
                    )`;
        case setString(allGehlFields):
            return `CREATE TABLE ${tablename} (
                    survey_id UUID references data_collection.survey(survey_id) NOT NULL,
                    data_point_id UUID PRIMARY KEY NOT NULL,
                    gender data_collection.gender,
                    age varchar(64),
                    mode data_collection.mode,
                    posture data_collection.posture,
                    activities data_collection.activities[],
                    groups data_collection.groups,
                    object data_collection.object,
                    location geometry NOT NULL,
                    creation_date timestamptz,
                    last_updated timestamptz,
                    note text
                    )`;
        default:
            console.error(new Set(fields));
            throw new Error(`no table possible for selected fields: ${fields}`);
    }
}

export async function returnStudiesForAdmin(pool: pg.Pool, userId: string) {
    // TODO union with studies that do not have a surveyors yet
    const query = `WITH
                        study_and_surveyors (study_id, emails)
                            AS (
                                SELECT
                                    s.study_id, array_agg(u.email)
                                FROM
                                    data_collection.surveyors AS s
                                    JOIN public.users AS u
                                    ON u.user_id = s.user_id
                                GROUP BY
                                    study_id
                            )
                    SELECT
                        stu.study_id,
                        stu.title,
                        stu.protocol_version,
                        stu.map,
                        stu.study_type,
                        sas.emails
                    FROM
                        data_collection.study AS stu
                        LEFT JOIN study_and_surveyors AS sas
                        ON stu.study_id = sas.study_id
                    WHERE
                        stu.user_id='${userId}'`;
    try {
        const { rows } = await pool.query(query);
        const studiesForUser = rows.map(({study_id, title, protocol_version, study_type: type, emails, map}) => {
            const surveyors = emails && emails.length > 0 ? emails : [];
            return {
                study_id,
                title,
                protocol_version,
                map,
                type,
                surveyors
            }
        });
        return studiesForUser;
    } catch (error) {
        console.error(`error executing sql query: ${query}`)
        throw error;
    }
}

export async function returnStudiesUserIsAssignedTo(pool: pg.Pool, userId: string) {
   const query = `SELECT stu.study_id, stu.title as study_title, stu.protocol_version, stu.study_type, stu.map, svy.survey_id, svy.title as survey_title, svy.time_start, svy.time_stop, ST_AsGeoJSON(loc.geometry)::json as survey_location
                 FROM data_collection.survey as svy
                 JOIN data_collection.study as stu
                 ON svy.study_id = stu.study_id
                 JOIN data_collection.location as loc
                 ON svy.location_id = loc.location_id
                 WHERE svy.user_id = '${userId}'`;
    try {
        const {rows}  = await pool.query(query);
        const studiesAndSurveys = rows.map((row) => {
            const {
                study_id,
                study_title,
                protocol_version,
                study_type,
                survey_id,
                survey_title,
                time_start: start_date,
                time_stop: end_date,
                survey_location,
                location_id } = row;
            return {
                study_id,
                study_title,
                protocol_version,
                study_type,
                survey_id,
                survey_title,
                start_date,
                end_date,
                location_id,
                survey_location
            }
        }).reduce((acc, curr) => {
            const {study_id, study_title, protocol_version, study_type: type, survey_id, start_date, end_date, survey_location, location_id } = curr;
            const survey = {
                survey_id,
                study_title,
                start_date,
                end_date,
                survey_location,
                location_id
            }
            if (acc[curr.study_id]) {
                acc[curr.study_id].surveys.push(survey);
            } else {
                acc[curr.study_id] = {
                    study_id,
                    type,
                    protocol_version,
                    title: study_title,
                    surveys: [survey]
                }
            }
            return acc;
        }, {} )
        return Object.values(studiesAndSurveys);
    } catch (error) {
        console.error(`[sql ${query}] ${error}`);
        throw error;
    }

}

export function surveysForStudy(pool: pg.Pool, studyId: string) {
    const query = `SELECT
                       s.time_start, s.time_stop, u.email, s.survey_id, s.title, s.representation, s.microclimate, s.temperature_c, s.method, s.user_id, s.notes
                   FROM
                       data_collection.survey AS s
                       JOIN public.users AS u ON s.user_id = u.user_id
                   WHERE
                       s.study_id = '${studyId}'`;
    try {
        return pool.query(query);
    } catch (error) {
        console.error(`error executing sql query: ${query}`)
        throw error;
    }
}


function executeQueryInSearchPath(searchPath: string[], query: string) {
    const searchPathQuery = `SET search_path TO ${searchPath.join(', ')}; `;
    return `${searchPathQuery} ${query} `;
}

// TODO an orm would be great for these .... or maybe interface magic? but an orm won't also express the relation between user and study right? we need normalized data for security reasons
// in other words the study already has the userId references, where should the idea of the study belonging to a user live? in the relationship model it's with a reference id
export async function createStudy(pool: pg.Pool, study: Study, fields: GehlFields[]) {
    // for some unknown reason import * as uuidv4 from 'uuid/v4'; uuidv4(); fails in gcp, saying that it's not a function call
    const studyTablename = studyIdToTablename(study.studyId);
    const newStudyDataTableQuery = createNewTableFromGehlFields(study, studyTablename, fields);
    const { studyId, title, userId, protocolVersion, type, map={} } = study;
    const newStudyMetadataQuery = `INSERT INTO data_collection.study(study_id, title, user_id, protocol_version, study_type, table_definition, tablename, map)
                                   VALUES('${studyId}', '${title}', '${userId}', '${protocolVersion}',  '${type}', '${JSON.stringify(fields)}', '${studyTablename}', '${JSON.stringify(map)}')`;
    // we want the foreign constraint to fail if we've already created a study with the specified ID
    let studyResult, newStudyDataTable;
    try {
        studyResult = await pool.query(newStudyMetadataQuery);
    } catch (error) {
        console.error(`for studyId: ${study.studyId}, ${error}, ${newStudyMetadataQuery}`);
        throw error;
    }
    try {
        newStudyDataTable = await pool.query(newStudyDataTableQuery);
    } catch (error) {
        console.error(`for studyId: ${study.studyId}, ${error}, ${newStudyDataTableQuery}`);
        throw error;
    }
    return [studyResult, newStudyDataTable];
}

export async function findUser(pool: pg.Pool, email: string, password: string) {
    const query = `SELECT * FROM users where email='${email}'`;
    const pgRes = await pool.query(query);
    if (pgRes.rowCount !== 1) {
        throw new Error(`User not found for email: ${email}`)
    }
    const user = pgRes.rows[0];
    return user;
}

export async function findUserById(pool: pg.Pool, userId: string) {
    const query = `SELECT * from users where user_id='${userId}'`
    const pgRes = await pool.query(query);
    if (pgRes.rowCount !== 1) {
        throw new Error(`User not found for user_id: ${userId}`)
    }
    const user = pgRes.rows[0];
    return user;
}

export async function createUser(pool: pg.Pool, user: User) {
    const hash = await bcrypt.hash(user.password, 14)
    const query = `INSERT INTO users(user_id, email, name, password)
                   VALUES('${user.userId}', '${user.email}', '${user.name}', '${hash}')`;
    return pool.query(query);
}

export async function authenticateOAuthUser(pool: pg.Pool, email: string) {
    const userId = uuid.v4();
    const query = `INSERT INTO users (user_id, email)
                   VALUES (
                       '${userId}',
                       '${email}'
                   ) ON CONFLICT (email)
                   DO UPDATE SET email=EXCLUDED.email RETURNING user_id`;
    try {
        const {rowCount, rows, command} = await pool.query(query);
        if (rowCount !== 1 && command !== 'INSERT') {
            throw new Error(`error OAuth authentication for email ${email}`);
        }
        return rows[0] as User;
    } catch (error) {
        console.error(error);
        console.error(`could not handle OAuth user for email: ${email}`);
        throw error;
    }
}

export async function createUserFromEmail(pool: pg.Pool, email: string) {
    const userId = uuid.v4();
    const query = `INSERT INTO users(user_id, email)
                   VALUES('${userId}', '${email}')`;
    try {
        await pool.query(query);
        return userId;
    } catch (error) {
        console.error(error);
        console.error(`could not add user with email: ${email}, with query: ${query}`);
        throw error;
    }
}

export async function createLocation(pool: pg.Pool, location: Location) {
    const { locationId, namePrimary, geometry, country='', city='', subdivision='' } = location;
    const query = `INSERT INTO data_collection.location
                   (location_id, country, city, name_primary, subdivision, geometry)
                   VALUES ('${locationId}', '${country}', '${city}', '${namePrimary}', '${subdivision}', ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'))`;
    try {
        return await pool.query(query);
    } catch (error) {
        console.error(error);
        console.error(`could not add location: ${JSON.stringify(location)} with query ${query}`);
    }
}

export async function giveUserStudyAccess(pool: pg.Pool, userEmail: string, studyId: string) {
    const query = `INSERT INTO data_collection.surveyors
                   (SELECT coalesce
                      ((SELECT pu.user_id FROM public.users pu WHERE pu.email = '${userEmail}'),
                      '00000000-0000-0000-0000-000000000000'),
                   '${studyId}')`
    try {
        const pgRes = await pool.query(query);
        return [pgRes, null];
    } catch (error) {
        if (error.code === FOREIGN_KEY_VIOLATION) {
            const newUserId = await createUserFromEmail(pool, userEmail);
            const pgRes2 = await pool.query(query);
            return [pgRes2, newUserId];
        }
        console.error(`postgres error: ${JSON.stringify(error)}`);
        throw error;
    }
}

function joinSurveyWithUserEmailCTE(survey: Survey) {
    const { studyId, surveyId, title, startDate, endDate, representation, method, userEmail, locationId } = survey;
    let query, values;
    if (locationId) {
        query = `WITH t (study_id, survey_id, title, time_start, time_stop, representation, method, user_email, location_id) AS (
              VALUES(
                     $1::UUID,
                     $2::UUID,
                     $3::TEXT,
                     $4::TIMESTAMP WITH TIME ZONE,
                     $5::TIMESTAMP WITH TIME ZONE,
                     $6::TEXT,
                     $7::TEXT,
                     $8::TEXT,
                     $9::UUID
              )
            )
            SELECT t.study_id, t.survey_id, t.title, t.time_start, t.time_stop, t.representation, t.method, u.user_id, t.location_id
            FROM  t
            JOIN public.users u
            ON t.user_email = u.email`;
        values =  [studyId, surveyId, title, startDate, endDate, representation, method, userEmail, locationId];
    } else {
        query = `WITH t (study_id, survey_id, title, time_start, time_stop, representation, method, user_email) AS (
              VALUES(
                     $1::UUID,
                     $2::UUID,
                     $3::TEXT,
                     $4::TIMESTAMP WITH TIME ZONE,
                     $5::TIMESTAMP WITH TIME ZONE,
                     $6::TEXT,
                     $7::TEXT,
                     $8::TEXT
              )
            )
            SELECT t.study_id, t.survey_id, t.title, t.time_start, t.time_stop, t.representation, t.method, u.user_id
            FROM  t
            JOIN public.users u
            ON t.user_email = u.email`;
        values =  [studyId, surveyId, title, startDate, endDate, representation, method, userEmail];
    }
    return { query, values };
}

export async function createNewSurveyForStudy(pool: pg.Pool, survey) {
    let { query, values } = joinSurveyWithUserEmailCTE(survey);
    if (survey.locationId ) {
        query = `INSERT INTO data_collection.survey (study_id, survey_id, title, time_start, time_stop, representation, method, user_id, location_id)
                   ${query};`
    } else {
        query = `INSERT INTO data_collection.survey (study_id, survey_id, title, time_start, time_stop, representation, method, user_id)
                   ${query};`
    }
    try {
        return pool.query(query, values);
    } catch (error) {
        console.error(`[sql ${query}] [values ${JSON.stringify(values)}] ${error}`)
        console.error(`postgres error: ${error} for query: ${query}`);
        throw error;
    }
}

const SURVEY_UPDATABLE_COLUMNS = ['title', 'location_id', 'time_start', 'time_stop', 'time_character', 'representation', 'microclimate', 'temperature_c', 'method', 'user_email'];
export function updateSurvey(pool: pg.Pool, survey: Survey) {
   const query = `WITH t (title, location_id, time_start, time_stop, user_email) as (
                      VALUES (
                             '${survey.title}'::text,
                             '${survey.locationId}'::UUID,
                             '${survey.startDate}'::timestamp with time zone,
                             '${survey.endDate}'::timestamp with time zone,
                             '${survey.userEmail}'::TEXT
                      )
                  )
                  UPDATE date_collection.survey
                  SET title = t.title,
                      location_id = t.location_id,
                      time_start = t.time_start,
                      time_stop = t.time_stop,
                      user_email = t.user_email`

    try {
        return pool.query(query);
    } catch (error) {
        console.error(`[query: ${query}] ${error}`)
        throw error;
    }
}

export async function getTablenameForSurveyId(pool: pg.Pool, surveyId: string) {
    const query = `SELECT tablename
                   FROM  data_collection.survey_to_tablename
                   WHERE survey_id = '${surveyId}'`;
    let pgRes;
    try {
        pgRes = await pool.query(query);
    } catch (error) {
        console.error(`postgres error: ${error} for query: ${query} `);
        throw error;
    }
    if (pgRes.rowCount === 1) {
        return pgRes.rows[0]['tablename'];
    } else {
        throw new Error(`no tablename found for surveyId: ${surveyId}, ${JSON.stringify(pgRes)}`);
    }
}

function convertKeyToParamterBinding(index, key, value) {
    if (key === 'location') {
        let binding;
        const location = value;
        if (location.type && location.type === 'Point') {
            binding = `ST_GeomFromGeoJSON($${index})`
            return { index: index + 1, binding };
        } else {
            binding = `ST_GeomFromText($${index}, $${index+1})`
            return { index: index + 2, binding };
        }
    } else {
        const binding = `$${index}`
        return {index: index + 1, binding };
    }
}

function processDataPointToPreparedStatement(acc: {columns: string[], values: string[], parameterBindings: string[], index: number}, curr: {key: string, value: string}) {
    const { key, value } = curr;
    const { columns, values, parameterBindings } = acc;
    columns.push(key);
    const { binding, index } = convertKeyToParamterBinding(acc.index, key, value);
    parameterBindings.push(binding)
    return {
        columns,
        values: [...values, ...wrapInArray(processDataPointToValue(key, value))],
        parameterBindings,
        index
    }
}

function processDataPointToValue(key, value): any[] | any {
    if (key === 'location') {
        const location = value;
        if (location.type && location.type === "Point") {
            //return `ST_GeomFromGeoJSON('${JSON.stringify(location)}')`;
            //return `ST_GeomFromGeoJSON('${JSON.stringify(location)}')`;
            return JSON.stringify(location);
        } else {
            const { longitude, latitude} = location
            return [longitude, latitude];
            //return `ST_GeomFromText('POINT(${longitude} ${latitude})', 4326)`;
        }
    } else if (key === 'groups') {
        switch (value) {
            case 'single':
                return 'group_1';
            case 'pair':
                return 'group_2';
            case 'group':
                return 'group_3-7';
            case 'crowd':
                return 'group_8+';
            default:
                throw new Error(`invalid value for groups: ${value}`)
        }
    } else if (key === 'age') {
        switch (value) {
            case 'child':
                return '0-14';
            case 'young':
                return '15-24';
            case 'adult':
                return '25-64';
            case 'elderly':
                return '65+';
            default:
                throw new Error(`invalid value for age: ${value}`)
        }
    } else if (key === 'activities') {
        const activities = value;
        const activitesAsArr = Array.isArray(activities) ? activities : [activities];
        return `${javascriptArrayToPostgresArray(activitesAsArr)}`;
    } else if (validDataPointProperties.has(key)) {
        // if (value === null || value === undefined) {
        //     return '';
        // }
        return `${value}`;
        //return value;
    } else {
        throw new Error(`Unexpected key ${key} in data point`);
    }
}


function processKeyAndValues(dataPoint) {
    const kvs = Object.entries(dataPoint).map(([key, value]) => { return { key, value } });
    return kvs.reduce(processDataPointToPreparedStatement, {
        columns: [],
        values: [],
        parameterBindings: [],
        index: 1
    });
}

function deleteNonGehlFields(o: any) {
    const unwantedKeys = Object.keys(o).filter(x => !allGehlFieldsStrings.has(x) || o[x] === null)
    unwantedKeys.forEach(k => delete o[k]);
    return o;
}

function transformToPostgresInsert(surveyId: string, dataPoint) {
    const { data_point_id } = dataPoint;
    const dataPointForPostgres = deleteNonGehlFields(dataPoint);
    dataPointForPostgres.survey_id = surveyId;
    dataPointForPostgres.data_point_id = data_point_id;
    const { columns, values, parameterBindings } = processKeyAndValues(dataPointForPostgres);
    const insert_statement = `(${(columns.join(', '))}) VALUES (${parameterBindings.join(', ')})`;
    const query = `${insert_statement}
            ON CONFLICT(data_point_id)
            DO UPDATE SET(${(columns.join(', '))}) = (${parameterBindings.join(', ')})`;
    return { query, values };
}

export async function checkUserIdIsSurveyor(pool: pg.Pool, userId: string, surveyId: string) {
    const query = `SELECT user_id, survey_id
                   FROM data_collection.survey
                   WHERE user_id = $1 and survey_id = $2`
    try {
        const values = [userId, surveyId];
        const { command, rowCount } = await pool.query(query, values);
        if (command !== 'SELECT' && rowCount !== 1) {
            return false
        }
        return true
    } catch (error) {
        console.error(`[sql ${query}] ${error}`);
        throw error;
    }
}

export async function addDataPointToSurveyNoStudyId(pool: pg.Pool, surveyId: string, dataPoint: any) {
    const tablename = await getTablenameForSurveyId(pool, surveyId);
    const dataPointWithSurveyId =  { ...dataPoint, survey_id: surveyId  };
    let { query, values } = transformToPostgresInsert(surveyId, dataPointWithSurveyId)
    query = `INSERT INTO ${tablename}
                   ${query}`;
    try {
        return pool.query(query, values);
    } catch (error) {
        console.error(`[sql ${query}] ${error}`)
        throw error;
    }
}

export async function addDataPointToSurveyWithStudyId(pool: pg.Pool, studyId: string, surveyId: string, dataPoint: any) {
    const tablename = await studyIdToTablename(studyId);
    const dataPointWithSurveyId =  { ...dataPoint, survey_id: surveyId };
    let { query, values } = transformToPostgresInsert(surveyId, dataPointWithSurveyId);
    query = `INSERT INTO ${tablename}
                   ${query}`;
    try {
        return pool.query(query, values);
    } catch (error) {
        console.error(`error executing sql query: ${query}`)
        throw error;
    }
}

export async function retrieveDataPointsForSurvey(pool, surveyId) {
    const tablename = await getTablenameForSurveyId(pool, surveyId);
    const query = `SELECT data_point_id, gender, age, mode, posture, activities, groups, object, ST_AsGeoJSON(location)::json as loc, note
                   FROM ${tablename}`
    try {
        const res = await pool.query(query);
        return res.rows.map(r => {
            const { loc: location } = r;
            delete r['loc'];
            return {
                ...r,
                location
            };
        });;
    } catch (error) {
        console.error(`[sql ${query}] ${error}`)
        throw error;
    }
}

export async function deleteDataPoint(pool: pg.Pool, surveyId: string, dataPointId: any) {
    const tablename = await getTablenameForSurveyId(pool, surveyId);
    const query = `DELETE FROM ${tablename}
                   WHERE data_point_id = '${dataPointId}'`;
    try {
        const res = await pool.query(query);
        const { rowCount } = res;
        if (rowCount !== 1) {
            throw new Error(`[query ${query}] No data point found to delete for data_point_id: ${dataPointId}`)
        }
        return res;
    } catch (error) {
        console.error(`[ query ${query}] ${error}`)
        throw error;
    }
}
