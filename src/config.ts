import dotenv from "dotenv";

const loadData = () => {
    dotenv.config({ quiet: true });

    return {
        webPath: process.env.WEB_PATH || "",
        listenPort: Number(process.env.LISTEN_PORT || 80),
        db: {
            host: process.env.DB_HOST || "",
            port: Number(process.env.DB_PORT || 0),
            name: process.env.DB_NAME || "",
            user: process.env.DB_USER || "",
            password: process.env.DB_PASSWORD || "",
            tables: {
                users: process.env.USERS_TABLE || "",
            }
        },
        authentication: {
            idp: process.env.IDP || "",
            jwtKey: process.env.JWT_KEY || "",
            exchange: process.env.EXCHANGE || "",
            refresh: process.env.REFRESH || "",
            auditor: process.env.AUDITOR || ""
        }
    };
};
type ConfigData = ReturnType<typeof loadData>;
abstract class ConfigBase {}

interface ConfigBase extends ConfigData {}

export class Config extends ConfigBase {
    constructor() {
        super();
        const data = loadData();
        this.checkConfig(data, "GLOBAL_CONFIG");
        Object.assign(this, data);
    }

    private checkConfig(obj: Record<string, any>, objName: string): void {
        for (const key in obj) {
            const val = obj[key];
            if (val === undefined || val === null || val === "" || (typeof val === "number" && Number.isNaN(val))) {
                throw new Error(`${objName}.${key} is invalid (${val}). Config failed to load.`);
            }
            if (typeof val === "object" && !Array.isArray(val)) {
                this.checkConfig(val, `${objName}.${key}`);
            }
        }
    }
}

export default { Config };