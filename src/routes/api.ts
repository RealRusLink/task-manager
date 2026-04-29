import {type Context, Hono} from "hono";
import type {DBAdapter} from "../db/adapter.js";
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
        this.get("/user", (c) => this.echo(c))
        this.get("/user/logout", (c) => this.logout(c))
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

    async logout(c: Context) {
        const frontendRedirect = c.req.query("redirect_url");
        const finalTarget = frontendRedirect || "http://127.0.0.1:8080/profile.html";

        deleteCookie(c, 'jwt', { path: '/' });

        const idpLogoutUrl = new URL("http://localhost:443/api/user/logout");
        idpLogoutUrl.searchParams.set("return_to", finalTarget);

        return c.redirect(idpLogoutUrl.toString(), 303);
    }


    async echo(c: Context){
        const jwt = c.get("jwt");
        const userData = c.get("userData");
        if (jwt && userData) return c.json({jwt, userData}, 200);
        else throw new InfrastructureError("Auth middleware failed", 500)
    }
}

export default {Api}