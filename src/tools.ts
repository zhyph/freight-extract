import { z } from "zod";
import portRows from "./data/ports.json";

type Port = { code: string; name: string; country: string; aliases: string[] };

// Every UN/LOCODE location flagged as a seaport (17.5k). Rebuild with scripts/build-ports.mjs.
export const PORTS: Port[] = (portRows as string[][]).map(
	([code = "", country = "", name = "", ...aliases]) => ({
		code,
		country,
		name,
		aliases,
	}),
);
const BY_CODE = new Map(PORTS.map((p) => [p.code, p]));

export const RATES_DATE = "2026-11-01";
export const USD_PER_UNIT: Record<string, number> = {
	USD: 1,
	EUR: 1.09,
	BRL: 0.18,
	CAD: 0.72,
	JPY: 0.0066,
	CNY: 0.14,
	GBP: 1.28,
	CHF: 1.13,
	SGD: 0.75,
	KRW: 0.00072,
	INR: 0.012,
	MXN: 0.055,
	AUD: 0.66,
};

const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

export const findPortByCode = (code: string) =>
	BY_CODE.get(code.replace(/\s/g, "").toUpperCase());

// Exact name, then prefix, then substring. Optional country narrows ambiguous names (Valencia ES/VE).
export function lookupPort(query: string, country?: string) {
	const byCode = findPortByCode(query);
	if (byCode) return [byCode];
	const q = fold(query.replace(/^port of /i, ""));
	if (!q) return [];
	const scored: [number, Port][] = [];
	for (const p of PORTS) {
		if (country && p.country !== country.toUpperCase()) continue;
		let best = 0;
		for (const n of [p.name, ...p.aliases].map(fold)) {
			if (n === q) best = 3;
			else if (n.startsWith(q)) best = Math.max(best, 2);
			else if (n.includes(q)) best = Math.max(best, 1);
		}
		if (best) scored.push([best, p]);
	}
	return scored
		.sort((a, b) => b[0] - a[0])
		.slice(0, 5)
		.map(([, p]) => p);
}

export function convertCurrency(amount: number, from: string, to: string) {
	const f = USD_PER_UNIT[from.toUpperCase()];
	const t = USD_PER_UNIT[to.toUpperCase()];
	if (f === undefined || t === undefined) {
		throw new Error(
			`Unsupported currency. Supported: ${Object.keys(USD_PER_UNIT).join(", ")}`,
		);
	}
	return {
		amount: Math.round(((amount * f) / t) * 100) / 100,
		rate: f / t,
		rateDate: RATES_DATE,
	};
}

export const LookupPortInput = z.object({
	query: z
		.string()
		.min(1)
		.describe("Port city name or UN/LOCODE, e.g. 'Santos' or 'BRSSZ'"),
	country: z
		.string()
		.length(2)
		.optional()
		.describe("ISO 3166-1 alpha-2 country to narrow the search, e.g. ES"),
});

export const ConvertCurrencyInput = z.object({
	amount: z.number(),
	from: z.string().length(3).describe("ISO 4217 code"),
	to: z.string().length(3).describe("ISO 4217 code"),
});
