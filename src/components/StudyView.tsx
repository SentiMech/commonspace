import React, { Fragment } from 'react';
import { toJS } from 'mobx';
import { observer } from 'mobx-react';
import { withStyles, WithStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import Checkbox from '@material-ui/core/Checkbox';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import EditIcon from '@material-ui/icons/Edit';
import IconButton from '@material-ui/core/IconButton';
import InputAdornment from '@material-ui/core/InputAdornment';
import MenuItem from '@material-ui/core/MenuItem';
import TextField from '@material-ui/core/TextField';
import Typography from '@material-ui/core/Typography';

import LockedMapView from './LockedMapView';

import uiState, { closeModalIfVisible } from '../stores/ui';
import applicationState, {
    downloadDataAsCsv,
    saveNewStudy,
    updateStudy,
    Study,
    getMapCenterForStudy
} from '../stores/applicationState';
import { groupArrayOfObjectsBy } from '../utils';

const styles = theme => ({
    container: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1
    },
    header: {
        borderBottom: `1px solid ${theme.palette.divider}`,
        padding: theme.spacing.unit * 3,
        marginBottom: theme.spacing.unit * 2
    },
    footer: {
        borderTop: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        marginTop: theme.spacing.unit * 2,
        padding: theme.spacing.unit * 3,
        justifyContent: 'flex-end'
    },
    columns: {
        display: 'flex',
        paddingTop: theme.spacing.unit
    },
    column: {
        flex: '1 1 0',
        display: 'flex',
        flexDirection: 'column',
        marginLeft: theme.spacing.unit * 3,
        marginRight: theme.spacing.unit * 3
    },
    map: {
        width: '300px',
        height: '300px'
    },
    mapContainer: {
        marginTop: theme.spacing.unit * 2,
        flex: 1,
        display: 'flex'
    },
    undisabled: {
        // this component is disabled to prevent text input interaction and UI feedback
        // override some of the styles so it looks like an enabled text field
        color: theme.palette.text.primary,
        cursor: 'pointer',
        '&:before': {
            // The dashed underline in the disabled state has a lot of specificity
            // In this one case !important seems justifiable
            borderBottomStyle: 'solid !important'
        }
    },
    undisabledLabel: {
        // this component is disabled to prevent text input interaction and UI feedback
        // override some of the styles so it looks like an enabled text field
        color: `${theme.palette.text.secondary} !important`
    },
    countRow: {
        flex: 1,
        paddingTop: theme.spacing.unit * 2,
        paddingBottom: theme.spacing.unit * 2,
        paddingLeft: theme.spacing.unit * 3,
        backgroundColor: '#F2F2F2',
        borderBottom: `1px solid ${theme.palette.divider}`
    },
    footerButton: {
        marginRight: theme.spacing.unit
    }
});

async function update(study) {
    await updateStudy(study);
    closeModalIfVisible('study');
}

async function create(study) {
    await saveNewStudy(study);
    uiState.currentStudyIsNew = false;
    closeModalIfVisible('study');
}

interface CreateOrUpdateButtonProps {
    study: Study;
    studyIsNew: boolean;
}

// @ts-ignore
const CreateOrUpdateButton = withStyles(styles)((props: CreateOrUpdateButtonProps & WithStyles) => {
    const { studyIsNew, study } = props;
    // Prevent users from creating incomplete studies, since sometimes that causes weird things to happen
    // TODO: add real validation
    const {
        title,
        description,
        author,
        authorUrl,
        fields,
        surveyors,
        surveys,
        map,
        isPublic
    } = study;
    const disabled =
        !title ||
        !description ||
        !author ||
        !authorUrl ||
        !fields.length ||
        !surveyors.length ||
        !Object.keys(surveys).length ||
        !map.features.length;
    if (studyIsNew) {
        return (
            <Button
                disabled={disabled}
                variant="contained"
                color="primary"
                onClick={async () => await create(study)}
            >
                Create Study
            </Button>
        );
    } else {
        return (
            <Button
                disabled={disabled}
                variant="contained"
                color="primary"
                onClick={async () => await update(study)}
            >
                Update Study
            </Button>
        );
    }
});

interface StudyViewProps {
    study: Study;
    studyIsNew: boolean;
}

