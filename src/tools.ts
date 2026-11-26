import { z } from "zod";

// UN/LOCODE subset. ponytail: hardcoded table, swap for the full UNECE CSV if coverage matters.
export const PORTS: {
	code: string;
	name: string;
	country: string;
	aliases?: string[];
}[] = [
	{ code: "BRSSZ", name: "Santos", country: "BR" },
	{ code: "BRPNG", name: "Paranagua", country: "BR" },
	{ code: "BRITJ", name: "Itajai", country: "BR" },
	{ code: "BRRIG", name: "Rio Grande", country: "BR" },
	{ code: "BRRIO", name: "Rio de Janeiro", country: "BR" },
	{ code: "BRSUA", name: "Suape", country: "BR" },
	{ code: "ARBUE", name: "Buenos Aires", country: "AR" },
	{ code: "UYMVD", name: "Montevideo", country: "UY" },
	{ code: "CLSAI", name: "San Antonio", country: "CL" },
	{ code: "PECLL", name: "Callao", country: "PE" },
	{ code: "MXZLO", name: "Manzanillo", country: "MX" },
	{ code: "USLAX", name: "Los Angeles", country: "US", aliases: ["San Pedro"] },
	{ code: "USLGB", name: "Long Beach", country: "US" },
	{
		code: "USNYC",
		name: "New York",
		country: "US",
		aliases: ["Newark", "NY/NJ"],
	},
	{ code: "USHOU", name: "Houston", country: "US" },
	{ code: "USSAV", name: "Savannah", country: "US" },
	{ code: "CAVAN", name: "Vancouver", country: "CA" },
	{ code: "NLRTM", name: "Rotterdam", country: "NL" },
	{
		code: "BEANR",
		name: "Antwerp",
		country: "BE",
		aliases: ["Antwerpen", "Anvers"],
	},
	{ code: "DEHAM", name: "Hamburg", country: "DE" },
	{ code: "GBFXT", name: "Felixstowe", country: "GB" },
	{ code: "FRLEH", name: "Le Havre", country: "FR" },
	{ code: "ESVLC", name: "Valencia", country: "ES" },
	{ code: "ESALG", name: "Algeciras", country: "ES" },
	{ code: "PTSIE", name: "Sines", country: "PT" },
	{ code: "ITGOA", name: "Genoa", country: "IT", aliases: ["Genova"] },
	{ code: "AEJEA", name: "Jebel Ali", country: "AE", aliases: ["Dubai"] },
	{
		code: "INNSA",
		name: "Nhava Sheva",
		country: "IN",
		aliases: ["JNPT", "Mumbai"],
	},
	{ code: "SGSIN", name: "Singapore", country: "SG" },
	{ code: "MYPKG", name: "Port Klang", country: "MY" },
	{ code: "CNSHA", name: "Shanghai", country: "CN" },
	{ code: "CNNGB", name: "Ningbo", country: "CN" },
	{
		code: "CNSZX",
		name: "Shenzhen",
		country: "CN",
		aliases: ["Yantian", "Shekou"],
	},
	{ code: "HKHKG", name: "Hong Kong", country: "HK" },
	{ code: "TWKHH", name: "Kaohsiung", country: "TW" },
	{ code: "KRPUS", name: "Busan", country: "KR", aliases: ["Pusan"] },
	{ code: "JPYOK", name: "Yokohama", country: "JP" },
	{ code: "JPTYO", name: "Tokyo", country: "JP" },
	{ code: "AUMEL", name: "Melbourne", country: "AU" },
	{ code: "ZADUR", name: "Durban", country: "ZA" },
];

// USD value of one unit. Fixed snapshot so tests and evals are deterministic.
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
		.trim();

export const findPortByCode = (code: string) =>
	PORTS.find((p) => p.code === code.toUpperCase());

export function lookupPort(query: string) {
	const q = fold(query);
	const byCode = findPortByCode(query.replace(/\s/g, ""));
	if (byCode) return [byCode];
	return PORTS.filter((p) =>
		[p.name, ...(p.aliases ?? [])].some(
			(n) => fold(n).includes(q) || q.includes(fold(n)),
		),
	).slice(0, 5);
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
});

export const ConvertCurrencyInput = z.object({
	amount: z.number(),
	from: z.string().length(3).describe("ISO 4217 code"),
	to: z.string().length(3).describe("ISO 4217 code"),
});
