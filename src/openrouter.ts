export type OpenRouterMessage = {
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

export type ChatCompletionOptions = {
	model?: string;
	responseFormat?: { type: "json_object" };
};

export async function chatCompletion(
	messages: OpenRouterMessage[],
	apiKey: string,
	options: ChatCompletionOptions = {},
): Promise<string> {
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: options.model ?? "deepseek/deepseek-v4-flash",
			messages,
			...(options.responseFormat ? { response_format: options.responseFormat } : {}),
		}),
	});

	const data = (await response.json()) as OpenRouterResponse;
	if (!response.ok) {
		const errorMessage = data?.error?.message ?? "Unknown OpenRouter error";
		throw new Error(`OpenRouter request failed: ${errorMessage}`);
	}

	return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function askAI(question: string, apiKey: string): Promise<string> {
	const content = await chatCompletion(
		[
			{
				role: "system",
				content: "Ты полезный ассистент. Отвечай кратко и по делу на русском языке.",
			},
			{
				role: "user",
				content: question,
			},
		],
		apiKey,
	);

	return content || "Пустой ответ от модели.";
}
