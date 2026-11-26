/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { openAICompatible, runAgent } from "./src/agent";

const MAX_INPUT = 20_000;

// Live extraction only exists in `npm run dev`, next to the local model.
// The static build ships replay-only, so a hosted demo never calls an LLM.
const extractApi: Plugin = {
	name: "extract-api",
	configureServer(server) {
		const complete = openAICompatible();
		server.middlewares.use("/api/extract", async (req, res) => {
			const send = (status: number, body: unknown) => {
				res.statusCode = status;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify(body));
			};
			if (req.method !== "POST") return send(405, { error: "POST only" });
			let raw = "";
			for await (const chunk of req) raw += chunk;
			let text: unknown;
			try {
				text = JSON.parse(raw).text;
			} catch {
				return send(400, { error: "body must be JSON {text}" });
			}
			if (typeof text !== "string" || !text.trim() || text.length > MAX_INPUT) {
				return send(400, { error: `text must be 1-${MAX_INPUT} characters` });
			}
			// NDJSON stream: one {"step"} line per finished turn, then {"result"} or {"error"}.
			res.statusCode = 200;
			res.setHeader("content-type", "application/x-ndjson");
			const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);
			try {
				const result = await runAgent(text, complete, {
					onStep: (step) => line({ step }),
				});
				line({ result });
			} catch (e) {
				line({ error: `model call failed: ${(e as Error).message}` });
			}
			res.end();
		});
	},
};

export default defineConfig({
	root: "web",
	base: "./",
	plugins: [react(), extractApi],
	build: { outDir: "../dist", emptyOutDir: true },
	test: { root: ".", include: ["test/**/*.test.ts"] },
});
