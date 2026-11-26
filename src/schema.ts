import { z } from "zod";
import { convertCurrency, findPortByCode } from "./tools.ts";

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

const Currency = z
	.string()
	.describe("ISO 4217 code, e.g. USD, EUR, BRL")
	.refine((c) => ISO_CURRENCIES.has(c), {
		message: "not an ISO 4217 currency code (use e.g. USD, EUR, BRL)",
	});

const IsoDate = z.iso.date().describe("YYYY-MM-DD");

const Party = z.object({
	name: z.string().min(1),
	address: z.string().nullable(),
	country: z
		.string()
		.length(2)
		.nullable()
		.describe("ISO 3166-1 alpha-2, e.g. BR"),
});

const Port = z.object({
	code: z
		.string()
		.describe("UN/LOCODE returned by lookup_port, e.g. BRSSZ")
		.refine((c) => findPortByCode(c), {
			message: "unknown UN/LOCODE; call lookup_port to get the code",
		}),
	name: z.string(),
});

export const DocumentType = z.enum([
	"invoice",
	"booking_confirmation",
	"bill_of_lading",
	"quote",
	"other",
]);

const Money = z.object({ amount: z.number(), currency: Currency });

export const Extraction = z
	.object({
		documentType: DocumentType,
		shipper: Party.nullable(),
		consignee: Party.nullable(),
		portOfLoading: Port.nullable(),
		portOfDischarge: Port.nullable(),
		departureDate: IsoDate.nullable(),
		arrivalDate: IsoDate.nullable(),
		cargo: z.object({
			description: z.string(),
			packages: z
				.number()
				.int()
				.nullable()
				.describe("number of packages/bags/cartons/crates"),
			grossWeightKg: z.number().positive().nullable(),
			netWeightKg: z.number().positive().nullable(),
		}),
		charges: z.array(
			z.object({
				description: z.string(),
				amount: z.number(),
				currency: Currency,
			}),
		),
		total: Money.nullable().describe(
			"the document's stated total, in its own currency",
		),
		totalUsd: z
			.number()
			.nullable()
			.describe("total converted with convert_currency; null if total is null"),
		notes: z
			.array(z.string())
			.describe("assumptions you made, e.g. how an ambiguous date was read"),
	})
	// Business rules JSON Schema can't express. These are what make the retry loop earn its keep.
	.superRefine((d, ctx) => {
		if (d.departureDate && d.arrivalDate && d.arrivalDate < d.departureDate) {
			ctx.addIssue({
				code: "custom",
				path: ["arrivalDate"],
				message: `arrival ${d.arrivalDate} is before departure ${d.departureDate}; re-check the date format (DD/MM vs MM/DD)`,
			});
		}
		const { grossWeightKg: gross, netWeightKg: net } = d.cargo;
		if (gross !== null && net !== null && net > gross) {
			ctx.addIssue({
				code: "custom",
				path: ["cargo", "netWeightKg"],
				message: `net weight ${net} kg exceeds gross ${gross} kg`,
			});
		}
		if (
			d.total &&
			d.charges.length &&
			d.charges.every((c) => c.currency === d.total?.currency)
		) {
			const sum = d.charges.reduce((s, c) => s + c.amount, 0);
			if (Math.abs(sum - d.total.amount) > 0.01) {
				ctx.addIssue({
					code: "custom",
					path: ["total", "amount"],
					message: `charges add up to ${sum.toFixed(2)} but total is ${d.total.amount}; check for missed or duplicated lines and number formats (1.950,00 = 1950.00)`,
				});
			}
		}
		if (!d.total && d.totalUsd !== null) {
			ctx.addIssue({
				code: "custom",
				path: ["totalUsd"],
				message: "totalUsd must be null when total is null",
			});
		}
		if (d.total && ISO_CURRENCIES.has(d.total.currency)) {
			let expected: number | null = null;
			try {
				expected = convertCurrency(
					d.total.amount,
					d.total.currency,
					"USD",
				).amount;
			} catch {
				// currency missing from the rates table; nothing to cross-check against
			}
			if (
				expected !== null &&
				(d.totalUsd === null ||
					Math.abs(d.totalUsd - expected) > Math.abs(expected) * 0.01)
			) {
				ctx.addIssue({
					code: "custom",
					path: ["totalUsd"],
					message: `totalUsd ${d.totalUsd} does not match the total converted to USD; call convert_currency`,
				});
			}
		}
	});

export type Extraction = z.infer<typeof Extraction>;
