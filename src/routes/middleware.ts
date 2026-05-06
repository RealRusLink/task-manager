import {type Context, Hono, type MiddlewareHandler, type Next} from "hono";
import  { getCookie } from "hono/cookie"
import {type LoggerService} from "logger/dist/index.js"
import {AppError, BusinessError, InfrastructureError} from "../errors/types.js";
import {type JWTPayload, TokenManager} from "../crypto/token.js";
import type {KeyFetcher} from "../back2back/key.js";
import type {DBAdapter} from "../db/adapter.js";
import type {Config} from "../config.js";
import type {DBTasksAdapter} from "../db/tasks_adapter.js";
import type {arrayOutputType} from "zod/v3";
import z from "zod"
/**
 * Base abstract class for creating Hono middleware.
 * Exposes a standardized handler that bridges Hono's middleware interface with the internal execute logic.
 * * To implement custom middleware:
 * 1. Extend this class.
 * 2. Implement the protected `execute` method with your logic.
 * 3. Call `await next()` within `execute` to continue the request lifecycle.
 */
export abstract class Middleware{

    /**
     * The middleware handler function to be registered in Hono.
     */
    public readonly handler: MiddlewareHandler = (c, next) => this.execute(c, next);

    /**
     * Internal logic of the middleware to be implemented by subclasses.
     */
    abstract execute: (c: Context, next: Next) => Promise<Response | void>

}



/**
 * Middleware implementation that logs the lifecycle of an HTTP request, including method, path, and execution duration.
 * Requires a LoggerService instance for output.
 */
export class LoggerMiddleware extends Middleware{
    logger: LoggerService;
    constructor(Logger: LoggerService) {
        super();
        this.logger = Logger;
    }

    /**
     * Records the start of the request, awaits execution, and logs the total processing time.
     */
    execute = async (c: Context, next: () => Promise<void>) => {
        this.logger.info(`Entered endpoint ${c.req.method} ${c.req.path}`);
        const time = performance.now();
        await next();
        this.logger.info(`Endpoint ${c.req.method} ${c.req.path} finished in ${Math.round(performance.now() - time)} ms. Status: ${c.res.status}`)
    }


}



/**
 * Middleware implementation that handles authentication concerns.
 * Requires a TokenManager instance for validation.
 */
export class AllowRedirectMiddleware extends Middleware{

    constructor() {
        super();

    }

    /**
     * Sets cookies
     */
    execute = async (c: Context, next: () => Promise<void>) => {
        c.header('Access-Control-Allow-Origin', '*')
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        if (c.req.method === 'OPTIONS') {
            return c.text('', 200)
        }
        await next()
    }


}

export class JWTVerificationMiddleware extends Middleware{
    TokenApi: TokenManager;
    KeyApi: KeyFetcher;
    constructor(TokenApi: TokenManager, KeyApi: KeyFetcher) {
        super();
        this.TokenApi = TokenApi;
        this.KeyApi = KeyApi;
    }

    /**
     * Checks if JWT is present and valid.
     */
    execute = async (c: Context, next: () => Promise<void>) => {
        const token = getCookie(c, "jwt");
        if (!token) throw new BusinessError("No JWT", 401);
        const tokenCheck = this.TokenApi.verifyJWT(token, await this.KeyApi.JWTPublicKey());
        if (!tokenCheck.success) throw new BusinessError(tokenCheck.reason, 401);
        c.set("jwt", token);
        c.set("userData", tokenCheck.payload)
        await next()
    }


}

export class AuthenticationMiddleware extends Middleware {
    DBApi: DBAdapter;

    constructor(DBApi: DBAdapter) {
        super();
        this.DBApi = DBApi;
    }

    execute = async (c: Context, next: () => Promise<void>) => {
        const userData = c.get("userData") as JWTPayload;
        const identity = await this.DBApi.getUserIdentity(userData.iss, userData.sub);

        let internalId: string;

        if (!identity) {
            internalId = await this.DBApi.register({
                idp: userData.iss,
                idp_user_id: userData.sub,
                idp_username: userData.username,
                idp_email: userData.email,
            });
        } else {
            internalId = identity.internal_user_id;
        }

        c.set("id", internalId);
        await next();
    }
}


export class FreshnessGuardMiddleware extends Middleware {
    config: Config;

    constructor(config: Config) {
        super();
        this.config = config;
    }

    execute = async (c: Context, next: () => Promise<void>) => {
        const userData = c.get("userData") as JWTPayload;

        if (!userData || typeof userData.iat !== 'number') {
            throw new InfrastructureError("Auth middleware failed", 500);
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const tokenAgeSeconds = nowSeconds - userData.iat;
        const maxAgeSeconds = Math.floor(this.config.authentication.secureTTL / 1000);

        if (tokenAgeSeconds > maxAgeSeconds) {
            throw new BusinessError("Session expired", 403);
        }

        await next();
    }
}

async function safeJSON(c: Context){
    try {
        let result = await c.req.json() as object;
        return result;
    } catch (e){
        return {};
    }
}



export class AuthorizationMiddleware extends Middleware {
    DBApi: DBAdapter;
    DBTasksApi: DBTasksAdapter;

    constructor(DBApi: DBAdapter, DBTasksApi: DBTasksAdapter) {
        super();
        this.DBApi = DBApi;
        this.DBTasksApi = DBTasksApi;
    }

    #getIDs(subject: any, result: Array<string>): Array<string> {
        if (!subject || typeof subject !== 'object') return result;

        for (const key in subject) {
            const value = subject[key];

            if (this.DBTasksApi.TASK_ID_FIELDS.includes(key)) {
                if (Array.isArray(value)) {
                    result.push(...value.map(String));
                } else if (value !== null && value !== undefined) {
                    if (typeof value === 'string') {
                        result.push(value);
                    }
                }
            }
            if (value !== null && typeof value === "object") {
                this.#getIDs(value, result);
            }
        }
        return result;
    }

    execute = async (c: Context, next: () => Promise<void>) => {
        const json = await safeJSON(c) || {};
        const query = c.req.query();

        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const idsFromPath = c.req.path.match(uuidRegex) || [];

        const otherIds = this.#getIDs({ ...json, ...query }, []);
        const combinedIds = [...idsFromPath, ...otherIds];
        let uniqueIds = [...new Set(combinedIds.filter(id => id && id !== 'undefined'))];
        if (uniqueIds.length === 0) {
            c.set("json", json);
            c.set("query", query);
            return await next();
        }

        const userId = c.get("id");
        if (!userId) {
            throw new InfrastructureError("Authentication middleware failed");
        }
        const validation = z.preprocess((val) => {
            if (Array.isArray(val)) {
                return val.filter(item => item !== "null" && item != null);
            }
            return val;
        }, z.array(z.string().uuid())).safeParse(uniqueIds);
        if (!validation.success) {
            throw new BusinessError("Invalid Task ID format", 400);
        }
        uniqueIds = validation.data;
        const isAuthorized = await this.DBTasksApi.belongsToAuthor(uniqueIds, userId);
        if (!isAuthorized) {
            throw new BusinessError("Forbidden", 403);
        }

        c.set("json", json);
        c.set("query", query);
        c.set("task_id", uniqueIds[0]);

        await next();
    }
}




/**
 * Global error handling function that catches exceptions, distinguishing between known AppErrors and unexpected internal errors.
 */
export function errorHandler (err: Error, c: Context){
    if (err instanceof AppError) return c.text(err.customMessage, err.code)
    return c.text("Unknown error", 500)
}