const StudyView = observer((props: any & WithStyles) => {
    const STUDY_TYPES = [
        {
            value: 'stationary',
            label: 'Stationary Activity Count'
        },
        {
            value: 'movement',
            label: 'Movement Counts'
        }
    ];

    const { study, classes, studyIsNew } = props;
    if (study) {
        const {
            title,
            author,
            authorUrl,
            description,
            surveys = {},
            studyId,
            fields,
            surveyors,
            isPublic,
            status,
            type,
            map,
            datapoints = []
        } = study;
        const { latitude, longitude } = getMapCenterForStudy(studyId);
        const features = map && map.features ? map.features : [];
        const studyIsPublic = isPublic === true;
        const studyIsCompleted = status === 'completed';
        const StudyTypeField = props =>
            studyIsNew ? (
                <TextField
                    select
                    required
                    label="Study Type"
                    value={groupArrayOfObjectsBy(STUDY_TYPES, 'value')[type].value}
                    onChange={e => {
                        study.type = e.target.value;
                    }}
                    SelectProps={{
                        MenuProps: {
                            className: classes.menu
                        }
                    }}
                    margin="dense"
                >
                    {STUDY_TYPES.map(({ value, label }) => {
                        return (
                            <MenuItem key={label} value={value}>
                                {label}
                            </MenuItem>
                        );
                    })}
                </TextField>
            ) : (
                <TextField
                    required
                    label="Study Type"
                    value={groupArrayOfObjectsBy(STUDY_TYPES, 'value')[type].label}
                    margin="dense"
                    disabled
                />
            );

        return (
            <div className={classes.container}>
                {studyIsNew && (
                    <div className={classes.header}>
                        <Typography variant="h6">New Study</Typography>
                    </div>
                )}
                {!studyIsNew && (
                    <div className={classes.countRow}>
                        <Typography variant="body2">
                            {datapoints.length} data points collected
                        </Typography>
                    </div>
                )}
                <div className={classes.columns}>
                    <div className={classes.column}>
                        <StudyTypeField />
                        <div className={classes.mapContainer}>
                            <LockedMapView
                                isEditable
                                showOverlay={!features.length}
                                lat={latitude}
                                lng={longitude}
                                featureCollection={map}
                            />
                        </div>
                    </div>
                    <div className={classes.column}>
                        <TextField
                            required
                            label="Title"
                            value={title}
                            onChange={e => (study.title = e.target.value)}
                            margin="dense"
                        />
                        <TextField
                            required
                            label="Description"
                            value={description}
                            margin="dense"
                            helperText="Describe the purpose of your study, for your surveyors and the public data portal (if you choose to make your study public)"
                            onChange={e =>
                                (applicationState.currentStudy.description = e.target.value)
                            }
                        />
                        <TextField
                            required
                            label="Organizer"
                            helperText="Name of the organization managing the study"
                            value={author}
                            margin="dense"
                            onChange={e => (applicationState.currentStudy.author = e.target.value)}
                        />
                        <TextField
                            required
                            label="Info Url (starting with https://)"
                            value={authorUrl}
                            margin="dense"
                            helperText="Link to a web page where surveryors can read info about the study or the study organizer"
                            onChange={e =>
                                (applicationState.currentStudy.authorUrl = e.target.value)
                            }
                        />
                        <TextField
                            required
                            disabled
                            label="Study Fields"
                            value={`${fields.length} Fields`}
                            margin="dense"
                            onClick={() => uiState.modalStack.push('studyFields')}
                            InputLabelProps={{
                                classes: {
                                    disabled: classes.undisabledLabel
                                }
                            }}
                            InputProps={{
                                classes: {
                                    disabled: classes.undisabled
                                },
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="Edit Fields"
                                            onClick={() => uiState.modalStack.push('studyFields')}
                                        >
                                            <EditIcon />
                                        </IconButton>
                                    </InputAdornment>
                                )
                            }}
                        />
                        <TextField
                            required
                            disabled
                            label="Surveyors"
                            value={`${surveyors.length} Surveyors`}
                            margin="dense"
                            onClick={() => uiState.modalStack.push('surveyors')}
                            InputLabelProps={{
                                classes: {
                                    disabled: classes.undisabledLabel
                                }
                            }}
                            InputProps={{
                                classes: {
                                    disabled: classes.undisabled
                                },
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="Edit Surveyors"
                                            onClick={() => uiState.modalStack.push('surveyors')}
                                        >
                                            <EditIcon />
                                        </IconButton>
                                    </InputAdornment>
                                )
                            }}
                        />
                        <TextField
                            required
                            disabled
                            label="Surveys"
                            value={`${Object.keys(toJS(surveys)).length} Surveys`}
                            onClick={() => uiState.modalStack.push('surveys')}
                            margin="dense"
                            InputLabelProps={{
                                classes: {
                                    disabled: classes.undisabledLabel
                                }
                            }}
                            InputProps={{
                                classes: {
                                    disabled: classes.undisabled
                                },
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="Edit Surveys"
                                            onClick={() => uiState.modalStack.push('surveys')}
                                        >
                                            <EditIcon />
                                        </IconButton>
                                    </InputAdornment>
                                )
                            }}
                        />
                        <div>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        color="primary"
                                        checked={studyIsPublic}
                                        onChange={e => {
                                            applicationState.currentStudy.isPublic =
                                                isPublic === false ? true : false;
                                        }}
                                    />
                                }
                                label="Open to the Public"
                            />
                            {!studyIsNew && (
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            color="primary"
                                            checked={studyIsCompleted}
                                            onChange={() => {
                                                applicationState.studies[studyId].status =
                                                    status === 'active' ? 'completed' : 'active';
                                            }}
                                        />
                                    }
                                    label="Completed"
                                />
                            )}
                        </div>
                    </div>
                </div>
                <div className={classes.footer}>
                    {!studyIsNew && (
                        <Fragment>
                            <Button
                                variant="contained"
                                color="secondary"
                                className={classes.footerButton}
                                href={`/study?studyId=${studyId}`}
                            >
                                Open Data Portal
                            </Button>
                            <Button
                                variant="contained"
                                color="secondary"
                                className={classes.footerButton}
                                onClick={() => uiState.modalStack.push('deleteStudy')}
                            >
                                Delete Study
                            </Button>
                        </Fragment>
                    )}
                    {!!datapoints.length && (
                        <Button
                            variant="contained"
                            className={classes.footerButton}
                            onClick={() => downloadDataAsCsv(studyId)}
                        >
                            Download Study Data As CSV
                        </Button>
                    )}
                    <CreateOrUpdateButton study={study} studyIsNew={studyIsNew} />
                </div>
            </div>
        );
    }
    return null;
});

// @ts-ignore
export default withStyles(styles)(StudyView);
