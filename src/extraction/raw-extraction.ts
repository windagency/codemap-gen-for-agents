import type { RawCallCandidate } from "src/core/types";

// The two language-neutral rules every Parser (TS Compiler API and tree-sitter alike) applies to
// its raw output, kept in one place so Symbol ids and candidate order can't drift per language.

// A repeated name in one file (an overload, a declaration-merging collision, a same-named item in
// two Rust `impl` blocks) gets a `#2`/`#3`... suffix by source order. Its Symbol id is
// `${filePath}#${localId}`.
export function withLocalIds<Declared extends { name: string }>(
	declared: Declared[],
): (Declared & { localId: string })[] {
	const seenCounts = new Map<string, number>();
	return declared.map((item) => {
		const seenCount = (seenCounts.get(item.name) ?? 0) + 1;
		seenCounts.set(item.name, seenCount);
		const localId = seenCount === 1 ? item.name : `${item.name}#${seenCount}`;
		return { ...item, localId };
	});
}

function candidateSortKey(candidate: RawCallCandidate): string {
	return `${candidate.filePath}#${candidate.localId}`;
}

// Same-target dedup (a call site can reach one candidate through more than one resolution path)
// followed by a stable sort by eventual Symbol id, so golden-fixture comparison never flakes on
// candidate order.
export function dedupeAndSortCandidates(candidates: RawCallCandidate[]): RawCallCandidate[] {
	const byKey = new Map(candidates.map((candidate) => [candidateSortKey(candidate), candidate]));
	return [...byKey.keys()].sort().flatMap((key) => {
		const candidate = byKey.get(key);
		return candidate ? [candidate] : [];
	});
}
