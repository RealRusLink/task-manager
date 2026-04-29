import {Hono} from "hono";
import type {Middleware} from "./middleware.js";

/**
 * Collection of objects mapping Hono router instances to their respective base paths.
 */
export type RoutersDeclaration<T extends Hono = Hono> =
    {router: T, path: string}[]

/**
 * Collection of objects mapping middleware instances to their respective execution paths.
 */
export type MiddlewareDeclaration<T extends Middleware = Middleware> =
    { middlewareClass: T, path: string }[]


/**
 * Central router class that aggregates instances extending Hono and Middleware.
 * It registers sub-routers and middleware handlers at their designated paths.
 */
export class Routes extends Hono{
    /**
     * Mounts all provided middleware and sub-routers onto the main Hono instance.
     */
    constructor(routersList: RoutersDeclaration, middlewareList: MiddlewareDeclaration) {
        super()
        for (let middle of middlewareList){
            this.use(middle.path,  middle.middlewareClass.handler)
        }
        for (let route of routersList){
            this.route(route.path, route.router)
        }
    }
}

export default {Routes}