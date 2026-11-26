import type {
	ChatCompletion,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { type Complete, runAgent } from "../src/agent";
import type { Extraction } from "../src/schema";

const valid: Extraction = {
	documentType: "invoice",
	shipper: {
		name: "Cooperativa Cafeeira Alta Mogiana Ltda.",
		address: null,
		country: "BR",
	},
	consignee: {
		name: "Van Dijk Koffie Import B.V.",
		address: null,
		country: "NL",
	},
	portOfLoading: { code: "BRSSZ", name: "Santos" },
	portOfDischarge: { code: "NLRTM", name: "Rotterdam" },
	departureDate: "2026-10-08",
	arrivalDate: "2026-10-29",
	cargo: {
		description: "Green coffee",
		packages: 320,
		grossWeightKg: 19520,
		netWeightKg: 19200,
	},
	charges: [
		{ description: "Ocean freight", amount: 2505, currency: "USD" },
		{ description: "Docs", amount: 75, currency: "USD" },
	],
	total: { amount: 2580, currency: "USD" },
	totalUsd: 2580,
	notes: [],
};

let callId = 0;
const reply = (...calls: [string, unknown][]): ChatCompletion =>
	({
		choices: [
			{
				index: 0,
				finish_reason: calls.length ? "tool_calls" : "stop",
				message: {
					role: "assistant",
					content: calls.length ? null : "done",
					refusal: null,
					tool_calls: calls.map(([name, args]) => ({
						id: `call_${++callId}`,
						type: "function",
						function: { name, arguments: JSON.stringify(args) },
					})),
				},
			},
		],
	}) as unknown as ChatCompletion;

// Replays scripted replies and keeps a copy of what the agent sent each turn.
function scripted(...replies: ChatCompletion[]) {
	const sent: ChatCompletionMessageParam[][] = [];
	const complete: Complete = async (messages) => {
		sent.push(structuredClone(messages));
		const next = replies.shift();
		if (!next) throw new Error("script exhausted");
		return next;
	};
	return { complete, sent };
}

const toolMessages = (msgs: ChatCompletionMessageParam[] = []) =>
	msgs
		.filter((m) => m.role === "tool")
		.map((m) => JSON.parse(m.content as string));

describe("runAgent", () => {
	it("runs tools, then accepts a valid submission", async () => {
		const { complete, sent } = scripted(
			reply(
				["lookup_port", { query: "Santos" }],
				["lookup_port", { query: "Rotterdam" }],
			),
			reply(["submit_extraction", valid]),
		);
		const result = await runAgent("doc", complete);

		expect(result.ok).toBe(true);
		expect(result.data).toEqual(valid);
		expect(result.validationFailures).toBe(0);
		expect(result.steps.map((s) => s.toolCalls.map((c) => c.name))).toEqual([
			["lookup_port", "lookup_port"],
			["submit_extraction"],
		]);
		// Real tool output went back to the model, not a placeholder.
		expect(toolMessages(sent[1])[0].matches[0].code).toBe("BRSSZ");
	});

	it("feeds business-rule errors back and recovers on retry", async () => {
		// Dates read as MM/DD: arrival lands before departure.
		const wrongDates = {
			...valid,
			departureDate: "2026-11-14",
			arrivalDate: "2026-02-12",
		};
		const { complete, sent } = scripted(
			reply(["submit_extraction", wrongDates]),
			reply(["submit_extraction", valid]),
		);
		const result = await runAgent("doc", complete);

		expect(result.ok).toBe(true);
		expect(result.validationFailures).toBe(1);
		const feedback = toolMessages(sent[1])[0];
		expect(feedback.errors).toEqual([
			expect.stringMatching(
				/^arrivalDate: arrival 2026-02-12 is before departure 2026-11-14/,
			),
		]);
		expect(result.steps[0]?.toolCalls[0]?.isError).toBe(true);
	});

	it("gives up after too many invalid submissions", async () => {
		const bad = { ...valid, totalUsd: 999 };
		const { complete } = scripted(
			...Array.from({ length: 3 }, () => reply(["submit_extraction", bad])),
		);
		const result = await runAgent("doc", complete);

		expect(result.ok).toBe(false);
		expect(result.data).toBeNull();
		expect(result.validationFailures).toBe(3);
		expect(result.steps[0]?.toolCalls[0]?.output).toEqual({
			errors: [expect.stringContaining("totalUsd 999 does not match")],
		});
	});

	it("nudges the model when it answers without calling a tool", async () => {
		const { complete, sent } = scripted(
			reply(),
			reply(["submit_extraction", valid]),
		);
		const result = await runAgent("doc", complete);

		expect(result.ok).toBe(true);
		expect(sent[1]?.at(-1)).toEqual({
			role: "user",
			content: "Call submit_extraction with the extracted data.",
		});
	});

	it("returns tool errors to the model instead of throwing", async () => {
		const { complete, sent } = scripted(
			reply(
				["convert_currency", { amount: 10, from: "XYZ", to: "USD" }],
				["no_such_tool", {}],
			),
			reply(["submit_extraction", valid]),
		);
		const result = await runAgent("doc", complete);

		expect(result.ok).toBe(true);
		const [convert, unknown] = toolMessages(sent[1]);
		expect(convert.error).toMatch(/Unsupported currency/);
		expect(unknown.error).toBe("unknown tool no_such_tool");
	});
});
