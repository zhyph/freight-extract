import OpenAI from "openai";
import type {
	ChatCompletion,
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from "openai/resources/chat/completions";
import { type ZodType, z } from "zod";
import { Extraction } from "./schema";
import {
	ConvertCurrencyInput,
	convertCurrency,
	LookupPortInput,
	lookupPort,
} from "./tools";

export type Complete = (
	messages: ChatCompletionMessageParam[],
	tools: ChatCompletionTool[],
) => Promise<ChatCompletion>;

export type ToolCallTrace = {
	name: string;
	input: unknown;
	output: unknown;
	isError: boolean;
};
export type Step = {
	turn: number;
	ms: number;
	reasoning?: string;
	text?: string;
	toolCalls: ToolCallTrace[];
	tokens?: { prompt: number; completion: number };
};
export type AgentResult = {
	ok: boolean;
	data: Extraction | null;
	validationFailures: number;
	steps: Step[];
	totalMs: number;
	error?: string;
};

// Any OpenAI-compatible endpoint: local Ollama by default, or a free hosted tier via env.
export function openAICompatible(
	baseURL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
	model = process.env.LLM_MODEL ?? "freight-qwen",
	apiKey = process.env.LLM_API_KEY ?? "ollama",
): Complete {
	const client = new OpenAI({ baseURL, apiKey });
	return (messages, tools) =>
		client.chat.completions.create({ model, messages, tools, temperature: 0 });
}

const SYSTEM = `You extract structured data from freight documents (invoices, booking confirmations, bills of lading, quotes, emails).

Rules:
- Call lookup_port for every port to get its UN/LOCODE. Never guess a code.
- Weights go in kg. 1 lb = 0.45359237 kg, 1 t = 1000 kg.
- Dates go in YYYY-MM-DD. Read DD/MM vs MM/DD from context (sender country, other dates) and say what you assumed in notes. If only a transit time is given, add it to the departure date.
- Numbers may use European format: 1.950,00 means 1950.00.
- If the document has a total, call convert_currency to fill totalUsd.
- Use null for anything the document does not state. Never invent values.
- Ignore quoted older messages in email threads when a newer value exists.
- When done, call submit_extraction. If it returns errors, fix them and call it again.`;

const TOOLS: Record<
	string,
	{ description: string; schema: ZodType; run: (input: never) => unknown }
> = {
	lookup_port: {
		description: "Find a port's UN/LOCODE by city name or code.",
		schema: LookupPortInput,
		run: ({ query }: z.infer<typeof LookupPortInput>) => {
			const matches = lookupPort(query);
			return matches.length
				? { matches }
				: { matches, hint: "no match; try the city name alone" };
		},
	},
	convert_currency: {
		description:
			"Convert an amount between currencies using the fixed demo rates table.",
		schema: ConvertCurrencyInput,
		run: ({ amount, from, to }: z.infer<typeof ConvertCurrencyInput>) =>
			convertCurrency(amount, from, to),
	},
	submit_extraction: {
		description:
			"Submit the final extraction. Returns validation errors to fix, or ok.",
		schema: Extraction,
		run: () => ({ ok: true }),
	},
};

const toolDefs: ChatCompletionTool[] = Object.entries(TOOLS).map(
	([name, t]) => ({
		type: "function",
		function: {
			name,
			description: t.description,
			parameters: z.toJSONSchema(t.schema) as Record<string, unknown>,
		},
	}),
);

const formatIssues = (e: z.ZodError) =>
	e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

function runTool(
	name: string,
	rawArgs: string,
): ToolCallTrace & { parsed?: unknown } {
	let input: unknown = rawArgs;
	try {
		input = JSON.parse(rawArgs);
	} catch {
		return {
			name,
			input,
			output: { error: "arguments were not valid JSON" },
			isError: true,
		};
	}
	const tool = TOOLS[name];
	if (!tool)
		return {
			name,
			input,
			output: { error: `unknown tool ${name}` },
			isError: true,
		};
	const parsed = tool.schema.safeParse(input);
	if (!parsed.success)
		return {
			name,
			input,
			output: { errors: formatIssues(parsed.error) },
			isError: true,
		};
	try {
		return {
			name,
			input,
			output: tool.run(parsed.data as never),
			isError: false,
			parsed: parsed.data,
		};
	} catch (e) {
		return {
			name,
			input,
			output: { error: (e as Error).message },
			isError: true,
		};
	}
}

export async function runAgent(
	document: string,
	complete: Complete,
	{ maxTurns = 12, maxValidationFailures = 3 } = {},
): Promise<AgentResult> {
	const started = performance.now();
	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: SYSTEM },
		{ role: "user", content: document },
	];
	const steps: Step[] = [];
	let validationFailures = 0;
	const done = (
		ok: boolean,
		data: Extraction | null,
		error?: string,
	): AgentResult => ({
		ok,
		data,
		validationFailures,
		steps,
		totalMs: Math.round(performance.now() - started),
		error,
	});

	for (let turn = 1; turn <= maxTurns; turn++) {
		const t0 = performance.now();
		const res = await complete(messages, toolDefs);
		const msg = res.choices[0]?.message;
		if (!msg) return done(false, null, "model returned no message");

		const step: Step = {
			turn,
			ms: Math.round(performance.now() - t0),
			// Ollama and several hosted providers return reasoning outside the OpenAI spec.
			reasoning: (msg as { reasoning?: string }).reasoning || undefined,
			text: msg.content || undefined,
			toolCalls: [],
			tokens: res.usage
				? {
						prompt: res.usage.prompt_tokens,
						completion: res.usage.completion_tokens,
					}
				: undefined,
		};
		steps.push(step);
		messages.push(msg);

		const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
		if (!calls.length) {
			messages.push({
				role: "user",
				content: "Call submit_extraction with the extracted data.",
			});
			continue;
		}

		let submitted: Extraction | null = null;
		for (const call of calls) {
			const { parsed, ...trace } = runTool(
				call.function.name,
				call.function.arguments,
			);
			step.toolCalls.push(trace);
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(trace.output),
			});
			if (trace.name === "submit_extraction") {
				if (trace.isError) validationFailures++;
				else submitted = parsed as Extraction;
			}
		}
		if (submitted) return done(true, submitted);
		if (validationFailures >= maxValidationFailures) {
			return done(
				false,
				null,
				`gave up after ${validationFailures} failed validations`,
			);
		}
	}
	return done(false, null, `no valid extraction within ${maxTurns} turns`);
}
