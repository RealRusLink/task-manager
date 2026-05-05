import { type DBConnector } from "./config.js";
import { type Config } from "../config.js";
import {InfrastructureError} from "../errors/types.js";

type taskStatus = "Untouched" | "WIP" | "Done";





interface taskMeta {
    task_id: string;
    author_id: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    start_time: Date | null;
    finish_time: Date | null;
}

interface taskPayload {
    parent_id: string | null;
    next: string | null;
    name: string;
    content: string;
    category: string;
    priority: number;
    status: taskStatus;
    deadline: Date | null;
}

interface taskFull extends taskMeta, taskPayload {}

export class DBTasksAdapter {
    connection: DBConnector;
    config: Config;
    ALLOWED_UPDATE_FIELDS = new Set([
        "parent_id", "next", "name", "content", "category", "priority", "status", "deadline"
    ]);
    MAX_TREE_DEPTH = 100;
    
    TASK_ID_FIELDS = ["parent_id", "next", "task_id", "children", "tasks"];

    constructor(DBConnection: DBConnector, GlobalConfig: Config) {
        this.connection = DBConnection;
        this.config = GlobalConfig;
    }

    async createTask(payload: taskPayload, authorId: string): Promise<taskFull> {
        const client = await this.connection.pool.connect();
        try {
            await client.query('BEGIN');

            const tailRes = await client.query(
                `SELECT task_id FROM tasks WHERE author_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND next IS NULL FOR UPDATE`,
                [authorId, payload.parent_id]
            );

            const insertRes = await client.query(
                `INSERT INTO tasks (author_id, parent_id, name, content, category, priority, status, deadline, next)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
                 RETURNING *`,
                [authorId, payload.parent_id, payload.name, payload.content, payload.category, payload.priority, payload.status, payload.deadline]
            );

            const newTask = insertRes.rows[0];

            if (tailRes.rows.length > 0) {
                await client.query(
                    `UPDATE tasks SET next = $1 WHERE task_id = $2`,
                    [newTask.task_id, tailRes.rows[0].task_id]
                );
            }

            await client.query('COMMIT');
            return newTask;
        } catch (e) {
            await client.query('ROLLBACK');
            throw new InfrastructureError("Failed to create task", 500);
        } finally {
            client.release();
        }
    }

    async getTree(authorId: string, archived: boolean = false): Promise<taskFull[]> {
        try {
            const query = `
                WITH RECURSIVE task_tree AS (
                    SELECT *, 0 as level FROM tasks
                    WHERE author_id = $1 AND parent_id IS NULL AND is_active = $2
                    UNION ALL
                    SELECT t.*, tt.level + 1 FROM tasks t
                                                      JOIN task_tree tt ON t.parent_id = tt.task_id
                    WHERE t.author_id = $1 AND t.is_active = $2 AND tt.level < $3
                )
                SELECT * FROM task_tree ORDER BY level, parent_id;
            `;
            const res = await this.connection.pool.query(query, [authorId, !archived, this.MAX_TREE_DEPTH]);
            return res.rows;
        } catch (e) {
            throw new InfrastructureError("Failed to fetch tasks", 500);
        }
    }


    async getTaskById(taskId: string, authorId: string): Promise<taskFull | null> {
        try {
            const res = await this.connection.pool.query(
                `SELECT * FROM tasks WHERE task_id = $1 AND author_id = $2`,
                [taskId, authorId]
            );

            if (res.rowCount === 0) return null;
            return res.rows[0];
        } catch (e) {
            throw new InfrastructureError("Failed to fetch task by ID", 500);
        }
    }


    async searchTasks(authorId: string, filters: {
        q?: string,
        category?: string,
        status?: taskStatus,
        parent_id?: string | null,
        archived?: boolean
    }): Promise<taskFull[]> {
        try {
            let query = `SELECT * FROM tasks WHERE author_id = $1 AND is_active = $2`;
            const params: any[] = [authorId, !(filters.archived ?? false)];
            let i = 3;

            if (filters.category) {
                query += ` AND category = $${i++}`;
                params.push(filters.category);
            }
            if (filters.status) {
                query += ` AND status = $${i++}`;
                params.push(filters.status);
            }
            if (filters.parent_id) {
                query += ` AND parent_id = $${i++}`;
                params.push(filters.parent_id);
            }
            if (filters.q) {
                query += ` AND (name ILIKE $${i} OR content ILIKE $${i})`;
                params.push(`%${filters.q}%`);
                i++;
            }

            const res = await this.connection.pool.query(query, params);
            return res.rows;
        } catch (e) {
            throw new InfrastructureError("Task search failed", 500);
        }
    }

    async updateTask(taskId: string, authorId: string, payload: Partial<taskPayload>): Promise<taskFull> {
        const keys = Object.keys(payload).filter(k => this.ALLOWED_UPDATE_FIELDS.has(k));
        if (keys.length === 0) {
            throw new InfrastructureError("Invalid update request", 500);
        }

        const setClause = keys.map((key, i) => `${key} = $${i + 3}`).join(', ');
        const values = keys.map(k => (payload as any)[k]);

        try {
            const res = await this.connection.pool.query(`
                UPDATE tasks
                SET ${setClause}, updated_at = NOW()
                WHERE task_id = $1 AND author_id = $2
                RETURNING *`, [taskId, authorId, ...values]);

            if (res.rowCount === 0) throw new Error();
            return res.rows[0];
        } catch (e) {
            throw new InfrastructureError("Failed to update task", 500);
        }
    }

