import type {Config} from "../config.js";


export class KeyFetcher{
    config: Config;

    constructor(GlobalConfig: Config) {
        this.config = GlobalConfig;
    }

    async JWTPublicKey() {
        const response = await fetch(this.config.authentication.jwtKey);
        const key = await response.text();
        return key;
    }

}

