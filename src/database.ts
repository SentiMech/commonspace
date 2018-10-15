'use strict';
import * as pg from 'pg';

console.log(process.env);

const config = {
    user: process.env.db_user,
    database: process.env.db_name,
    password: process.env.db_pass,
    host: process.env.db_host,
    port: parseInt(process.env.db_port),
    max: parseInt(process.env.db_pool_size),
    idleTimeoutMillis: parseInt(process.env.db_client_timeout),
};

const pool = new pg.Pool(config);

pool.connect(function(err, client, done) {
    if (err) {
        console.error("error fetching client from pool", err);
        process.exit(1);
    }
    done();
});

pool.on("error", function(err, client) {
    // if an error is encountered by a client while it sits idle in the pool
    // the pool itself will emit an error event with both the error and
    // the client which emitted the original error
    // this is a rare occurrence but can happen if there is a network partition
    // between your application and the database, the database restarts, etc.
    // and so you might want to handle it and at least log it out
    console.error("idle client error", err.message, err.stack);
});

export default pool;