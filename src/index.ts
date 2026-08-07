import { askAI } from "./openrouter";
import {
	PlanTasksError,
	handlePlanTasks,
	parsePlanTasksRequest,
} from "./planTasks";
import type { SupabaseConfig } from "./supabase";

const ALLOWED_ORIGINS = new Set([
	"http://localhost:5173",
	"http://127.0.0.1:5173",
]);

function corsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get("Origin");
	const allowOrigin =
		origin && ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:5173";

	return {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
	};
}

function withCors(response: Response, request: Request): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeaders(request))) {
		headers.set(key, value);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function jsonResponse(body: unknown, status: number, request: Request): Response {
	return withCors(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
		request,
	);
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
		return jsonResponse({ error: "Field 'question' is required." }, 400, request);
	}

	const apiKey = getOpenRouterKey(env);
	if (!apiKey) {
		return jsonResponse({ error: "OPENROUTER_API_KEY secret is not configured." }, 500, request);
	}

	try {
		const answer = await askAI(question, apiKey);
		return jsonResponse({ answer }, 200, request);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return jsonResponse({ error: message }, 502, request);
	}
}

async function handlePlanTasksRoute(request: Request, env: Env): Promise<Response> {
	const parsed = parsePlanTasksRequest(await request.json());
	if (parsed instanceof Response) {
		return withCors(parsed, request);
	}

	const openRouterApiKey = getOpenRouterKey(env);
	if (!openRouterApiKey) {
		return jsonResponse({ error: "OPENROUTER_API_KEY secret is not configured." }, 500, request);
	}

	const supabase = getSupabaseConfig(env);
	if (!supabase) {
		return jsonResponse(
			{
				error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.",
			},
			500,
			request,
		);
	}

	try {
		const result = await handlePlanTasks(parsed, openRouterApiKey, supabase);
		return jsonResponse(result, 200, request);
	} catch (error) {
		if (error instanceof PlanTasksError) {
			return jsonResponse({ error: error.message }, error.status, request);
		}

		const message = error instanceof Error ? error.message : "Unknown error";
		if (message.includes("Supabase")) {
			return jsonResponse({ error: message }, 502, request);
		}

		return jsonResponse({ error: message }, 502, request);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			if (url.pathname === "/ask" || url.pathname === "/plan-tasks") {
				return new Response(null, {
					status: 204,
					headers: corsHeaders(request),
				});
			}

			return withCors(new Response(null, { status: 404 }), request);
		}

		if (request.method !== "POST") {
			return withCors(
				new Response(
					'Use POST /ask or POST /plan-tasks with JSON body. Example: {"question":"..."}',
					{ status: 405 },
				),
				request,
			);
		}

		if (url.pathname === "/ask") {
			return handleAsk(request, env);
		}

		if (url.pathname === "/plan-tasks") {
			return handlePlanTasksRoute(request, env);
		}

		return withCors(new Response("Not Found", { status: 404 }), request);
	},
} satisfies ExportedHandler<Env>;
