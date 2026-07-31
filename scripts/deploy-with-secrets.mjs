import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");
const wranglerPath = join(root, "wrangler.jsonc");

function parseDevVarsKeys(filePath) {
	const content = readFileSync(filePath, "utf8");
	const keys = new Map();

	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;

		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;

		keys.set(key, value);
	}

	return keys;
}

function parseRequiredSecrets(wranglerConfig) {
	const match = wranglerConfig.match(/"required"\s*:\s*\[([\s\S]*?)\]/);
	if (!match) return [];

	return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function runWrangler(args) {
	const result = spawnSync("npx", ["wrangler", ...args], {
		cwd: root,
		stdio: "inherit",
		shell: true,
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

if (!existsSync(devVarsPath)) {
	console.error("Файл .dev.vars не найден. Скопируйте .dev.vars.example в .dev.vars и заполните значения.");
	process.exit(1);
}

const vars = parseDevVarsKeys(devVarsPath);
if (vars.size === 0) {
	console.error(".dev.vars пустой или не содержит переменных KEY=VALUE.");
	process.exit(1);
}

const required = existsSync(wranglerPath)
	? parseRequiredSecrets(readFileSync(wranglerPath, "utf8"))
	: [];

const missing = required.filter((key) => {
	const value = vars.get(key);
	return value === undefined || value.length === 0;
});

if (missing.length > 0) {
	console.error(`В .dev.vars не хватает обязательных секретов: ${missing.join(", ")}`);
	process.exit(1);
}

console.log("Загружаю секреты из .dev.vars в Cloudflare...");
runWrangler(["secret", "bulk", ".dev.vars"]);

console.log("Деплою Worker...");
runWrangler(["deploy", "--secrets-file", ".dev.vars"]);

console.log("Готово.");
