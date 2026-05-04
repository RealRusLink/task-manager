import {LoggerService, consoleConfig, type logLevel, type logSilent} from "logger/dist/index.js"
import {Config} from "./config.js";
import {DBConnector} from "./db/config.js";
import {DBAdapter} from "./db/adapter.js";
import {Api, User} from "./routes/api.js";
import {Web} from "./routes/web.js";
import {type MiddlewareDeclaration, type RoutersDeclaration, Routes} from "./routes/index.js";
import {Server} from "./server.js";
import {DBErrorTranslator} from "./errors/translators.js";
import {
    AllowRedirectMiddleware,
    JWTVerificationMiddleware,
    errorHandler,
    LoggerMiddleware, AuthenticationMiddleware, FreshnessGuardMiddleware
} from "./routes/middleware.js";
import {TokenManager} from "./crypto/token.js";
import {BusinessError} from "./errors/types.js";
import {KeyFetcher} from "./back2back/key.js";
import {ExchangeFetcher} from "./back2back/exchange.js";

/**
 * A Proxy-based builder that does component decoration.
 * It encapsulates the 'logRule' state to ensure that logging levels
 * are inherited correctly across all decoration stages.
 */
const createBuilder = <T extends object>(instance: T, message: string, logRule?: logLevel | logSilent): any => {
    return new Proxy(instance, {
        get(target, prop, receiver) {
            /**
             * Wraps the current instance with an error translation function.
             * This maintains the builder pattern by returning a new Proxy that carries
             * the original instance's logging context.
             */
            if (prop === 'addTranslator') {
                return (translatorFn: (obj: T) => T) => {
                    Logger.important(`Initialised ${translatorFn.name} for ${target.constructor.name}`)
                    return createBuilder(translatorFn(target), message, logRule);
                };
            }

            /**
             * Dynamically injects logging into all instance methods.
             * * Hierarchy of Log Level Resolution:
             * 1. Explicit: The 'level' argument passed directly to .addLogger(level).
             * 2. Component-specific: The 'logRule' provided during the init() call.
             * 3. Global: The current 'Logger.logLevel' value (dynamic fallback).
             */
            if (prop === 'addLogger') {
                return (level?: logLevel | logSilent) => {
                    // Logic: If no specific level is provided here or in init(),
                    // we fall back to the logger's current global state.
                    const effectiveLevel = level ?? logRule ?? Logger.logLevel;

                    const logged = Logger.setMultipleLoggers(target, effectiveLevel);
                    return createBuilder(logged, message, effectiveLevel);
                };
            }

            return Reflect.get(target, prop, receiver);
        }
    });
};

/**
 * The primary entry point for class instantiation.
 * Handles wrapping of constructors to ensure class creation is visible in logs.
 * * @param BaseClass - The class to be instantiated.
 * @param settings.message - A descriptive message logged upon successful instantiation.
 * @param settings.logRule - Optional. Sets a specific logging priority for this class.
 * @param args - Constructor parameters for the BaseClass.
 */
export const init = <T extends new (...args: any[]) => any>(
    BaseClass: T,
    settings: { message: string, logRule?: logLevel | logSilent },
    ...args: ConstructorParameters<T>
): InstanceType<T> & {
    addTranslator: (fn: (obj: InstanceType<T>) => InstanceType<T>) => InstanceType<T> & any,
    addLogger: (level?: logLevel | logSilent) => InstanceType<T> & any
} => {
    const { message, logRule } = settings;

    /**
     * Decorates the constructor. If IS_LOGGING_ENABLED is true,
     * it logs class creation at the IMPORTANT level.
     */
    const WrappedClass = IS_LOGGING_ENABLED
        ? Logger.wrapConstructor(BaseClass, {
            customMessage: message,
            customMessageLevel: "IMPORTANT",
            customLogRule: logRule || Logger.logLevel
        })
        : BaseClass;

    const instance = new WrappedClass(...args);
    return createBuilder(instance, message, logRule);
};

const IS_LOGGING_ENABLED = true;

/**
 * Initialize global logger.
 * CAUTION: "TRACE level may expose private data as it logs function arguments and result"
 */
