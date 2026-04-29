import {type DBConnector} from "./config.js";
import {type Config} from "../config.js";

/**
 * Data access layer that provides methods for user management and secret handling.
 * Requires an instance of DBConnector (holding the connection pool) and a Config object for table mapping.
 */
export class DBAdapter {
    connection: DBConnector;
    config: Config;

    /**
     * Initializes the adapter with a database connection pool and global configuration.
     */
    constructor(DBConnection: DBConnector, GlobalConfig: Config) {
        this.connection = DBConnection;
        this.config = GlobalConfig
    }



}

export default {DBAdapter}