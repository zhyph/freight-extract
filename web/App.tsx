import { useEffect, useState } from "react";
import type { AgentResult, Step, ToolCallTrace } from "../src/agent";

type Recording = {
	id: string;
	model: string;
	recordedAt: string;
	input: string;
	result: AgentResult;
};

const samples = Object.fromEntries(
	Object.entries(
		import.meta.glob<string>("../samples/*.txt", {
			query: "?raw",
			import: "default",
			eager: true,
		}),
	).map(([path, text]) => [
		path.split("/").pop()?.replace(".txt", "") ?? path,
		text,
	]),
);
const recordings: Record<string, Recording> = Object.fromEntries(
	Object.values(
		import.meta.glob<Recording>("./traces/**/*.json", {
			import: "default",
			eager: true,
		}),
	).map((r) => [r.id, r]),
);
// Real documents from the held-out eval set (MIT-licensed ones only) ship as recordings.
const realDocs = Object.fromEntries(
	Object.values(recordings)
		.filter((r) => r.id.startsWith("holdout/"))
		.map((r) => [r.id, r.input]),
);
const docs: Record<string, string> = { ...samples, ...realDocs };
const LIVE = import.meta.env.DEV;
const REPLAY_STEP_MS = 700;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function App() {
	const [sampleId, setSampleId] = useState(Object.keys(samples)[0] ?? "");
	const [text, setText] = useState(docs[sampleId] ?? "");
	const [steps, setSteps] = useState<Step[]>([]);
	const [result, setResult] = useState<AgentResult | null>(null);
	const [replaying, setReplaying] = useState<AgentResult | null>(null);
	const [source, setSource] = useState("");
	const [running, setRunning] = useState(false);
	const [error, setError] = useState("");

	// Replay reveals one recorded turn at a time, then the result.
	useEffect(() => {
		if (!replaying) return;
		if (steps.length >= replaying.steps.length) {
			setResult(replaying);
			setReplaying(null);
			return;
		}
		const t = setTimeout(
			() => setSteps(replaying.steps.slice(0, steps.length + 1)),
			REPLAY_STEP_MS,
		);
		return () => clearTimeout(t);
	}, [replaying, steps]);

	const reset = () => {
		setSteps([]);
		setResult(null);
		setReplaying(null);
		setError("");
	};

	const pickSample = (id: string) => {
		setSampleId(id);
		setText(docs[id] ?? "");
		reset();
	};

	const replay = () => {
		const rec = recordings[sampleId];
		if (!rec) return;
		reset();
		setText(rec.input);
		setSource(
			`Replay of a ${rec.model} run recorded ${rec.recordedAt.slice(0, 10)}`,
		);
		setReplaying(rec.result);
	};

	// The dev endpoint streams NDJSON: {step} per finished turn, then {result} or {error}.
	const runLive = async () => {
		reset();
		setRunning(true);
		setSource("Live run against the local model");
		try {
			const res = await fetch("/api/extract", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			});
			if (!res.ok || !res.body) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? res.statusText);
			}
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines.filter(Boolean)) {
					const msg = JSON.parse(line);
					if (msg.step) setSteps((s) => [...s, msg.step]);
					if (msg.result) setResult(msg.result);
					if (msg.error) throw new Error(msg.error);
				}
			}
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setRunning(false);
		}
	};

	const upload = async (input: HTMLInputElement) => {
		const file = input.files?.[0];
		if (!file) return;
		setSampleId("");
		setText(await file.text());
		reset();
		// Let the same file be picked again after editing the textarea.
		input.value = "";
	};

	const working = running || replaying !== null;
	const turn = steps.length + 1;
	const status = working
		? `Agent working on turn ${turn}${replaying ? ` of ${replaying.steps.length}` : ""}…`
		: result
			? `Extraction ${result.ok ? "valid" : "failed"} after ${result.steps.length} turns.`
			: "";

	return (
		<main>
			<header>
				<h1>Freight Extract</h1>
				<p>
					Messy freight document in, validated JSON out. A local LLM extracts
					the fields, calls tools for port codes and currency, and retries when
					business rules reject its answer.
				</p>
			</header>

			<div className="toolbar">
				<div className="toolbar-group">
					<label className="sample">
						Sample
						<select
							value={sampleId}
							onChange={(e) => pickSample(e.target.value)}
						>
							{sampleId === "" && <option value="">(uploaded file)</option>}
							<optgroup label="Synthetic samples">
								{Object.keys(samples).map((id) => (
									<option key={id} value={id}>
										{id}
									</option>
								))}
							</optgroup>
							{Object.keys(realDocs).length > 0 && (
								<optgroup label="Real documents (held-out eval)">
									{Object.keys(realDocs).map((id) => (
										<option key={id} value={id}>
											{id.replace("holdout/", "")}
										</option>
									))}
								</optgroup>
							)}
						</select>
					</label>
					<label className="button file">
						<input
							type="file"
							accept=".txt,.eml,text/plain"
							className="visually-hidden"
							onChange={(e) => upload(e.currentTarget)}
						/>
						Upload .txt
					</label>
				</div>
				<div className="toolbar-group">
					<button
						type="button"
						className="button"
						onClick={replay}
						disabled={!recordings[sampleId] || running}
					>
						Replay recorded run
					</button>
					<button
						type="button"
						className="button primary"
						onClick={runLive}
						disabled={!LIVE || running || !text.trim()}
						aria-describedby={LIVE ? undefined : "live-hint"}
					>
						{running ? "Extracting…" : "Run live"}
					</button>
				</div>
			</div>
			{!LIVE && (
				<p id="live-hint" className="hint">
					Run live needs a local model. Clone the repo and run{" "}
					<code>npm run dev</code>.
				</p>
			)}

			<div className="panes">
				<section className="pane" aria-labelledby="input-h">
					<h2 id="input-h">Input</h2>
					<textarea
						name="document"
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							reset();
						}}
						spellCheck={false}
						autoComplete="off"
						aria-labelledby="input-h"
					/>
				</section>
				<section className="pane" aria-labelledby="output-h">
					<h2 id="output-h">Extracted JSON</h2>
					{error && (
						<div className="error" role="alert">
							<p>
								<strong>Live run failed.</strong> {error}
							</p>
							<p>Check that the local model server is up, then run again.</p>
						</div>
					)}
					{!result && !working && !error && (
						<p className="muted">
							Pick a sample and replay its recorded run to watch the agent work.
						</p>
					)}
					<p
						className={result ? "visually-hidden" : "muted status"}
						role="status"
					>
						{status}
						{running && " A small local model takes about a minute."}
					</p>
					{result && (
						<div className="result">
							<Summary result={result} source={source} />
							<pre className="json" translate="no">
								{JSON.stringify(result.data, null, 2)}
							</pre>
						</div>
					)}
				</section>
			</div>

			{(steps.length > 0 || working) && (
				<section aria-labelledby="trace-h">
					<h2 id="trace-h">Agent trace</h2>
					<ol className="trace">
						{steps.map((s, i) => (
							<StepCard key={s.turn} step={s} previous={steps[i - 1]} />
						))}
						{working && (
							<li className="step" data-outcome="pending">
								<span className="node" aria-hidden="true" />
								<div className="step-head">
									<h3>Turn {turn}</h3>
									<span className="muted">Waiting for the model…</span>
								</div>
							</li>
						)}
					</ol>
				</section>
			)}
		</main>
	);
}

