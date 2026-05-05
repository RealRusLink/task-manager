import {type Context, Hono} from "hono";
import type {DBAdapter, UserFeedback} from "../db/adapter.js";
import type {Config} from "../config.js";
import {BusinessError, InfrastructureError} from "../errors/types.js";
import z from "zod"
import {deleteCookie, setCookie} from "hono/cookie";
import type {DBTasksAdapter} from "../db/tasks_adapter.js";

/**
 * API router class that extends Hono to provide specialized endpoints for user secrets.
 * It integrates a DBAdapter instance for data persistence and a Config object for environment settings.
 * * To add a new route:
 * 1. Define a new async method to handle the request.
 * 2. Register the method in the setupRoutes() function using Hono routing methods.
 */

export const TaskStatusSchema = z.enum(["Untouched", "WIP", "Done"]);

export const TaskMetaSchema = z.object({
    task_id: z.uuid(),
    author_id: z.uuid(),
    is_active: z.boolean(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
    start_time: z.coerce.date().nullable().default(null),
    finish_time: z.coerce.date().nullable().default(null),
});

export const TaskPayloadSchema = z.object({
    parent_id: z.uuid().nullable().default(null),
    next: z.uuid().nullable().default(null),
    name: z.string(),
    content: z.string(),
    category: z.string(),
    priority: z.number(),
    status: TaskStatusSchema,
    deadline: z.coerce.date().nullable().default(null),
});

export const TaskFullSchema = TaskMetaSchema.merge(TaskPayloadSchema);

export class Tasks extends Hono{
    DBApi: DBAdapter;
    GlobalConfig: Config;
    DBTasksApi: DBTasksAdapter;
    /**
     * Initializes the API with required database and configuration dependencies, then sets up internal routing.
     */
    constructor(DBApi: DBAdapter, DBTasksApi: DBTasksAdapter,  GlobalConfig: Config) {
        super();
        this.DBApi = DBApi;
        this.DBTasksApi = DBTasksApi;
        this.GlobalConfig = GlobalConfig;
        this.setupRoutes();
    }

    /**
     * Registers specific HTTP methods and paths to their corresponding internal handler functions.
     */
    setupRoutes(){
        this.get("/", (c) => this.getHighLevelTasks(c));
        this.post("/", (c) => this.createTask(c));
        this.get("/tree", (c) => this.getTasksTree(c));
        this.get("/search", (c) => this.getTasksSearch(c));
        this.get("/:task_id", (c) => this.getTask(c));
        this.get("/:task_id/children", (c) => this.getTaskChildren(c));
        this.patch("/:task_id", (c) => this.changeTask(c));
        this.post("/rearrange", (c) => this.rearrangeTasks(c));
        this.patch("/:task_id/move", (c) => this.moveTask(c));
        this.delete("/:task_id", (c) => this.softDeleteTask(c));
        this.patch("/:task_id/restore", (c) => this.restoreTask(c));
        this.delete("/:task_id/permanent", (c) => this.hardDeleteTask(c));
    }


    #getData(c: Context){
        const id = c.get("id") as string;
        if (!id) throw new InfrastructureError("Auth middleware failed");
        const json = c.get("json") as object | undefined;
        const query = c.get("query") as object | undefined;
        const task_id = c.get("task_id") as string | undefined;
        return {
            id, query, task_id, json
        }
    }


    async getHighLevelTasks(c: Context){
        const data = this.#getData(c);
        const querySchema = z.object({
            archived: z.preprocess((val) => val === 'true', z.boolean()).optional()
        });
        const { archived } = querySchema.parse(data.query || {});
        const tasks = await this.DBTasksApi.searchTasks(data.id, {parent_id: null, archived: !!archived})
        return c.json({tasks}, 200);
    }

    async getTasksTree(c: Context) {
        const data = this.#getData(c);
        const querySchema = z.object({
            archived: z.preprocess((val) => val === 'true', z.boolean()).optional()
        });
        const { archived } = querySchema.parse(data.query || {});
        const tasks = await this.DBTasksApi.getTree(data.id, !!archived);
        return c.json({ tasks }, 200);
    }
    async getTasksSearch(c: Context){

    }

    async getTask(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        const task = await this.DBTasksApi.getTaskById(data.task_id, data.id);
        if (task) return c.json(task, 200)
        throw new BusinessError("Not found", 404);
    }

    async getTaskChildren(c: Context){

    }


    async createTask(c: Context){
        const data = this.#getData(c);
        console.log(data)
        const payloadTry = TaskPayloadSchema.safeParse(data.json);
        console.log(payloadTry.error);
        if (!payloadTry.success) throw new BusinessError();
        const payload = payloadTry.data;
        const createdTask = await this.DBTasksApi.createTask(payload, data.id);
        return c.json(createdTask, 201)
    }

    async changeTask(c: Context){

    }

    async rearrangeTasks(c: Context){

    }

    async moveTask(c: Context){

    }

    async softDeleteTask(c: Context){

    }

    async restoreTask(c: Context){

    }

    async hardDeleteTask(c: Context){

    }

}

export default {Tasks}