import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("backend worker routes", () => {
	it("returns 404 for unknown paths", async () => {
		const request = new IncomingRequest("http://example.com/unknown", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});

	it("returns 405 for non-POST methods", async () => {
		const request = new IncomingRequest("http://example.com/ask", {
			method: "GET",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(405);
	});
});
