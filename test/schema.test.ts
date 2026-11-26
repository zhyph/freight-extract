import { describe, expect, it } from "vitest";
import { Extraction } from "../src/schema";
import { convertCurrency, lookupPort } from "../src/tools";

const base = {
	documentType: "quote",
	shipper: { name: "A", address: null, country: "BR" },
	consignee: { name: "B", address: null, country: "ES" },
	portOfLoading: { code: "BRPNG", name: "Paranagua" },
	portOfDischarge: { code: "ESVLC", name: "Valencia" },
	departureDate: "2026-12-05",
	arrivalDate: "2026-12-29",
	cargo: {
		description: "pulp",
		packages: 400,
		grossWeightKg: 100000,
		netWeightKg: null,
	},
	charges: [
		{ description: "freight", amount: 4600, currency: "EUR" },
		{ description: "bl", amount: 60, currency: "EUR" },
	],
	total: { amount: 4660, currency: "EUR" },
	totalUsd: 5079.4,
	notes: [],
};

const errorsFor = (patch: object) => {
	const r = Extraction.safeParse({ ...base, ...patch });
	return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("Extraction business rules", () => {
	it("accepts a consistent document", () => expect(errorsFor({})).toEqual([]));
	it("rejects arrival before departure", () =>
		expect(errorsFor({ arrivalDate: "2026-05-12" })).toEqual(["arrivalDate"]));
	it("rejects net weight above gross", () =>
		expect(
			errorsFor({ cargo: { ...base.cargo, netWeightKg: 100001 } }),
		).toEqual(["cargo.netWeightKg"]));
	it("rejects charges that do not add up to the total", () =>
		expect(
			errorsFor({ total: { amount: 4560, currency: "EUR" }, totalUsd: 4970.4 }),
		).toEqual(["total.amount"]));
	it("skips the sum check when charges mix currencies", () =>
		expect(
			errorsFor({
				charges: [
					...base.charges,
					{ description: "thc", amount: 3800, currency: "BRL" },
				],
			}),
		).toEqual([]));
	it("rejects a totalUsd that does not match the rates table", () =>
		expect(errorsFor({ totalUsd: 4660 })).toEqual(["totalUsd"]));
	it("rejects an unknown port code", () =>
		expect(errorsFor({ portOfLoading: { code: "BRXXX", name: "?" } })).toEqual([
			"portOfLoading.code",
		]));
	it("rejects a non-ISO currency", () =>
		expect(
			errorsFor({ total: { amount: 4660, currency: "EURO" }, totalUsd: null }),
		).toContain("total.currency"));
});

describe("tools", () => {
	it("finds ports by accented name, alias and code", () => {
		expect(lookupPort("Paranaguá").map((p) => p.code)).toEqual(["BRPNG"]);
		expect(lookupPort("Nhava Sheva").map((p) => p.code)).toEqual(["INNSA"]);
		expect(lookupPort("Port of Santos", "BR")[0]?.code).toBe("BRSSZ");
		expect(lookupPort("Valencia", "VE").map((p) => p.country)).not.toContain(
			"ES",
		);
		expect(lookupPort("Valencia", "ES")[0]?.code).toBe("ESVLC");
		expect(lookupPort("usnyc").map((p) => p.code)).toEqual(["USNYC"]);
		expect(lookupPort("Atlantis")).toEqual([]);
	});
	it("converts through USD with the fixed table", () => {
		expect(convertCurrency(4488, "EUR", "USD").amount).toBe(4891.92);
		expect(convertCurrency(100, "BRL", "EUR").amount).toBe(16.51);
	});
});
