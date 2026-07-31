import { askAI } from "./openrouter";
import {
	PlanTasksError,
	handlePlanTasks,
	parsePlanTasksRequest,
} from "./planTasks";
import type { SupabaseConfig } from "./supabase";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function getOpenRouterKey(env: Env): string | null {
	const key = env.OPENROUTER_API_KEY?.trim();
	return key || null;
}

function getSupabaseConfig(env: Env): SupabaseConfig | null {
	const url = env.SUPABASE_URL?.trim();
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!url || !serviceRoleKey) {
		return null;
	}
	return { url, serviceRoleKey };
}

async function handleAsk(request: Request, env: Env): Promise<Response> {
	const { question } = (await request.json()) as { question?: string };
	if (!question || !question.trim()) {
		return jsonResponse({ error: "Field 'question' is required." }, 400);
	}

	const apiKey = getOpenRouterKey(env);
	if (!apiKey) {
		return jsonResponse({ error: "OPENROUTER_API_KEY secret is not configured." }, 500);
	}

	try {
		const answer = await askAI(question, apiKey);
		return jsonResponse({ answer }, 200);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return jsonResponse({ error: message }, 502);
	}
}

async function handlePlanTasksRoute(request: Request, env: Env): Promise<Response> {
	const parsed = parsePlanTasksRequest(await request.json());
	if (parsed instanceof Response) {
		return parsed;
	}

	const openRouterApiKey = getOpenRouterKey(env);
	if (!openRouterApiKey) {
		return jsonResponse({ error: "OPENROUTER_API_KEY secret is not configured." }, 500);
	}

	const supabase = getSupabaseConfig(env);
	if (!supabase) {
		return jsonResponse(
			{
				error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.",
			},
			500,
		);
	}

	try {
		const result = await handlePlanTasks(parsed, openRouterApiKey, supabase);
		return jsonResponse(result, 200);
	} catch (error) {
		if (error instanceof PlanTasksError) {
			return jsonResponse({ error: error.message }, error.status);
		}

		const message = error instanceof Error ? error.message : "Unknown error";
		if (message.includes("Supabase")) {
			return jsonResponse({ error: message }, 502);
		}

		return jsonResponse({ error: message }, 502);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method !== "POST") {
			return new Response(
				'Use POST /ask or POST /plan-tasks with JSON body. Example: {"question":"..."}',
				{ status: 405 },
			);
		}

		const url = new URL(request.url);
		if (url.pathname === "/ask") {
			return handleAsk(request, env);
		}

		if (url.pathname === "/plan-tasks") {
			return handlePlanTasksRoute(request, env);
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
