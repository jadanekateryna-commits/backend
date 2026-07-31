/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

type OpenRouterMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

type OpenRouterChoice = {
	message?: {
		content?: string;
	};
};

type OpenRouterResponse = {
	choices?: OpenRouterChoice[];
	error?: {
		message?: string;
	};
};

async function askAI(question: string, apiKey: string): Promise<string> {
	const messages: OpenRouterMessage[] = [
		{
			role: "system",
			content: "Ты полезный ассистент. Отвечай кратко и по делу на русском языке.",
		},
		{
			role: "user",
			content: question,
		},
	];

	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "deepseek/deepseek-v4-flash",
			messages,
		}),
	});

	const data = (await response.json()) as OpenRouterResponse;
	if (!response.ok) {
		const errorMessage = data?.error?.message ?? "Unknown OpenRouter error";
		throw new Error(`OpenRouter request failed: ${errorMessage}`);
	}

	return data?.choices?.[0]?.message?.content?.trim() ?? "Пустой ответ от модели.";
}

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Use POST /ask with JSON body: {\"question\":\"...\"}", {
				status: 405,
			});
		}

		const url = new URL(request.url);
		if (url.pathname !== "/ask") {
			return new Response("Not Found", { status: 404 });
		}

		const { question } = (await request.json()) as { question?: string };
		if (!question || !question.trim()) {
			return new Response(JSON.stringify({ error: "Field 'question' is required." }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const apiKey = (env as Env & { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY;
		if (!apiKey) {
			return new Response(
				JSON.stringify({ error: "OPENROUTER_API_KEY secret is not configured." }),
				{
					status: 500,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		try {
			const answer = await askAI(question, apiKey);
			return new Response(JSON.stringify({ answer }), {
				headers: { "Content-Type": "application/json" },
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return new Response(JSON.stringify({ error: message }), {
				status: 502,
				headers: { "Content-Type": "application/json" },
			});
		}
	},
} satisfies ExportedHandler<Env>;
