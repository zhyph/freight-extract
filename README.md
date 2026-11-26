# Freight Extract

Turns messy freight documents (invoices, booking confirmations, OCR'd bills of lading, email threads, a Portuguese quote) into validated JSON, using a small local LLM in a tool-calling loop.

- **Agent loop** (`src/agent.ts`): the model calls `lookup_port` (UN/LOCODE table) and `convert_currency` (fixed rates) as it needs them, then `submit_extraction`.
- **Structured pipeline** (`src/schema.ts`): every submission goes through a Zod schema with business rules that JSON Schema can't express. Arrival must come after departure, net weight must be at most gross, charges must add up to the total, `totalUsd` must match the rates table, and port codes must exist. Failures go back to the model as tool errors, and it retries.
- **Trace UI** (`web/`): input, extracted JSON, and every turn with the model's reasoning, tool inputs and outputs, and rejected or accepted submissions.

## Results

`npm run eval` on 5 hand-written sample documents, with `qwen3.5:4b` (16k context) on an RTX 4060 Ti: 62/62 fields correct, 1 validation retry in total, about 45 s per document.

Read that as a smoke test, not an accuracy figure. The samples, their expected answers and the system prompt were written together, and several prompt rules target traps in these exact documents: DD/MM vs MM/DD dates, `31.400 kg` in German number format, weights in pounds, a quoted older rate in an email thread, OCR errors (`11.32O,00`), and a transit time instead of an arrival date. A real accuracy number needs documents written after the prompt was frozen, ideally by someone else.

## Run it

Needs Node 22+ and [Ollama](https://ollama.com).

```sh
npm install
ollama pull qwen3.5:4b
ollama create freight-qwen -f Modelfile   # same model with a 16k context window
npm run dev                               # http://localhost:5173
npm test                                  # unit tests, no model needed
npm run eval                              # live eval; also re-records the replay traces
```

The Modelfile matters. Ollama defaults to a 4k context and silently drops the start of longer conversations. That was already happening on the simplest sample.

Any OpenAI-compatible endpoint works, including free hosted tiers:

```sh
LLM_BASE_URL=https://api.groq.com/openai/v1 LLM_API_KEY=... LLM_MODEL=<model> npm run dev
```

## Hosted demo

`npm run build` produces a static site with replay only: recorded runs from `web/traces/` play back turn by turn. It never calls a model, so it can be hosted for free (GitHub Pages, Cloudflare Pages). Live mode only exists under `npm run dev`.

## Tests

`test/agent.test.ts` drives the loop with scripted model replies:
- the happy path
- a business-rule rejection whose error text must reach the model and be fixed on retry
- giving up after repeated failures
- nudging the model when it answers without a tool call
- tool errors returned to the model instead of thrown

`test/schema.test.ts` covers each business rule and both tools.
