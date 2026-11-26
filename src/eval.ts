// Live eval. Scores extracted fields against *.expected.json, per document set.
//   npm run eval                          agent on dev + holdout
//   npm run eval -- --system baseline     NuExtract single pass + code post-processing
//   npm run eval -- --set holdout 03      one set, files starting with "03"
// Agent runs on the dev set also re-record the replay traces in web/traces.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { defaultModel, openAICompatible, runAgent } from "./agent";
import { runBaseline } from "./baseline";
import { scoreFields } from "./score";

const SETS: Record<string, string> = {
	dev: "samples",
	holdout: "samples/holdout",
};
const { values, positionals } = parseArgs({
	options: {
		system: { type: "string", default: "agent" },
		set: { type: "string", default: "all" },
	},
	allowPositionals: true,
});
const system = values.system === "baseline" ? "baseline" : "agent";
const model = system === "baseline" ? "nuextract" : defaultModel();
const complete = openAICompatible(undefined, model); // unused by the baseline
const filter = positionals[0] ?? "";
const sets = (values.set === "all" ? Object.keys(SETS) : [values.set ?? ""])
	.map((name) => ({ name, dir: SETS[name] ?? "" }))
	.filter((s) => s.dir && existsSync(s.dir));

for (const { name: set, dir } of sets) {
	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".txt") && f.startsWith(filter),
	);
	if (!files.length) continue;
	let hit = 0;
	let total = 0;
	let retries = 0;
	let seconds = 0;
	let valid = 0;
	console.log(`\n== ${set} (${files.length} docs) · ${system} · ${model}`);

	for (const file of files) {
		const id = file.replace(/\.txt$/, "");
		const input = readFileSync(`${dir}/${file}`, "utf8");
		const expected = JSON.parse(
			readFileSync(`${dir}/${id}.expected.json`, "utf8"),
		);
		let data: unknown;
		let line: string;
		if (system === "agent") {
			const result = await runAgent(input, complete);
			if (set === "dev") {
				const recording = {
					id,
					model,
					recordedAt: new Date().toISOString(),
					input,
					result,
				};
				writeFileSync(
					`web/traces/${id}.json`,
					`${JSON.stringify(recording, null, 2)}\n`,
				);
			}
			data = result.data;
			retries += result.validationFailures;
			seconds += result.totalMs / 1000;
			if (result.ok) valid++;
			line = `${result.ok ? "valid  " : "INVALID"} ${result.steps.length} turns, ${result.validationFailures} retries, ${(result.totalMs / 1000).toFixed(1)}s${result.error ? ` (${result.error})` : ""}`;
		} else {
			const result = await runBaseline(input);
			data = result.data;
			seconds += result.totalMs / 1000;
			line = `${(result.totalMs / 1000).toFixed(1)}s`;
		}
		const score = scoreFields(expected, data);
		hit += score.hit;
		total += score.total;
		console.log(`${id}  ${score.hit}/${score.total} fields  ${line}`);
		for (const m of score.misses) console.log(`     - ${m}`);
	}

	const n = files.length;
	const agentStats =
		system === "agent"
			? `, ${valid}/${n} valid, ${(retries / n).toFixed(2)} retries/doc`
			: "";
	console.log(
		`-- ${set}: field accuracy ${((hit / total) * 100).toFixed(1)}% (${hit}/${total}), ${(seconds / n).toFixed(1)}s/doc${agentStats}`,
	);
}
