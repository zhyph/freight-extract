// Baseline for the eval: one pass of NuExtract (an extraction-tuned 3.8B model),
// then plain code for what the agent does with tools: port codes, units, dates, USD.
// Answers "is the agent loop worth its extra turns?"
import { convertCurrency, lookupPort } from "./tools.ts";

const TEMPLATE = {
	Shipper: { Name: "" },
	Consignee: { Name: "" },
	"Port of loading": "",
	"Port of discharge": "",
	"Departure date": "",
	"Arrival date": "",
	"Number of packages": "",
	"Gross weight": "",
	"Net weight": "",
	"Total amount": "",
	Currency: "",
};

const nonEmpty = (s: unknown) =>
	typeof s === "string" && s.trim() ? s.trim() : null;

// "1.950,00" -> 1950, "2,580.00" -> 2580, "31.400" -> 31400, "11 ,340" -> 11340.
// ponytail: a lone separator followed by exactly 3 digits is read as thousands, so "1.500" kg is 1500.
export function parseNumber(s: string | null): number | null {
	const m = s
		?.replace(/(\d)\s+(?=[\d.,])|(?<=[.,])\s+(?=\d)/g, "$1")
		.match(/\d[\d.,]*/);
	if (!m) return null;
	let t = m[0].replace(/[.,]$/, "");
	const lastDot = t.lastIndexOf(".");
	const lastComma = t.lastIndexOf(",");
	if (lastDot > -1 && lastComma > -1) {
		const dec = lastDot > lastComma ? "." : ",";
		t = t.replaceAll(dec === "." ? "," : ".", "").replace(dec, ".");
	} else {
		const sep = lastDot > -1 ? "." : ",";
		const parts = t.split(sep);
		const thousands = parts.length > 2 || parts[1]?.length === 3;
		t = thousands ? parts.join("") : parts.join(".");
	}
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
}

export function parseWeightKg(s: string | null): number | null {
	const n = parseNumber(s);
	if (n === null || !s) return null;
	if (/\blbs?\b|pounds?/i.test(s)) return Math.round(n * 0.45359237);
	if (/\b(t|tons?|tonnes?|toneladas?)\b/i.test(s)) return n * 1000;
	return n;
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const iso = (y: number, m: number, d: number) =>
	m >= 1 && m <= 12 && d >= 1 && d <= 31
		? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
		: null;

// ponytail: ambiguous D/M vs M/D defaults to D/M. The agent reasons from context instead.
export function parseDate(s: string | null): string | null {
	if (!s) return null;
	let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (m) {
		const [, y = "", mo = "", d = ""] = m;
		return iso(+y, +mo, +d);
	}
	m = s.match(/(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s,]+(\d{4})/i);
	if (m) {
		const [, d = "", mon = "", y = ""] = m;
		return iso(+y, MONTHS.indexOf(mon.toLowerCase()) + 1, +d);
	}
	m = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
	if (m) {
		const [, a = "", b = "", y = ""] = m;
		return +b > 12 ? iso(+y, +a, +b) : iso(+y, +b, +a);
	}
	return null;
}

function currencyOf(...hints: (string | null)[]): string | null {
	const text = hints.filter(Boolean).join(" ");
	const code = text.match(/\b[A-Z]{3}\b/)?.[0];
	if (code) return code;
	if (/R\$/.test(text)) return "BRL";
	if (/€/.test(text)) return "EUR";
	if (/£/.test(text)) return "GBP";
	if (/\$/.test(text)) return "USD";
	return null;
}

function documentType(text: string) {
	if (/booking confirmation/i.test(text)) return "booking_confirmation";
	if (/bill of lad|\bB\/L\b/i.test(text)) return "bill_of_lading";
	if (/invoice|fatura|factura|rechnung/i.test(text)) return "invoice";
	if (/quot|cota[cç][aã]o|cotizaci|offer|angebot/i.test(text)) return "quote";
	return "other";
}

const portCode = (s: string | null) =>
	s ? (lookupPort(s.split(/[,(]/)[0] ?? s)[0]?.code ?? null) : null;

// NuExtract needs its own prompt markers and stops on <|end-output|>, which Ollama's
// packaged chat template omits (it loops until Ollama aborts), so this uses raw generate.
export async function runBaseline(
	document: string,
	host = process.env.OLLAMA_HOST ?? "http://localhost:11434",
) {
	const started = performance.now();
	const res = await fetch(`${host}/api/generate`, {
		method: "POST",
		body: JSON.stringify({
			model: "nuextract",
			raw: true,
			stream: false,
			prompt: `<|input|>\n### Template:\n${JSON.stringify(TEMPLATE, null, 4)}\n### Text:\n${document}\n<|output|>\n`,
			options: {
				temperature: 0,
				num_ctx: 4096,
				num_predict: 800,
				stop: ["<|end-output|>"],
			},
		}),
	});
	if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
	const raw = ((await res.json()) as { response?: string }).response ?? "";
	let out: Record<string, unknown> = {};
	try {
		out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
	} catch {
		// unparseable: every field scores as missing
	}
	const f = (k: string) => nonEmpty(out[k]);
	const name = (k: string) => nonEmpty((out[k] as { Name?: unknown })?.Name);
	const amount = parseNumber(f("Total amount"));
	const currency = currencyOf(f("Currency"), f("Total amount"));
	let totalUsd: number | null = null;
	try {
		if (amount !== null && currency)
			totalUsd = convertCurrency(amount, currency, "USD").amount;
	} catch {
		// currency outside the rates table
	}
	const data = {
		documentType: documentType(document),
		shipper: { name: name("Shipper") },
		consignee: { name: name("Consignee") },
		portOfLoading: { code: portCode(f("Port of loading")) },
		portOfDischarge: { code: portCode(f("Port of discharge")) },
		departureDate: parseDate(f("Departure date")),
		arrivalDate: parseDate(f("Arrival date")),
		cargo: {
			packages: parseNumber(f("Number of packages")),
			grossWeightKg: parseWeightKg(f("Gross weight")),
			netWeightKg: parseWeightKg(f("Net weight")),
		},
		total: amount !== null ? { amount, currency } : null,
		totalUsd,
	};
	return { data, raw, totalMs: Math.round(performance.now() - started) };
}