    async moveTask(taskId: string, authorId: string, newParentId: string | null): Promise<taskFull> {
        const client = await this.connection.pool.connect();
        try {
            await client.query('BEGIN');

            const oldTaskRes = await client.query(
                `SELECT parent_id, next FROM tasks WHERE task_id = $1 AND author_id = $2`,
                [taskId, authorId]
            );

            if (oldTaskRes.rowCount === 0) throw new Error();
            const oldTask = oldTaskRes.rows[0];

            await client.query(
                `UPDATE tasks SET next = $1 WHERE author_id = $2 AND parent_id IS NOT DISTINCT FROM $3 AND next = $4`,
                [oldTask.next, authorId, oldTask.parent_id, taskId]
            );

            const tailRes = await client.query(
                `SELECT task_id FROM tasks WHERE author_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND next IS NULL FOR UPDATE`,
                [authorId, newParentId]
            );

            if (tailRes.rows.length > 0) {
                await client.query(`UPDATE tasks SET next = $1 WHERE task_id = $2`, [taskId, tailRes.rows[0].task_id]);
            }

            const res = await client.query(
                `UPDATE tasks SET parent_id = $1, next = NULL, updated_at = NOW() WHERE task_id = $2 AND author_id = $3 RETURNING *`,
                [newParentId, taskId, authorId]
            );

            await client.query('COMMIT');
            return res.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw new InfrastructureError("Failed to move task", 500);
        } finally {
            client.release();
        }
    }

    async rearrangeTasks(authorId: string, parentId: string | null, orderedIds: string[]): Promise<void> {
        const client = await this.connection.pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query(
                `SELECT task_id FROM tasks WHERE author_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
                [authorId, parentId]
            );

            const existingIds = new Set(existing.rows.map((r: any) => r.task_id));
            if (!orderedIds.every(id => existingIds.has(id))) throw new Error();

            await client.query(
                `UPDATE tasks SET next = NULL WHERE author_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
                [authorId, parentId]
            );

            for (let i = 0; i < orderedIds.length - 1; i++) {
                await client.query(
                    `UPDATE tasks SET next = $1 WHERE task_id = $2 AND author_id = $3`,
                    [orderedIds[i + 1], orderedIds[i], authorId]
                );
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw new InfrastructureError("Failed to rearrange tasks", 500);
        } finally {
            client.release();
        }
    }

    async softDeleteTask(taskId: string, authorId: string): Promise<void> {
        const client = await this.connection.pool.connect();
        try {
            await client.query('BEGIN');

            const taskRes = await client.query(
                `SELECT parent_id, next FROM tasks WHERE task_id = $1 AND author_id = $2`,
                [taskId, authorId]
            );

            if (taskRes.rowCount === 0) throw new Error();
            const { parent_id, next } = taskRes.rows[0];

            await client.query(
                `UPDATE tasks SET next = $1 WHERE author_id = $2 AND parent_id IS NOT DISTINCT FROM $3 AND next = $4`,
                [next, authorId, parent_id, taskId]
            );

            await client.query(
                `WITH RECURSIVE subtree AS (
                    SELECT task_id FROM tasks WHERE task_id = $1 AND author_id = $2
                    UNION ALL
                    SELECT t.task_id FROM tasks t JOIN subtree s ON t.parent_id = s.task_id
                    WHERE t.author_id = $2
                )
                 UPDATE tasks SET is_active = false, next = NULL
                 WHERE task_id IN (SELECT task_id FROM subtree)`, [taskId, authorId]);

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw new InfrastructureError("Failed to delete task", 500);
        } finally {
            client.release();
        }
    }

    async belongsToAuthor(taskIds: string[], authorId: string): Promise<boolean> {
        try {
            if (taskIds.length === 0) return true;
            const res = await this.connection.pool.query(
                `SELECT COUNT(*) AS count FROM tasks WHERE task_id = ANY($1) AND author_id = $2`,
                [taskIds, authorId]
            );
            return parseInt(res.rows[0].count, 10) === taskIds.length;
        } catch (e) {
            throw new InfrastructureError("Ownership check failed", 500);
        }
    }


    async permanentDelete(taskId: string, authorId: string): Promise<void> {
        try {
            const res = await this.connection.pool.query(`
                WITH RECURSIVE subtree AS (
                    SELECT task_id FROM tasks WHERE task_id = $1 AND author_id = $2
                    UNION ALL
                    SELECT t.task_id FROM tasks t JOIN subtree s ON t.parent_id = s.task_id
                    WHERE t.author_id = $2
                )
                DELETE FROM tasks WHERE task_id IN (SELECT task_id FROM subtree)`, [taskId, authorId]);

            if (res.rowCount === 0) throw new Error();
        } catch (e) {
            throw new InfrastructureError("Failed to permanently delete task", 500);
        }
    }
}

export default { DBTasksAdapter };