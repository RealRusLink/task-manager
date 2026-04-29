import {Pool} from "pg"
import {type Config} from "../config.js";

/**
 * Manages the PostgreSQL connection pool and handles database connectivity lifecycle.
 */
export class DBConnector {
    /**
     * Internal PostgreSQL client pool that manages and reuses multiple database connections.
     */
    pool: Pool;

    /**
     * Initializes a new connection pool using the provided global configuration object containing credentials and database host info.
     */
    constructor(GLOBAL_CONFIG: Config) {
        this.pool = new Pool({
            host: GLOBAL_CONFIG.db.host,
            port: GLOBAL_CONFIG.db.port,
            user: GLOBAL_CONFIG.db.user,
            database: GLOBAL_CONFIG.db.name,
            password: GLOBAL_CONFIG.db.password,
            max: 10,
            idleTimeoutMillis: 30000
        })
    }

    /**
     * Tests the database connection by attempting to acquire and immediately release a client.
     */
    async verifyConnection(errorHandler: Function = (err: Error) => {
        throw err
    }): Promise<void> {
        try {
            const client = await this.pool.connect();
            client.release();
        } catch (err) {
            errorHandler(err);
        }
    }
}


export default { DBConnector }