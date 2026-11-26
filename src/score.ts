const norm = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");

function leaves(obj: unknown, prefix = ""): [string, unknown][] {
	if (obj === null || typeof obj !== "object") return [[prefix, obj]];
	return Object.entries(obj).flatMap(([k, v]) =>
		leaves(v, prefix ? `${prefix}.${k}` : k),
	);
}

function get(obj: unknown, path: string): unknown {
	let cur = obj;
	for (const k of path.split(".")) {
		if (!cur || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[k];
	}
	return cur;
}

function matches(expected: unknown, actual: unknown) {
	if (typeof expected === "number" && typeof actual === "number") {
		return (
			Math.abs(expected - actual) <= Math.max(Math.abs(expected) * 0.01, 0.01)
		);
	}
	// Names: accept "Foo Ltda." for expected "Foo". An empty actual never matches.
	if (typeof expected === "string" && typeof actual === "string") {
		return norm(actual) !== "" && norm(actual).includes(norm(expected));
	}
	// null expected: the document lacks the value, so the extraction must too.
	if (expected === null) return actual === null || actual === undefined;
	return expected === actual;
}

// Scores every leaf of `expected` against the same path in `actual`.
export function scoreFields(expected: unknown, actual: unknown) {
	const misses: string[] = [];
	const fields = leaves(expected);
	for (const [path, exp] of fields) {
		const act = get(actual, path);
		if (!matches(exp, act)) {
			misses.push(
				`${path}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`,
			);
		}
	}
	return { hit: fields.length - misses.length, total: fields.length, misses };
}
