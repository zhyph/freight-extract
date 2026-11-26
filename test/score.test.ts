import { describe, expect, it } from "vitest";
import { parseDate, parseNumber, parseWeightKg } from "../src/baseline.ts";
import { scoreFields } from "../src/score.ts";

describe("scoreFields", () => {
	it("scores names by substring, numbers within 1%, nulls exactly", () => {
		const expected = { a: { name: "Acme Trading" }, w: 1000, d: null, e: null };
		const actual = {
			a: { name: "ACME TRADING LTDA." },
			w: 1009,
			d: null,
			e: "2026-01-01",
		};
		expect(scoreFields(expected, actual)).toEqual({
			hit: 3,
			total: 4,
			misses: ['e: expected null, got "2026-01-01"'],
		});
	});
	it("never matches an empty string against a name", () => {
		expect(scoreFields({ n: "x" }, { n: "" }).hit).toBe(0);
		expect(scoreFields({ n: "x" }, null).hit).toBe(0);
	});
});

describe("baseline parsers", () => {
	it.each([
		["1.950,00 EUR", 1950],
		["2,580.00", 2580],
		["31.400 kg", 31400],
		["11 ,340 KGS", 11340],
		["58.2 CBM", 58.2],
		["none", null],
	])("parseNumber(%s)", (s, n) => expect(parseNumber(s)).toBe(n));

	it("converts weights", () => {
		expect(parseWeightKg("63,840 LBS")).toBe(28957);
		expect(parseWeightKg("100 toneladas")).toBe(100000);
	});

	it.each([
		["2026-10-08", "2026-10-08"],
		["20-NOV-2026", "2026-11-20"],
		["14/11/2026", "2026-11-14"],
		["11/24/2026", "2026-11-24"],
		["05/12/2026", "2026-12-05"],
		["soon", null],
	])("parseDate(%s)", (s, d) => expect(parseDate(s)).toBe(d));
});
