import { chatCompletion } from "./openrouter";
import {
	createLocalCardId,
	getBoardColumns,
	updateBoardColumns,
	type BoardCard,
	type BoardColumn,
	type SupabaseConfig,
} from "./supabase";

export type PlanTasksUser = {
	id: string;
	name: string;
	role: string;
	email?: string;
};

export type PlanTasksRequest = {
	boardId: string;
	globalTask: string;
	users: PlanTasksUser[];
};

type AiTaskItem = {
	title: string;
	description: string;
	assigneeId: string;
	labels: string[];
};

type AiTasksResponse = {
	tasks: AiTaskItem[];
};

export type PlanTasksResult = {
	boardId: string;
	tasks: BoardCard[];
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export function parsePlanTasksRequest(body: unknown): PlanTasksRequest | Response {
	if (!body || typeof body !== "object") {
		return jsonResponse({ error: "Request body must be a JSON object." }, 400);
	}

	const record = body as Record<string, unknown>;
	const boardId = typeof record.boardId === "string" ? record.boardId.trim() : "";
	const globalTask = typeof record.globalTask === "string" ? record.globalTask.trim() : "";

	if (!boardId || !UUID_RE.test(boardId)) {
		return jsonResponse({ error: "Field 'boardId' must be a valid UUID." }, 400);
	}

	if (!globalTask) {
		return jsonResponse({ error: "Field 'globalTask' is required." }, 400);
	}

	if (!Array.isArray(record.users) || record.users.length === 0) {
		return jsonResponse({ error: "Field 'users' must be a non-empty array." }, 400);
	}

	const users: PlanTasksUser[] = [];
	for (const item of record.users) {
		if (!item || typeof item !== "object") {
			return jsonResponse({ error: "Each user must be an object." }, 400);
		}
		const user = item as Record<string, unknown>;
		const id = typeof user.id === "string" ? user.id.trim() : "";
		const name = typeof user.name === "string" ? user.name.trim() : "";
		const role = typeof user.role === "string" ? user.role.trim() : "";
		const email = typeof user.email === "string" ? user.email.trim() : undefined;

		if (!id || !UUID_RE.test(id) || !name || !role) {
			return jsonResponse(
				{ error: "Each user requires valid 'id' (UUID), 'name', and 'role'." },
				400,
			);
		}

		users.push({ id, name, role, email });
	}

	return { boardId, globalTask, users };
}

function extractJsonObject(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		return trimmed;
	}

	const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenceMatch?.[1]) {
		return fenceMatch[1].trim();
	}

	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start >= 0 && end > start) {
		return trimmed.slice(start, end + 1);
	}

	return trimmed;
}

function validateAiTasks(raw: unknown, userIds: Set<string>): AiTaskItem[] {
	if (!raw || typeof raw !== "object") {
		throw new Error("AI response is not a JSON object.");
	}

	const tasksRaw = (raw as AiTasksResponse).tasks;
	if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
		throw new Error("AI response must contain a non-empty 'tasks' array.");
	}

	const tasks: AiTaskItem[] = [];
	for (const item of tasksRaw) {
		if (!item || typeof item !== "object") {
			throw new Error("Each task in AI response must be an object.");
		}
		const task = item as AiTaskItem;
		const title = typeof task.title === "string" ? task.title.trim() : "";
		const description = typeof task.description === "string" ? task.description.trim() : "";
		const assigneeId = typeof task.assigneeId === "string" ? task.assigneeId.trim() : "";
		const labels = Array.isArray(task.labels)
			? task.labels.filter((label): label is string => typeof label === "string")
			: [];

		if (!title || !description || !assigneeId || !userIds.has(assigneeId)) {
			throw new Error("AI task has invalid fields or unknown assigneeId.");
		}

		tasks.push({ title, description, assigneeId, labels });
	}

	return tasks;
}

async function planTasksWithAI(
	globalTask: string,
	users: PlanTasksUser[],
	apiKey: string,
): Promise<AiTaskItem[]> {
	const userIds = new Set(users.map((user) => user.id));
	const teamJson = JSON.stringify(
		users.map((user) => ({
			id: user.id,
			name: user.name,
			role: user.role,
		})),
	);

	const systemPrompt = `Ты планировщик задач для команды разработки.
Разбей глобальную задачу на 3–12 конкретных подзадач.
Назначай исполнителей только из списка команды, учитывая поле role (frontend_developer, backend_developer, qa_engineer и т.д.).
Ответь строго одним JSON-объектом без markdown и комментариев:
{"tasks":[{"title":"...","description":"...","assigneeId":"uuid","labels":["..."]}]}`;

	const userPrompt = `Глобальная задача: ${globalTask}

Команда:
${teamJson}`;

	const messages = [
		{ role: "system" as const, content: systemPrompt },
		{ role: "user" as const, content: userPrompt },
	];

	let lastError: Error | null = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const retryNote =
			attempt === 0
				? ""
				: "\n\nПредыдущий ответ был невалидным. Верни только корректный JSON по схеме.";

		try {
			const content = await chatCompletion(
				[
					messages[0],
					{
						role: "user",
						content: userPrompt + retryNote,
					},
				],
				apiKey,
				{ responseFormat: { type: "json_object" } },
			);

			if (!content) {
				throw new Error("Empty AI response.");
			}

			const parsed = JSON.parse(extractJsonObject(content)) as unknown;
			return validateAiTasks(parsed, userIds);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error("Unknown AI parse error.");
		}
	}

	throw lastError ?? new Error("Failed to plan tasks with AI.");
}

function toBoardCards(tasks: AiTaskItem[], users: PlanTasksUser[]): BoardCard[] {
	const userById = new Map(users.map((user) => [user.id, user]));

	return tasks.map((task) => {
		const user = userById.get(task.assigneeId);
		if (!user) {
			throw new Error(`Unknown assigneeId: ${task.assigneeId}`);
		}

		return {
			id: createLocalCardId(),
			title: task.title,
			description: task.description,
			assignee: {
				id: user.id,
				displayName: user.name,
				...(user.email ? { email: user.email } : {}),
				teamRole: user.role,
			},
			labels: task.labels.length > 0 ? task.labels : [user.role],
		};
	});
}

function appendCardsToFirstColumn(columns: BoardColumn[], cards: BoardCard[]): BoardColumn[] {
	if (columns.length === 0) {
		throw new Error("Board has no columns.");
	}

	const next = columns.map((column) => ({
		...column,
		cards: Array.isArray(column.cards) ? [...column.cards] : [],
	}));

	const first = next[0];
	first.cards = [...first.cards, ...cards];
	return next;
}

export async function handlePlanTasks(
	request: PlanTasksRequest,
	openRouterApiKey: string,
	supabase: SupabaseConfig,
): Promise<PlanTasksResult> {
	const columns = await getBoardColumns(supabase, request.boardId);
	if (columns.length === 0) {
		throw new PlanTasksError("Board not found or has no columns.", 404);
	}

	const aiTasks = await planTasksWithAI(request.globalTask, request.users, openRouterApiKey);
	const cards = toBoardCards(aiTasks, request.users);
	const updatedColumns = appendCardsToFirstColumn(columns, cards);

	await updateBoardColumns(supabase, request.boardId, updatedColumns);

	return {
		boardId: request.boardId,
		tasks: cards,
	};
}

export class PlanTasksError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}
