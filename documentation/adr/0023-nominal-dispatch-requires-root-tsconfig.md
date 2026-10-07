# 0023: Nominal dispatch resolves zero candidates without a root tsconfig.json

[Back to documentation/adr/README.md](README.md)

## Status

Accepted

## Context

The extraction spec's call-resolution decision (ticket 04) has ambiguous dispatch - a call whose resolved callee is an interface member or an abstract class's own abstract method - enumerate every concrete nominal implementor via a one-time, whole-program `NominalIndex` (`buildNominalIndex`, `src/extraction/ts-compiler-api/ts-compiler-api-parser.ts`), built once per `Parser.parse()` call and walked by `resolveContainerDispatchCandidates` from `resolveCallCandidates`.

That index can only be whole-program when there's a single `ts.Program` spanning every file to walk every class's `implements`/`extends` heritage clauses across the repo. `TsCompilerApiParser.parse` only ever gets one when `<rootDir>/tsconfig.json` exists (ticket 03's import-resolution decision, amending ADR-0003's Consequences: "`Parser` reads `<rootDir>/tsconfig.json` only... falling back to a fixed default `CompilerOptions` set for plain-JS repos"). With no root tsconfig - the plain-JS fallback path - each file instead gets its own separate per-file inferred project (`snapshot.getDefaultProjectForFile`), so there is no single Program left to index across. `buildNominalIndex(rootProject: Project | undefined)` already accounts for this: passed `undefined`, it returns an empty `NominalIndex` immediately rather than attempting a per-file substitute.

The practical effect: in a plain-JS repo (no root `tsconfig.json`), every ambiguous-dispatch call - one that resolves to an interface member or an abstract class's own abstract method - resolves to zero `RawCall.candidates`, even though the callee itself is perfectly traceable. `resolveContainerDispatchCandidates`'s `nominalCandidatesFor` lookup always misses (the index is empty for every symbol id), so its fallback branch (`[]` for an interface member, `[declaration]` for an abstract method) is what actually decides the outcome in that arm - and for the interface-member arm, that fallback is `[]`. This was previously recorded only in a source comment directly above `buildNominalIndex`, unlike this codebase's other deliberate limitations (ADR-0002's Update section, ADR-0017, ADR-0021), which all get their own ADR.

## Decision

Accept this as a deliberate, documented limitation, not something to fix here - the same shape of call ADR-0017 made for `ExternalNode` version dedup:

1. **The limitation is accepted for now.** With no root `tsconfig.json`, nominal ambiguous-dispatch resolution enumerates zero implementors; it never crashes or guesses, it simply has nothing to index.
2. **This is a direct, unavoidable consequence of ticket 03's own earlier decision**, not an independent bug: "no root tsconfig → per-file inferred project" was already an accepted limitation of the whole-program design (ADR-0003's "one `ts.Program` for the whole repo" requirement, reaffirmed in ADR-0002's Update section). Nominal dispatch simply inherits that gap; there was never a whole-program view available to build the index from in this mode.
3. **A real fix is deferred, not attempted here.** Making nominal dispatch work without a root tsconfig would mean synthesizing a whole-program view for plain-JS repos specifically for this one purpose - e.g. always opening one inferred multi-file project instead of per-file ones - which changes the scope of ticket 03's own "no root tsconfig → per-file inferred project" decision. That's a decision about `Parser`'s whole-program strategy, not a local tweak to `buildNominalIndex`, and deserves its own design rather than a silent side effect of a code-review pass.
4. **The scenario this narrows is genuinely rare.** A repo with no root `tsconfig.json` *and* genuine ambiguous nominal dispatch (an interface or abstract class implemented by more than one class, called through the abstract member) is a narrow intersection - plain-JS repos rarely lean on interface/abstract-class heritage chains at all. Direct calls, the overwhelming majority of any call graph, resolve correctly regardless: direct resolution (`resolveDeclarationNode` returning a concrete function/method) never touches `nominalIndex`.

## Consequences

- In a repo with no root `tsconfig.json`, any call whose resolved callee is an interface member produces `candidates: []` (dropped entirely, per the extraction spec's "no traceable declaration → drop" rule applying here too, even though the callee itself is traceable); a call to an abstract class's own abstract method instead falls back to `[declaration]` - the abstract declaration itself as the sole candidate - since that arm's fallback differs from the interface-member arm's.
- The code comment directly above `buildNominalIndex` in `src/extraction/ts-compiler-api/ts-compiler-api-parser.ts` now points at this ADR by path, so a future reader hits the documented tradeoff instead of independently rediscovering it.
- No fixture or golden-file test needs updating: every golden-file scenario spec.md names (including the ambiguous-call case) already assumes a fixture repo with a root `tsconfig.json`, since ticket 03's own decision already requires one for any multi-package import resolution to work at all - none of them exercise the no-root-tsconfig path.
- Anyone hitting this in practice - a plain-JS monorepo with real interface/abstract-class dispatch they want enumerated - should raise "give `Parser` a whole-program view without a root tsconfig" as its own piece of work, not patch around it locally in `buildNominalIndex`.
