import {Config} from "../config.js";
import {createVerify} from "node:crypto";



import z from "zod";

export interface JWTPayload {sub: string, username: string, email: string, exp: number, iat: number, iss: string, aud: string}

export type verifyJWTfeedback =
    | { success: false, reason: "Bad JWT format" | "Compromised JWT" | "Expired" }
    | { success: true, payload: JWTPayload };

const JWTPayloadSchema = z.object({
    sub: z.string(),
    username: z.string(),
    email: z.string().email(),
    exp: z.number(),
    iat: z.number(),
    iss: z.string(),
    aud: z.string()
});


export class TokenManager {
    config: Config;
    constructor(GlobalConfig: Config) {
        this.config = GlobalConfig;
    }

    verifyJWT(jwt: string, publicKey: string): verifyJWTfeedback {
        const parts = jwt.split('.');
        if (parts.length !== 3) return { success: false, reason: "Bad JWT format" };

        const [encodedHeader, encodedPayload, encodedSignature] = parts;

        const verifier = createVerify("RSA-SHA256");
        verifier.update(`${encodedHeader}.${encodedPayload}`);

        const isSignatureValid = verifier.verify(
            publicKey,
            encodedSignature || "",
            "base64url"
        );
        if (!isSignatureValid) return { success: false, reason: "Compromised JWT" };
        let rawPayload: any;
        try {
            rawPayload = JSON.parse(Buffer.from(encodedPayload || "", "base64url").toString());
        } catch {
            return { success: false, reason: "Bad JWT format" };
        }
        const result = JWTPayloadSchema.safeParse(rawPayload);
        if (!result.success) return { success: false, reason: "Bad JWT format" };
        if (result.data.exp < Math.floor(Date.now() / 1000)) {
            return { success: false, reason: "Expired" };
        }

        return { success: true, payload: result.data };
    }

}
