# Freight Extract

Turns messy freight documents (invoices, booking confirmations, OCR'd bills of lading, email threads, quotes in Portuguese and Spanish) into validated JSON. It uses a small local LLM in a two-stage pipeline.

1. **Classify** (`src/agent.ts`): one call with thinking off and JSON-schema output picks the document type. That choice routes type-specific guidance into stage 2, for example "a bill of lading's shipped-on-board date is the departure".
2. **Extract** (`src/agent.ts`): a tool-calling loop.
   - The model calls `lookup_port` (all 17.5k UN/LOCODE seaports) and `convert_currency` (fixed rates) as it needs them, then `submit_extraction`.
   - The harness caps failed port lookups, so the model can't loop on an inland place that has no seaport code.
3. **Validate** (`src/schema.ts`): a Zod schema plus business rules that JSON Schema can't express:
   - arrival must come after departure
   - net weight must not exceed gross weight
   - charges must add up to the total
   - `totalUsd` must match the rates table
   - port codes must exist

   Errors, with the rejected value echoed back, return to the model as tool results, and it retries.
4. **Trace UI** (`web/`): the input, the extracted JSON, and a timeline of every turn. Each turn shows the model's reasoning and the tool inputs and outputs, with rejected submissions in red and accepted ones in green. Live runs stream turn by turn.

## Results

`qwen3.5:4b` (16k context, 3.6 GB VRAM) on an RTX 4060 Ti, scored field by field against hand-labelled JSON:

| Set                                                          | Agent                                    | NuExtract baseline          |
| ------------------------------------------------------------ | ---------------------------------------- | --------------------------- |
| Dev: 5 synthetic docs, written with the prompt               | 96.8% (60/62), 5/5 valid, 44 s/doc       | 87.1% (54/62), 3 s/doc      |
| **Held-out: 10 real docs, first run with the prompt frozen** | **67.9% (72/106), 7/10 valid, 42 s/doc** | **66.0% (70/106), 3 s/doc** |
| Held-out, after fixing what that run exposed                 | 80.2% (85/106), 10/10 valid, 42 s/doc    | (unchanged)                 |

How to read this:

- **The dev number is a smoke test.** The samples, labels and prompt were written together, and the prompt names their traps.
- **The bold row is the honest number.** Ten real documents, eight of them OCR'd scans, in English, Spanish and Chinese. They were collected and labelled independently, and the prompt was frozen before the first run (see `samples/holdout/SOURCES.md` and the git history).
- **Two bugs caused all three invalid outputs on that first run.** Neither was reading ability:
  - On two documents the model looped on `lookup_port` for an inland place (an inland container depot in Bangalore, and Durango in Mexico) until it ran out of turns.
  - On one document it double-quoted a correct date. Validation only said "Invalid ISO date", so it resubmitted the same value three times.
    Both are fixed (the lookup budget and errors that echo the value). The third row is no longer a held-out score: the fixes were found by looking at those documents.
- **The baseline** is the alternative design: one pass of [NuExtract](https://ollama.com/library/nuextract) (a 3.8B model tuned for extraction), then plain code for port lookup, unit, date and currency conversion (`src/baseline.ts`). On real documents it matches the agent's first run at about a fifteenth of the latency. After the fixes, the agent leads by 14 points, but on documents it has already seen. Whether that is worth 15x the time can only be settled on fresh documents.
- **Remaining errors** are mostly OCR-damaged names, confusing a delivery order with a bill of lading, date arithmetic (transit days), and US dates read as DD/MM.
- **A data finding:** in the current UN/LOCODE list, CNSHA is Shanghai Hongqiao airport and the port is CNSGH, though freight documents still write CNSHA.

## Run it

Needs Node 22+ and [Ollama](https://ollama.com).

```sh
npm install
ollama pull qwen3.5:4b && ollama create freight-qwen -f Modelfile   # 16k context
ollama pull nuextract                                               # baseline only
npm run dev                                       # http://localhost:5173
npm test                                          # unit tests, no model needed
npm run eval                                      # agent on dev + held-out
npm run eval -- --system baseline                 # NuExtract baseline
npm run eval -- --set holdout 03                  # one set, one document
```

- **The Modelfile matters.** Ollama defaults to a 4k context and silently drops the start of longer conversations. That was already happening on the simplest sample.
- **The classify call turns thinking off** (`reasoning_effort: "none"`). With thinking on, qwen3.5 once spent 16k tokens and nearly 5 minutes choosing between five labels.

Any OpenAI-compatible endpoint works for the agent, including free hosted tiers:

```sh
LLM_BASE_URL=https://api.groq.com/openai/v1 LLM_API_KEY=... LLM_MODEL=<model> npm run dev
```

## Held-out documents

`samples/holdout/SOURCES.md` lists where each document came from and every labelling judgement. Only 01-04 (from an MIT-licensed repo) are committed and included in the demo. The rest are git-ignored; fetch them from the listed URLs to reproduce the full held-out run.

## Hosted demo

`npm run build` produces a static, replay-only site. Recorded runs from `web/traces/` play back turn by turn, including the four licensed real documents. It never calls a model, so it can be hosted for free (GitHub Pages, Cloudflare Pages). Live mode only exists under `npm run dev`.

## Tests

`test/agent.test.ts` drives the pipeline with scripted model replies:

- the happy path, and routing on the classification
- falling back when the classification is unusable
- a business-rule rejection whose error text must reach the model and be fixed on retry
- validation errors that echo the rejected value
- the lookup budget
- giving up after repeated failures
- nudging the model when it answers without a tool call
- tool errors returned to the model instead of thrown

`test/schema.test.ts` covers each business rule and the tools. `test/score.test.ts` covers the eval scorer and the baseline's number and date parsers.
