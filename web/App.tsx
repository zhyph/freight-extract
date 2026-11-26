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
		import.meta.glob<Recording>("./traces/*.json", {
			import: "default",
			eager: true,
		}),
	).map((r) => [r.id, r]),
);
const LIVE = import.meta.env.DEV;
const REPLAY_STEP_MS = 700;

export function App() {
	const [sampleId, setSampleId] = useState(Object.keys(samples)[0] ?? "");
	const [text, setText] = useState(samples[sampleId] ?? "");
	const [result, setResult] = useState<AgentResult | null>(null);
	const [source, setSource] = useState("");
	const [shown, setShown] = useState(0);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState("");

	// Replay reveals one turn at a time; live results show at once.
	useEffect(() => {
		if (!result || shown >= result.steps.length) return;
		const t = setTimeout(() => setShown((n) => n + 1), REPLAY_STEP_MS);
		return () => clearTimeout(t);
	}, [result, shown]);

	const reset = () => {
		setResult(null);
		setError("");
	};

	const pickSample = (id: string) => {
		setSampleId(id);
		setText(samples[id] ?? "");
		reset();
	};

	const replay = () => {
		const rec = recordings[sampleId];
		if (!rec) return;
		setText(rec.input);
		setError("");
		setSource(
			`replay · ${rec.model} · recorded ${rec.recordedAt.slice(0, 10)}`,
		);
		setShown(0);
		setResult(rec.result);
	};

	const runLive = async () => {
		reset();
		setRunning(true);
		try {
			const res = await fetch("/api/extract", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			setSource("live");
			setShown(Number.POSITIVE_INFINITY);
			setResult(body);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setRunning(false);
		}
	};

	const upload = async (file: File | undefined) => {
		if (!file) return;
		setSampleId("");
		setText(await file.text());
		reset();
	};

	const finished = result && shown >= result.steps.length;
	const steps = result?.steps.slice(0, shown) ?? [];

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
				<label>
					Sample
					<select value={sampleId} onChange={(e) => pickSample(e.target.value)}>
						{sampleId === "" && <option value="">(uploaded file)</option>}
						{Object.keys(samples).map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</select>
				</label>
				<label className="file">
					Upload .txt
					<input
						type="file"
						accept=".txt,.eml,text/plain"
						onChange={(e) => upload(e.target.files?.[0])}
					/>
				</label>
				<span className="spacer" />
				<button
					type="button"
					onClick={replay}
					disabled={!recordings[sampleId] || running}
				>
					Replay recorded run
				</button>
				<button
					type="button"
					className="primary"
					onClick={runLive}
					disabled={!LIVE || running || !text.trim()}
					title={
						LIVE
							? undefined
							: "Live mode runs against a local model: clone the repo and npm run dev"
					}
				>
					{running ? "Extracting..." : "Run live"}
				</button>
			</div>

			<section className="panes">
				<div className="pane">
					<h2>Input</h2>
					<textarea
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							reset();
						}}
						spellCheck={false}
						aria-label="Document text"
					/>
				</div>
				<div className="pane">
					<h2>Extracted JSON</h2>
					{running && (
						<p className="muted">
							Running on the local model. A small model on a consumer GPU takes
							30-90 s.
						</p>
					)}
					{error && <p className="error">{error}</p>}
					{!result && !running && !error && (
						<p className="muted">Replay a recorded run or run live.</p>
					)}
					{result && !finished && <p className="muted">Agent working...</p>}
					{result && finished && <Summary result={result} source={source} />}
					{result && finished && (
						<pre className="json">{JSON.stringify(result.data, null, 2)}</pre>
					)}
				</div>
			</section>

			{steps.length > 0 && (
				<section>
					<h2>Agent trace</h2>
					<ol className="trace">
						{steps.map((s) => (
							<StepCard key={s.turn} step={s} />
						))}
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
			<span className={`pill ${result.ok ? "ok" : "bad"}`}>
				{result.ok ? "Valid" : "Failed"}
			</span>
			<span>{result.steps.length} turns</span>
			<span>
				{result.validationFailures} validation{" "}
				{result.validationFailures === 1 ? "retry" : "retries"}
			</span>
			<span>{(result.totalMs / 1000).toFixed(1)} s</span>
			{tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
			<span className="muted">{source}</span>
			{result.error && <p className="error">{result.error}</p>}
		</div>
	);
}

function StepCard({ step }: { step: Step }) {
	return (
		<li className="step">
			<div className="step-head">
				<strong>Turn {step.turn}</strong>
				<span className="muted">
					{(step.ms / 1000).toFixed(1)} s
					{step.tokens &&
						` · ${step.tokens.prompt} in / ${step.tokens.completion} out`}
				</span>
			</div>
			{step.reasoning && (
				<details>
					<summary>Model reasoning</summary>
					<p className="reasoning">{step.reasoning}</p>
				</details>
			)}
			{step.text && <p>{step.text}</p>}
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
	const label = submit
		? call.isError
			? "rejected, errors sent back to the model"
			: "accepted"
		: call.isError
			? "error"
			: "";
	return (
		<div className={`call ${call.isError ? "bad" : submit ? "ok" : ""}`}>
			<div className="call-head">
				<code>{call.name}</code>
				{label && <span>{label}</span>}
			</div>
			<div className="call-io">
				<details open={!submit}>
					<summary>input</summary>
					<pre>{JSON.stringify(call.input, null, 2)}</pre>
				</details>
				<details open>
					<summary>result</summary>
					<pre>{JSON.stringify(call.output, null, 2)}</pre>
				</details>
			</div>
		</div>
	);
}
