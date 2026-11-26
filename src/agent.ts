import OpenAI from "openai";
import type {
	ChatCompletion,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from "openai/resources/chat/completions";
import { type ZodType, z } from "zod";
import { DocumentType, Extraction } from "./schema";
import {
	ConvertCurrencyInput,
	convertCurrency,
	LookupPortInput,
	lookupPort,
} from "./tools";

export type CompleteParams = Pick<
	ChatCompletionCreateParamsNonStreaming,
	"messages" | "tools" | "response_format" | "reasoning_effort" | "max_tokens"
>;
export type Complete = (params: CompleteParams) => Promise<ChatCompletion>;

export type ToolCallTrace = {
	name: string;
	input: unknown;
	output: unknown;
	isError: boolean;
};
export type Step = {
	turn: number;
	kind: "classify" | "extract";
	ms: number;
	reasoning?: string;
	text?: string;
	toolCalls: ToolCallTrace[];
	tokens?: { prompt: number; completion: number };
};
export type Classification = z.infer<typeof Classification>;
export type AgentResult = {
	ok: boolean;
	data: Extraction | null;
	classification: Classification | null;
	validationFailures: number;
	steps: Step[];
	totalMs: number;
	error?: string;
};

export const defaultModel = () => process.env.LLM_MODEL ?? "freight-qwen";

// Any OpenAI-compatible endpoint: local Ollama by default, or a free hosted tier via env.
export function openAICompatible(
	baseURL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
	model = defaultModel(),
	apiKey = process.env.LLM_API_KEY ?? "ollama",
): Complete {
	const client = new OpenAI({ baseURL, apiKey });
	return (params) =>
		client.chat.completions.create({ model, temperature: 0, ...params });
}

const SYSTEM = `You extract structured data from freight documents (invoices, booking confirmations, bills of lading, quotes, emails).

Rules:
- Call lookup_port for every port to get its UN/LOCODE. Never guess a code.
- Weights go in kg. 1 lb = 0.45359237 kg, 1 t = 1000 kg.
- Dates go in YYYY-MM-DD. Read DD/MM vs MM/DD from context (sender country, other dates) and say what you assumed in notes. One date whose second number is above 12 (like 11/24) proves MM/DD for the whole document; US senders usually use MM/DD. If only a transit time is given, add it to the departure date.
- Numbers may use European format: 1.950,00 means 1950.00.
- If the document has a total, call convert_currency to fill totalUsd.
- Use null for anything the document does not state. Never invent values.
- Ignore quoted older messages in email threads when a newer value exists.
- When done, call submit_extraction. If it returns errors, fix them and call it again.`;

// Stage 1: a cheap call with no tools that routes the document.
// Its output picks type-specific guidance for stage 2.
const Classification = z.object({
	documentType: DocumentType,
	language: z.string().describe("ISO 639-1 code of the main language, e.g. en"),
});

const TYPE_HINTS: Record<z.infer<typeof DocumentType>, string> = {
	invoice:
		"Invoices: use the grand total, not a subtotal. Sailing or ETD/ETA dates give departure/arrival.",
	booking_confirmation:
		"Booking confirmations: ETD and ETA are departure and arrival. Cut-off and validity dates are not.",
	bill_of_lading:
		"Bills of lading: the shipped-on-board or laden-on-board date is the departure date. They rarely state an arrival date; use null then.",
	quote:
		"Quotes: use the expected sailing date as departure. Validity dates are not shipment dates.",
	other: "",
};

const MAX_LOOKUP_MISSES = 3;

const TOOLS: Record<
	string,
	{ description: string; schema: ZodType; run: (input: never) => unknown }
> = {
	lookup_port: {
		description: "Find a port's UN/LOCODE by city name or code.",
		schema: LookupPortInput,
		run: ({ query, country }: z.infer<typeof LookupPortInput>) => {
			const matches = lookupPort(query, country).map(
				({ code, name, country }) => ({ code, name, country }),
			);
			return matches.length
				? { matches }
				: {
						matches,
						hint: "no seaport matches. Try the city name alone. Inland places (ICDs, inland cities) have no seaport code: use null for that port.",
					};
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

// Echo the offending value: "Invalid ISO date" alone never told the model its
// date was double-quoted ("\"2018-08-03\""), so it resubmitted the same thing.
const formatIssues = (e: z.ZodError) =>
	e.issues.map((i) => {
		const got =
			i.input === undefined
				? ""
				: ` (got ${JSON.stringify(i.input).slice(0, 80)})`;
		return `${i.path.join(".") || "(root)"}: ${i.message}${got}`;
	});

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
	const parsed = tool.schema.safeParse(input, { reportInput: true });
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

function stepFrom(
	res: ChatCompletion,
	turn: number,
	kind: Step["kind"],
	ms: number,
): Step {
	const msg = res.choices[0]?.message;
	return {
		turn,
		kind,
		ms: Math.round(ms),
		// Ollama and several hosted providers return reasoning outside the OpenAI spec.
		reasoning:
			(msg as { reasoning?: string } | undefined)?.reasoning || undefined,
		text: msg?.content || undefined,
		toolCalls: [],
		tokens: res.usage
			? {
					prompt: res.usage.prompt_tokens,
					completion: res.usage.completion_tokens,
				}
			: undefined,
	};
}

async function classify(
	document: string,
	complete: Complete,
): Promise<{ step: Step; classification: Classification | null }> {
	const t0 = performance.now();
	const res = await complete({
		messages: [
			{
				role: "system",
				content:
					"Classify this freight document. A forwarded email counts as the type of the document it carries.",
			},
			{ role: "user", content: document },
		],
		// Routing needs no reasoning: with thinking on, qwen3.5 once spent 16k tokens here.
		reasoning_effort: "none",
		max_tokens: 200,
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "classification",
				schema: z.toJSONSchema(Classification) as Record<string, unknown>,
			},
		},
	});
	const step = stepFrom(res, 1, "classify", performance.now() - t0);
	let parsed: ReturnType<typeof Classification.safeParse> | null = null;
	try {
		parsed = Classification.safeParse(JSON.parse(step.text ?? ""));
	} catch {
		// unparseable output: fall through and extract without routing
	}
	const classification = parsed?.success ? parsed.data : null;
	step.toolCalls.push({
		name: "classify",
		input: "(document)",
		output: classification ?? {
			error: "unusable classification, continuing without it",
		},
		isError: !classification,
	});
	return { step, classification };
}

export async function runAgent(
	document: string,
	complete: Complete,
	{
		maxTurns = 12,
		maxValidationFailures = 3,
		route = true,
		onStep = (_step: Step) => {},
	} = {},
): Promise<AgentResult> {
	const started = performance.now();
	const steps: Step[] = [];
	let validationFailures = 0;
	let lookupMisses = 0;
	let classification: Classification | null = null;
	const record = (step: Step) => {
		steps.push(step);
		onStep(step);
	};
	const done = (
		ok: boolean,
		data: Extraction | null,
		error?: string,
	): AgentResult => ({
		ok,
		data,
		classification,
		validationFailures,
		steps,
		totalMs: Math.round(performance.now() - started),
		error,
	});

	let system = SYSTEM;
	if (route) {
		const c = await classify(document, complete);
		classification = c.classification;
		record(c.step);
		const hint = classification && TYPE_HINTS[classification.documentType];
		if (hint)
			system += `\n\nThis document was classified as ${classification?.documentType}. ${hint}`;
	}

	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: system },
		{ role: "user", content: document },
	];

	for (let turn = steps.length + 1; turn <= maxTurns; turn++) {
		const t0 = performance.now();
		const res = await complete({ messages, tools: toolDefs });
		const msg = res.choices[0]?.message;
		if (!msg) return done(false, null, "model returned no message");

		const step = stepFrom(res, turn, "extract", performance.now() - t0);
		messages.push(msg);

		const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
		if (!calls.length) {
			record(step);
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
			// Lookup budget: small models re-query an unfindable inland place until the
			// turn limit (seen on real documents), losing the whole extraction.
			if (
				trace.name === "lookup_port" &&
				!trace.isError &&
				!(trace.output as { matches: unknown[] }).matches.length &&
				++lookupMisses >= MAX_LOOKUP_MISSES
			) {
				trace.output = {
					matches: [],
					stop: `${lookupMisses} searches without a match. Stop searching: set the unmatched port to null, mention the place in notes, and call submit_extraction.`,
				};
			}
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
		record(step);
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
