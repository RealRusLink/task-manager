import {type Context, Hono} from "hono";
import type {DBAdapter, UserFeedback} from "../db/adapter.js";
import type {Config} from "../config.js";
import {BusinessError, InfrastructureError} from "../errors/types.js";
import z from "zod"
import {deleteCookie, setCookie} from "hono/cookie";
import type {DBTasksAdapter, taskFull, taskPayload, taskStatus} from "../db/tasks_adapter.js";

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


export const TaskContentSchema = z.object({
    name: z.string(),
    content: z.string(),
    category: z.string(),
    priority: z.number(),
    deadline: z.coerce.date().nullable().default(null),
});


export const TaskAdditionalSchema = z.object({
    parent_id: z.uuid().nullable().default(null),
    next: z.uuid().nullable().default(null),
    status: TaskStatusSchema
})


export const TaskPayloadSchema = TaskContentSchema.merge(TaskAdditionalSchema);

const removeUndefined = <T extends Record<string, any>>(obj: T): T => {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, value]) => value !== undefined)
    ) as T;
};


export const TaskUpdateSchema = TaskContentSchema.extend({
    deadline: z.coerce.date().nullable().optional()
}).partial()
  .transform(removeUndefined);

export const TaskAdditionalUpdateSchema = TaskAdditionalSchema.extend({
    parent_id: z.uuid().nullable().optional(),
    next: z.uuid().nullable().optional(),
}).partial().transform(removeUndefined);

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
        this.get("/", (c) => this.getTasksSearch(c));
        this.post("/", (c) => this.createTask(c));
        this.get("/:task_id", (c) => this.getTask(c));
        this.get("/:task_id/path", (c) => this.getTaskPath(c));
        this.get("/:task_id/", (c) => this.getTaskChildren(c));
        this.patch("/:task_id", (c) => this.changeTask(c));
        this.delete("/:task_id", (c) => this.softDeleteTask(c));
        this.put("/:task_id", (c) => this.restoreTask(c));
        this.delete("/:task_id/permanent", (c) => this.hardDeleteTask(c));
    }


    #getData(c: Context){
        const id = c.get("id") as string;
        if (!id) throw new InfrastructureError("Auth middleware failed");
        const json = c.get("json") as object | undefined;
        const query = c.get("query") as object | undefined;
        const task_id = c.get("task_id") as string | undefined | null;
        return {
            id, query, task_id, json
        }
    }



   sortTasksInSequence(tasks: taskFull[]): taskFull[] {
        if (tasks.length === 0) return [];

        const taskMap = new Map<string, taskFull>();
        const hasIncoming = new Set<string>();
        for (const task of tasks) {
            taskMap.set(task.task_id, task);
            if (task.next) {
                hasIncoming.add(task.next);
            }
        }
        let currentTask = tasks.find(t => !hasIncoming.has(t.task_id));
        if (!currentTask && tasks.length > 0) {
            currentTask = tasks[0];
        }
        const result: taskFull[] = [];
        const visited = new Set<string>();
        while (currentTask) {
            if (visited.has(currentTask.task_id)) break;
            result.push(currentTask);
            visited.add(currentTask.task_id);
            if (currentTask.next) {
                currentTask = taskMap.get(currentTask.next);
            } else {
                currentTask = undefined;
            }
        }
        if (result.length < tasks.length) {
            const remaining = tasks.filter(t => !visited.has(t.task_id));
            result.push(...remaining);
        }
        return result;
    }


    async getTasksSearch(c: Context) {
        const searchTasksSchema = z.object({
            q: z.string().optional(),
            category: z.string().optional(),
            status: TaskStatusSchema.optional(),
            parent_id: z.preprocess(
                (val) => (val === "null" || val === null ? null : val),
                z.string().uuid().nullable().optional()
            ),
            is_active: z.preprocess(
                (val) => val === "true" ? true : val === "false" ? false : val,
                z.boolean().optional()
            )
        })
            .strict()
            .transform((val) => {
                return Object.fromEntries(
                    Object.entries(val).filter(([_, v]) => v !== undefined)
                );
            });

        const validateFilters = (data: unknown) => {
            const result = searchTasksSchema.safeParse(data);

            if (!result.success) {
                console.log(result.error)
                throw new BusinessError();
            }

            return result.data;
        };

        const data = this.#getData(c);
        console.log(data)
        const search = validateFilters(data.query);
        const searchResult = await this.DBTasksApi.searchTasks(data.id, search);

        return c.json({ tasks: this.sortTasksInSequence(searchResult) });
    }

    async getTask(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        const task = await this.DBTasksApi.getTaskById(data.task_id, data.id);
        if (task) return c.json(task, 200)
        throw new BusinessError("Not found", 404);
    }

    async getTaskChildren(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        console.log(data)
        const querySchema = z.object({
            is_active: z.preprocess((val) => !(val === "false"), z.boolean().optional().default(true))
        });
        const { is_active } = querySchema.parse(data.query || {});
        const tasks = await this.DBTasksApi.searchTasks(data.id, {parent_id: data.task_id, is_active: !!is_active})
        return c.json({tasks: this.sortTasksInSequence(tasks)}, 200);
    }


    async getTaskPath(c: Context) {
        const data = this.#getData(c);
        if (!data.task_id) {
            throw new BusinessError();
        }

        const path = await this.DBTasksApi.findPath(data.id, data.task_id);

        return c.json({ path }, 200);
    }


    async createTask(c: Context){
        const data = this.#getData(c);
        const payloadTry = TaskPayloadSchema.safeParse(data.json);
        if (!payloadTry.success) throw new BusinessError();
        const payload = payloadTry.data;
        const createdTask = await this.DBTasksApi.createTask(payload, data.id);
        return c.json(createdTask, 201)
    }

    async changeTask(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        const content = TaskUpdateSchema.safeParse(data.json);
        if (!content.success) throw new BusinessError();
        const task = await this.DBTasksApi.updateTask(data.task_id, data.id, content.data as Partial<taskPayload>);

        const additional = TaskAdditionalUpdateSchema.safeParse(data.json);

        if (!additional.success) throw new BusinessError();

        let additionalHandlers = {
            parent_id: async (parent_id: string | null) => await this.DBTasksApi.moveTask(data.task_id as string, data.id, parent_id),
            next: async (next: string | null) => await this.DBTasksApi.sewTaskOrder(data.task_id as string, data.id, next),
            status: async (status: taskStatus) => {
                await this.DBTasksApi.updateTaskStatus(
                    data.task_id as string,
                    data.id,
                    status
                );
            },
        }
        type k = "parent_id" | "next" | "status";
        let key: k;
        for (key in additional.data){
            await additionalHandlers[key](additional.data[key] as any);
        }

        return c.json({task: await this.DBTasksApi.getTaskById(data.task_id, data.id)}, 201)
    }



    async softDeleteTask(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        await this.DBTasksApi.softDeleteTask(data.task_id, data.id);
        return c.json({message: "Success"}, 200);
    }

    async restoreTask(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        if ((await this.DBTasksApi.getTaskById(data.task_id, data.id)))
        await this.DBTasksApi.restoreTask(data.task_id, data.id);
        return c.json({message: "Success"}, 200);
    }

    async hardDeleteTask(c: Context){
        const data = this.#getData(c);
        if (!data.task_id) throw new BusinessError();
        await this.DBTasksApi.permanentDelete(data.task_id, data.id);
        return c.json({message: "Success"}, 200);
    }

}

export default {Tasks}