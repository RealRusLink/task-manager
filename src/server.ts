import {serve} from "@hono/node-server";
import type {Routes} from "./routes/index.js";
import type {Config} from "./config.js";

/**
 * Entry point for the HTTP server that binds the application routing logic to a physical port.
 * It uses the @hono/node-server adapter to run the Hono application in a Node.js environment.
 */
export class Server {
    private instance: ReturnType<typeof serve>
    /**
     * Starts the HTTP server.
     * It expects an instance of the Routes class (containing all registered middleware and endpoints)
     * and a Config object. It extracts the port from the config and uses the Routes fetch
     * implementation to handle incoming requests.
     */
    constructor(AppRoutes: Routes, GlobalConfig: Config) {
        this.instance = serve({
            fetch: AppRoutes.fetch,
            port: GlobalConfig.listenPort
        })
    }

    /**
     * Method for server shutdown
     */
    stop(){
        this.instance.close()
    }

}