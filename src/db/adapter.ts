import {type DBConnector} from "./config.js";
import {type Config} from "../config.js";



export interface CreateUserFeedback {
    id: string;
}

export interface CreateUserIdentityFeedback {
    internal_user_id: string;
    idp: string;
    idp_user_id: string;
    idp_username?: string;
    idp_email?: string;
    created_at: Date;
}

export interface CreateUserIdentityParams {
    internal_user_id: string;
    idp: string;
    idp_user_id: string;
    idp_username?: string;
    idp_email?: string;
}



export interface UserFeedback {
    id: string;
    username: string;
    created_at: Date;
    is_active: boolean;
}

export interface RegisterParams {
    idp: string;
    idp_user_id: string;
    idp_username?: string;
    idp_email?: string;
}


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


    async createUser(username: string): Promise<string> {
        const query = `
        INSERT INTO ${this.config.db.tables.users} (
            username
        ) VALUES ($1)
        RETURNING id;
    `;

        const values = [username];

        const result = await this.connection.pool.query<CreateUserFeedback>(query, values);
        return result.rows[0]?.id as string;
    }



    async createUserIdentity(data: CreateUserIdentityParams): Promise<CreateUserIdentityFeedback> {
        const query = `
            INSERT INTO ${this.config.db.tables.userIdentities} (
                internal_user_id,
                idp,
                idp_user_id,
                idp_username,
                idp_email
            ) VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
        `;

        const values = [
            data.internal_user_id,
            data.idp,
            data.idp_user_id,
            data.idp_username ?? null,
            data.idp_email ?? null
        ];

        const result = await this.connection.pool.query<CreateUserIdentityFeedback>(query, values);
        return result.rows[0] as CreateUserIdentityFeedback;
    }





    async getUserById(id: string): Promise<UserFeedback | null> {
        const query = `
            SELECT id, username, created_at, is_active 
            FROM ${this.config.db.tables.users} 
            WHERE id = $1;
        `;

        const result = await this.connection.pool.query<UserFeedback>(query, [id]);
        return result.rows.length > 0 ? result.rows[0] as UserFeedback : null;
    }

    async getUserIdentity(idp: string, idp_user_id: string): Promise<CreateUserIdentityFeedback | null> {
        const query = `
            SELECT internal_user_id, idp, idp_user_id, idp_username, idp_email, created_at
            FROM ${this.config.db.tables.userIdentities}
            WHERE idp = $1 AND idp_user_id = $2;
        `;

        const result = await this.connection.pool.query<CreateUserIdentityFeedback>(query, [idp, idp_user_id]);
        return result.rows.length > 0 ? result.rows[0] as CreateUserIdentityFeedback : null;
    }


    async getUserIdentitiesByInternalId(internalUserId: string): Promise<CreateUserIdentityFeedback[]> {
        const query = `
        SELECT 
            internal_user_id, 
            idp, 
            idp_user_id, 
            idp_username, 
            idp_email, 
            created_at
        FROM ${this.config.db.tables.userIdentities}
        WHERE internal_user_id = $1;
    `;

        const result = await this.connection.pool.query<CreateUserIdentityFeedback>(query, [internalUserId]);
        return result.rows;
    }


    async deleteUser(internalId: string): Promise<boolean> {
        const client = await this.connection.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `DELETE FROM "${this.config.db.tables.userIdentities}" WHERE internal_user_id = $1`,
                [internalId]
            );
            const res = await client.query(
                `DELETE FROM "${this.config.db.tables.users}" WHERE id = $1`,
                [internalId]
            );
            await client.query('COMMIT');
            return (res.rowCount ?? 0) > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async updateUsername(id: string, newUsername: string): Promise<string | null> {
        const query = `
            UPDATE ${this.config.db.tables.users}
            SET username = $1
            WHERE id = $2
                RETURNING username;
        `;

        const result = await this.connection.pool.query(query, [newUsername, id]);

        if (result.rows.length > 0) {
            return result.rows[0].username;
        }

        return null;
    }


    async isUsernameTaken(username: string): Promise<boolean> {
        const query = `
        SELECT 1 FROM ${this.config.db.tables.users} 
        WHERE username = $1 
        LIMIT 1;
    `;
        const result = await this.connection.pool.query(query, [username]);
        return (result.rowCount ?? 0) > 0;
    }


    async register(data: RegisterParams): Promise<string> {
        const client = await this.connection.pool.connect();

        try {
            await client.query('BEGIN');

            const userQuery = `
                INSERT INTO ${this.config.db.tables.users} (username)
                VALUES ($1)
                    RETURNING id;
            `;
            const userResult = await client.query<{ id: string }>(userQuery, [data.idp_username ?? data.idp_user_id]);
            const internal_user_id = userResult.rows[0]?.id as string;

            const identityQuery = `
                INSERT INTO ${this.config.db.tables.userIdentities} (
                    internal_user_id,
                    idp,
                    idp_user_id,
                    idp_username,
                    idp_email
                ) VALUES ($1, $2, $3, $4, $5);
            `;
            const identityValues = [
                internal_user_id,
                data.idp,
                data.idp_user_id,
                data.idp_username ?? null,
                data.idp_email ?? null
            ];

            await client.query(identityQuery, identityValues);

            await client.query('COMMIT');
            return internal_user_id;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }




}

export default {DBAdapter}