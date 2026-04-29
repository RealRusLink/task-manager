import {type Context, Hono} from "hono";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {serveStatic} from "@hono/node-server/serve-static";
import type {Config} from "../config.js";
import z from "zod"
import {BusinessError} from "../errors/types.js";
import {setCookie} from "hono/cookie";
/**
 * Web router class that extends Hono to serve static assets from a configured directory.
 * It validates the existence of the target path before mounting the static middleware.
 */
export class Web extends Hono {

    /**
     * Initializes the static file server. Requires a global configuration object containing the base path for web assets.
     */
    constructor(GlobalConfig: Config) {
        super();

        const absolutePath = resolve(GlobalConfig.webPath);

        if (!existsSync(absolutePath)) {
            throw new Error(`webPath ${GlobalConfig.webPath} doesn't exist`);
        }
        this.use("/*", serveStatic({ root: GlobalConfig.webPath }));
        this.setupRoutes();
    }

    setupRoutes(){
    }



}

export default {Web}