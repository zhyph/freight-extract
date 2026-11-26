// Builds src/data/ports.json from the UN/LOCODE code list (seaports only).
// Source: https://github.com/datasets/un-locode (data/code-list.csv)
// Usage: node scripts/build-ports.mjs path/to/code-list.csv
import { readFileSync, writeFileSync } from "node:fs";

const splitCsv = (line) => {
	const out = [];
	let cur = "";
	let quoted = false;
	for (const ch of line) {
		if (ch === '"') quoted = !quoted;
		else if (ch === "," && !quoted) {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out;
};

const ports = new Map();
for (const line of readFileSync(process.argv[2], "utf8").split("\n").slice(1)) {
	const [change, country, location, , name, , , fn] = splitCsv(line);
	if (!location || change === "X" || fn?.[0] !== "1") continue;
	const code = country + location;
	const entry = ports.get(code) ?? { code, country, names: [] };
	if (!entry.names.includes(name)) entry.names.push(name);
	ports.set(code, entry);
}
const rows = [...ports.values()].map((p) => [p.code, p.country, ...p.names]);
writeFileSync("src/data/ports.json", JSON.stringify(rows));
console.log(`${rows.length} ports`);
