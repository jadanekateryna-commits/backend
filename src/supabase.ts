export type BoardColumn = {
	id: string;
	title: string;
	cards: unknown[];
};

export type BoardCard = {
	id: string;
	title: string;
	description?: string;
	assignee?: {
		id: string;
		displayName: string;
		email?: string;
		teamRole?: string;
	};
	labels: string[];
};

export type SupabaseConfig = {
	url: string;
	serviceRoleKey: string;
};

function supabaseHeaders(config: SupabaseConfig): HeadersInit {
	return {
		apikey: config.serviceRoleKey,
		Authorization: `Bearer ${config.serviceRoleKey}`,
		Accept: "application/json",
		"Content-Type": "application/json",
	};
}

function restBase(url: string): string {
	return url.replace(/\/$/, "");
}

export async function getBoardColumns(
	config: SupabaseConfig,
	boardId: string,
): Promise<BoardColumn[]> {
	const response = await fetch(
		`${restBase(config.url)}/rest/v1/boards?id=eq.${encodeURIComponent(boardId)}&select=id,columns`,
		{
			method: "GET",
			headers: supabaseHeaders(config),
		},
	);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Supabase read failed (${response.status}): ${body}`);
	}

	const rows = (await response.json()) as { columns?: unknown }[];
	if (!rows.length) {
		return [];
	}

	const columns = rows[0]?.columns;
	if (!Array.isArray(columns)) {
		return [];
	}

	return columns as BoardColumn[];
}

export async function updateBoardColumns(
	config: SupabaseConfig,
	boardId: string,
	columns: BoardColumn[],
): Promise<void> {
	const response = await fetch(
		`${restBase(config.url)}/rest/v1/boards?id=eq.${encodeURIComponent(boardId)}`,
		{
			method: "PATCH",
			headers: {
				...supabaseHeaders(config),
				Prefer: "return=minimal",
			},
			body: JSON.stringify({
				columns,
				updated_at: new Date().toISOString(),
			}),
		},
	);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Supabase update failed (${response.status}): ${body}`);
	}
}

export function createLocalCardId(): string {
	const suffix = crypto.randomUUID().slice(0, 6);
	return `card-local-${Date.now()}-${suffix}`;
}
