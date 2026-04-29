import type { Config } from "../config.js";
import {BusinessError, InfrastructureError} from "../errors/types.js";

export class ExchangeFetcher {
    private readonly config: Config;

    constructor(globalConfig: Config) {
        this.config = globalConfig;
    }

    /**
     * Exchanges the authorization code for a JWT.
     * Sending the code as plain text in the body.
     */
    async getJWT(code: string): Promise<string> {
        const response = await fetch(this.config.authentication.exchange, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({code: code})
        });

        if (!response.ok) {
            if (response.status >= 500){
                throw new InfrastructureError("IDP offline");
            }
            throw new BusinessError("Expired code", 401)
        }

        const jwt = await response.text();
        return jwt.trim();
    }
}