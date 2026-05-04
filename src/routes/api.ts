import {type Context, Hono} from "hono";
import type {DBAdapter, UserFeedback} from "../db/adapter.js";
import type {Config} from "../config.js";
import {BusinessError, InfrastructureError} from "../errors/types.js";
import z from "zod"
import {deleteCookie, setCookie} from "hono/cookie";
import {ExchangeFetcher} from "../back2back/exchange.js";

/**
 * API router class that extends Hono to provide specialized endpoints for user secrets.
 * It integrates a DBAdapter instance for data persistence and a Config object for environment settings.
 * * To add a new route:
 * 1. Define a new async method to handle the request.
 * 2. Register the method in the setupRoutes() function using Hono routing methods.
 */
export class Api extends Hono{
    DBApi: DBAdapter;
    GlobalConfig: Config;
    ExchangeApi: ExchangeFetcher;
    /**
     * Initializes the API with required database and configuration dependencies, then sets up internal routing.
     */
    constructor(DBApi: DBAdapter, GlobalConfig: Config, ExchangeApi: ExchangeFetcher) {
        super();
        this.DBApi = DBApi;
        this.GlobalConfig = GlobalConfig;
        this.ExchangeApi = ExchangeApi;
        this.setupRoutes();
    }

    /**
     * Registers specific HTTP methods and paths to their corresponding internal handler functions.
     */
    setupRoutes(){
        this.get("/authenticate", (c) => this.authenticate(c))
    }


    async authenticate(c: Context){
        const form = c.req.query();
        const contextParameters = z.object({
            code: z.string(),
        })


        const validationResult = contextParameters.safeParse(form);

        if (!validationResult.success) throw new BusinessError("Bad request", 400);

        const code = validationResult.data.code;

        console.log(code)

        const jwt = await this.ExchangeApi.getJWT(code);

        setCookie(c, "jwt", jwt);
        return c.redirect("/profile.html", 303);
    }

}



export class User extends Hono{
    DBApi: DBAdapter;
    GlobalConfig: Config;
    ExchangeApi: ExchangeFetcher;
    /**
     * Initializes the API with required database and configuration dependencies, then sets up internal routing.
     */
    constructor(DBApi: DBAdapter, GlobalConfig: Config, ExchangeApi: ExchangeFetcher) {
        super();
        this.DBApi = DBApi;
        this.GlobalConfig = GlobalConfig;
        this.ExchangeApi = ExchangeApi;
        this.setupRoutes();
    }

    /**
     * Registers specific HTTP methods and paths to their corresponding internal handler functions.
     */
    setupRoutes(){
        this.get("/", (c) => this.getUser(c))
        this.get("/username", (c) => this.getUsername(c))
        this.post("/protected/username", (c) => this.changeUsername(c))
        this.post("/protected/delete", (c) => this.deleteAccount(c))
        this.get("/logout", (c) => this.logout(c))
    }



    async logout(c: Context) {
        const frontendRedirect = c.req.query("redirect_url");
        const finalTarget = frontendRedirect || "http://127.0.0.1:8080/profile.html";

        deleteCookie(c, 'jwt', { path: '/' });

        const idpLogoutUrl = new URL("http://localhost:443/api/user/logout");
        idpLogoutUrl.searchParams.set("return_to", finalTarget);

        return c.redirect(idpLogoutUrl.toString(), 303);
    }


    async userJSON(id: string){
        const userData = (await this.DBApi.getUserById(id)) as UserFeedback;
        return {
            username: userData.username,
            created: userData.created_at.toISOString(),
            active: userData.is_active
        }
    }

    async identitiesJSON(id: string){
        const identities = await this.DBApi.getUserIdentitiesByInternalId(id);
        const publicIdentities = identities.map((identity) => ({
            idp: identity.idp,
            username: identity.idp_username || "",
            email: identity.idp_email || ""}))
        return publicIdentities
    }

    async getId(c: Context){
        const id = c.get("id");
        if (!id) throw new InfrastructureError("Auth middleware failed", 500);
        return id;
    }


    async getUser(c: Context){
        const id = await this.getId(c);
        return c.json({
            user: await this.userJSON(id),
            identities: await this.identitiesJSON(id),
        })

    }

    async getUsername(c: Context){
        const id = await this.getId(c);
        return c.json((await this.userJSON(id)).username, 200);
    }

    async changeUsername(c: Context) {
        const id = await this.getId(c);
        const body = await c.req.json().catch(() => ({}));

        const validation = z.object({
            username: z.string().min(3)
        }).safeParse(body);
        if (!validation.success) {
            throw new BusinessError("Username must be at least 3 characters long", 400);
        }
        const { username } = validation.data;
        const isTaken = await this.DBApi.isUsernameTaken(username);
        if (isTaken) {
            throw new BusinessError("Username already exists", 409);
        }
        const newUsername = await this.DBApi.updateUsername(id, username);
        if (!newUsername) {
            throw new BusinessError("Update failed: User not found", 404);
        }
        return c.json({ success: true , username: newUsername});
    }


    async deleteAccount(c: Context) {
        const id = await this.getId(c);

        const isDeleted = await this.DBApi.deleteUser(id);

        if (!isDeleted) {
            throw new BusinessError("Delete failed: User not found", 404);
        }
        deleteCookie(c, "jwt");
        return c.json({ success: true });
    }

}

export default {Api}