function Summary({ result, source }: { result: AgentResult; source: string }) {
	const tokens = result.steps.reduce(
		(n, s) => n + (s.tokens ? s.tokens.prompt + s.tokens.completion : 0),
		0,
	);
	return (
		<div className="summary">
			<span className={`badge ${result.ok ? "ok" : "bad"}`}>
				{result.ok ? "Valid" : "Failed"}
			</span>
			<dl className="metrics">
				<div>
					<dt>Turns</dt>
					<dd>{result.steps.length}</dd>
				</div>
				<div>
					<dt>Validation retries</dt>
					<dd>{result.validationFailures}</dd>
				</div>
				<div>
					<dt>Time</dt>
					<dd>{seconds(result.totalMs)}</dd>
				</div>
				{tokens > 0 && (
					<div>
						<dt>Tokens</dt>
						<dd>{tokens.toLocaleString()}</dd>
					</div>
				)}
			</dl>
			<p className="provenance">{source}</p>
			{result.error && <p className="error">{result.error}</p>}
		</div>
	);
}

const submitOf = (step: Step | undefined) =>
	step?.toolCalls.find((c) => c.name === "submit_extraction");

function StepCard({ step, previous }: { step: Step; previous?: Step }) {
	const submit = submitOf(step);
	const outcome = submit
		? submit.isError
			? "rejected"
			: "accepted"
		: step.toolCalls.some((c) => c.isError)
			? "error"
			: step.kind;
	const retry = submitOf(previous)?.isError === true;
	return (
		<li className="step" data-outcome={outcome}>
			<span className="node" aria-hidden="true" />
			<div className="step-head">
				<h3>Turn {step.turn}</h3>
				{step.kind === "classify" && <span className="tag">classify</span>}
				{retry && <span className="tag">retry after rejection</span>}
				<span className="step-meta">
					<span>{seconds(step.ms)}</span>
					{step.tokens && (
						<>
							<span>{step.tokens.prompt.toLocaleString()} in</span>
							<span>{step.tokens.completion.toLocaleString()} out</span>
						</>
					)}
				</span>
			</div>
			{step.reasoning && (
				<details>
					<summary>Model reasoning</summary>
					<p className="reasoning">{step.reasoning}</p>
				</details>
			)}
			{step.text && step.kind !== "classify" && (
				<p className="step-text">{step.text}</p>
			)}
			{step.toolCalls.length === 0 && (
				<p className="muted">No tool call. Agent nudged the model to submit.</p>
			)}
			{step.toolCalls.map((c, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: calls within a turn are fixed and ordered
				<ToolCall key={i} call={c} />
			))}
		</li>
	);
}

function ToolCall({ call }: { call: ToolCallTrace }) {
	const submit = call.name === "submit_extraction";
	const state = call.isError ? "bad" : submit ? "ok" : "";
	const label = submit
		? call.isError
			? "Rejected"
			: "Accepted"
		: call.isError
			? "Error"
			: "";
	return (
		<div className={`call ${state}`}>
			<div className="call-head">
				<code translate="no">{call.name}</code>
				{label && <span className={`badge ${state}`}>{label}</span>}
				{submit && call.isError && (
					<span className="call-note">Errors sent back to the model</span>
				)}
			</div>
			<div className="call-io">
				<details open={!submit}>
					<summary>Input</summary>
					<Value value={call.input} />
				</details>
				<details open>
					<summary>Result</summary>
					<Value value={call.output} />
				</details>
			</div>
		</div>
	);
}

// Plain strings (e.g. the "(document)" placeholder) read better without JSON quotes.
function Value({ value }: { value: unknown }) {
	return typeof value === "string" ? (
		<p className="muted value-text">{value}</p>
	) : (
		<pre translate="no">{JSON.stringify(value, null, 2)}</pre>
	);
}