const lconf = consoleConfig;
lconf.suppressedErrors = [BusinessError]
const Logger = new LoggerService(lconf);
Logger.logLevel = "TRACE"
const safeLogLevel: logLevel | logLevel = "TRACE"


/**
 * BOOTSTRAP SEQUENCE
 */

// Load configuration to add dependencies.
const GlobalConfig = init(Config, { message: "Global configuration loaded", logRule: safeLogLevel });

// Create database connection
const DBConnection = init(DBConnector, { message: "DB pool connected", logRule: safeLogLevel }, GlobalConfig)
    .addTranslator(DBErrorTranslator)
    .addLogger();

// Ensure the database is live before attempting to build routing adapters.
await DBConnection.verifyConnection();

// Initialize the primary Data Access Layer with DEBUG visibility.
const DBApi = init(DBAdapter, { message: "DB adapter initialised", logRule: safeLogLevel }, DBConnection, GlobalConfig)
    .addTranslator(DBErrorTranslator)
    .addLogger();

const TokenApi = init(TokenManager, {message: "Token manager initialised", logRule: safeLogLevel}, GlobalConfig).addLogger()

const KeyApi = init(KeyFetcher, {message: "Key fetcher initialised", logRule: safeLogLevel}, GlobalConfig).addLogger()

const ExchangeApi = init(ExchangeFetcher, {message: "Exchange fetcher initialised", logRule: safeLogLevel}, GlobalConfig).addLogger()

// Declare sub-routers for API and Web domains.
const routersDeclaration: RoutersDeclaration = [
    {
        router: init(Api, { message: "Api routes initialised" }, DBApi, GlobalConfig, ExchangeApi).addLogger(),
        path: "/api"
    },
    {
        router: init(User, { message: "User api routes initialised" }, DBApi, GlobalConfig, ExchangeApi).addLogger(),
        path: "/api/user"
    },
    {
        router: init(Web, { message: "Web routes initialised" }, GlobalConfig).addLogger(),
        path: "/"
    }
];

// Register global middlewares.
const middlewareDeclaration: MiddlewareDeclaration = [
    {
        middlewareClass: init(LoggerMiddleware, { message: "Logging middleware initialised" }, Logger).addLogger(),
        path: "*",
    },
    {
        middlewareClass: init(AllowRedirectMiddleware, { message: "Redirect middleware initialised" }).addLogger(),
        path: "*",
    },
    {
        middlewareClass: init(JWTVerificationMiddleware, { message: "Authentication middleware initialised"}, TokenApi, KeyApi).addLogger(),
        path: "/api/user/*"
    },
    {
        middlewareClass: init(AuthenticationMiddleware, { message: "Authentication middleware initialised"}, DBApi).addLogger(),
        path: "/api/user/*"
    },
    {
        middlewareClass: init(FreshnessGuardMiddleware, { message: "Freshness protection middleware initialised"}, GlobalConfig).addLogger(),
        path: "/api/user/protected/*"
    }
]

// Assemble the final routing tree and attach global exception handling.
const AppRoutes = init(Routes, { message: "All routes and middleware registered" }, routersDeclaration, middlewareDeclaration).addLogger();
AppRoutes.onError(errorHandler)
Logger.important("Registered global error handling")

// Run server.
const AppServer = init(Server, { message: `Server started on port ${GlobalConfig.listenPort}` }, AppRoutes, GlobalConfig).addLogger();


/**
 * Graceful shutdown.
 * Ensures the process exits only after closing active network listeners and DB pools.
 */
const shutdown = async () => {
    Logger.important("Received shutdown signal. Starting graceful shutdown...");

    // Stop the server instance to prevent new incoming traffic.
    AppServer.stop();
    Logger.important("HTTP server stopped accepting new connections.");

    try {
        // Gracefully close the database pool once current queries finish.
        await DBConnection.pool.end();
        Logger.important("Database pool successfully closed.");
        process.exit(0);
    } catch (err) {
        Logger.error(`Error during graceful shutdown: ${err}`);
        process.exit(1);
    }
};

// Monitor OS signals for termination.
process.on('SIGINT', shutdown);
process.on("exit", () => Logger.important("Server closed."));