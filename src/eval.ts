// Live eval: runs the agent on every sample, scores fields against *.expected.json,
// and records traces for the UI's replay mode. Usage: npm run eval [-- sample-prefix]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { openAICompatible, runAgent } from "./agent";

const SAMPLES = "samples";
const TRACES = "web/traces";
const model = process.env.LLM_MODEL ?? "freight-qwen";

const norm = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");

function leaves(obj: unknown, prefix = ""): [string, unknown][] {
	if (obj === null || typeof obj !== "object") return [[prefix, obj]];
	return Object.entries(obj).flatMap(([k, v]) =>
		leaves(v, prefix ? `${prefix}.${k}` : k),
	);
}

function get(obj: unknown, path: string): unknown {
	return path
		.split(".")
		.reduce<unknown>(
			(o, k) =>
				o && typeof o === "object"
					? (o as Record<string, unknown>)[k]
					: undefined,
			obj,
		);
}

function matches(expected: unknown, actual: unknown) {
	if (typeof expected === "number" && typeof actual === "number") {
		return (
			Math.abs(expected - actual) <= Math.max(Math.abs(expected) * 0.01, 0.01)
		);
	}
	// Names: accept "Foo Ltda." for expected "Foo".
	if (typeof expected === "string" && typeof actual === "string")
		return norm(actual).includes(norm(expected));
	return expected === actual;
}

mkdirSync(TRACES, { recursive: true });
const filter = process.argv[2] ?? "";
const complete = openAICompatible();
let hit = 0;
let total = 0;
let retries = 0;
let seconds = 0;
const files = readdirSync(SAMPLES).filter(
	(f) => f.endsWith(".txt") && f.startsWith(filter),
);

for (const file of files) {
	const id = file.replace(/\.txt$/, "");
	const input = readFileSync(`${SAMPLES}/${file}`, "utf8");
	const expected = JSON.parse(
		readFileSync(`${SAMPLES}/${id}.expected.json`, "utf8"),
	);
	const result = await runAgent(input, complete);
	writeFileSync(
		`${TRACES}/${id}.json`,
		JSON.stringify(
			{ id, model, recordedAt: new Date().toISOString(), input, result },
			null,
			2,
		),
	);

	const misses: string[] = [];
	let ok = 0;
	const fields = leaves(expected);
	for (const [path, exp] of fields) {
		const act = get(result.data, path);
		if (matches(exp, act)) ok++;
		else
			misses.push(
				`${path}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`,
			);
	}
	hit += ok;
	total += fields.length;
	retries += result.validationFailures;
	seconds += result.totalMs / 1000;
	console.log(
		`${result.ok ? "PASS" : "FAIL"} ${id}  ${ok}/${fields.length} fields  ${result.steps.length} turns  ${result.validationFailures} retries  ${(result.totalMs / 1000).toFixed(1)}s${result.error ? `  (${result.error})` : ""}`,
	);
	for (const m of misses) console.log(`     - ${m}`);
}

console.log(
	`\n${model}: field accuracy ${((hit / total) * 100).toFixed(1)}% (${hit}/${total}), ` +
		`${(retries / files.length).toFixed(2)} validation retries/doc, ${(seconds / files.length).toFixed(1)}s/doc`,
);
