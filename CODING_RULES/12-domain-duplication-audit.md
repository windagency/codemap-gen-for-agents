# Domain Duplication Audit

[Back to 01-principles.md](01-principles.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0011-exclude-test-files-by-default.md](../documentation/adr/0011-exclude-test-files-by-default.md)

Load when asked to find duplicated concerns across sibling directories or contexts, or to produce a refactoring narrative for them.

## The trap this exists to avoid

Structural similarity is not evidence of duplication. Two implementations that look alike can be the same domain concept reimplemented twice, which is a bug, or they can be a false cognate: the same word meaning two different things in two different bounded contexts, which is correct design. Flattening both cases into "N×M duplication, extract a shared function" produces a refactor that couples two contexts that were supposed to stay independent. The test that tells them apart is DDD's **ubiquitous language**: does the term carry the same invariants, lifecycle, and business rules in both places, according to how each context's domain experts actually use it? If yes, it's one concept. If no, it's two concepts that happen to share a name.

Sibling directories (`api/v1`, `v2`, `v3`; a folder per subdomain; a service per team) are usually standing in as bounded contexts, whether or not anyone labelled them that.

## Procedure

1. **Scope the comparison.** Compare true siblings - subfolders under the same parent that represent parallel versions or parallel subdomains (`api/*/`, `services/*/`). Don't compare unrelated top-level modules; `frontend/` and `backend/` were never meant to share a model.
2. **Extract each sibling's concern taxonomy.** List the distinct domain concerns each one implements (order validation, discount calculation, permission check). Name each concern by its ubiquitous-language term, not by its file name - two differently-named files can be the same concern, and two identically-named files can be different concerns.
3. **For every concern name appearing in more than one sibling**, check three things by reading the actual logic, not just the shape:
   - Same invariants and rules?
   - Same lifecycle and trigger point?
   - Same meaning to the domain experts who use that term in each context?
4. **Classify the match:**
   - **True duplication** - same concept, same rules, independently reimplemented. A bug waiting to diverge.
   - **False cognate** - same word, different meaning per context. Correct as-is; document it so a future pass doesn't "fix" it.
   - **Legitimate context-specific variation** - same underlying concept, deliberately different rules because the business treats it differently there. Also correct as-is; name it so it isn't mistaken for the other two.

## Prioritising true duplicates for the narrative

Rank confirmed true duplicates by:
- **Reach** - number of siblings implementing it (M) × number of call sites (N). Higher reach ranks first.
- **Drift risk** - evidence the copies have already diverged (different edge-case handling, different validation messages). Already-drifting duplicates are causing bugs now, not just risk, and jump the queue.
- **Domain centrality** - a core business rule (pricing, eligibility, authorisation) outranks incidental plumbing (a shared date formatter).

## Resolving a true duplicate

- Contexts should stay independent, but this one concept is genuinely shared: extract a **Shared Kernel** - a small, explicitly owned module both contexts depend on, with a named owner and a change-coordination step called out in the PR. Don't let it grow past the one concern it was extracted for; a shared kernel that accretes unrelated logic recreates the coupling DDD was trying to avoid.
- One context is the real authority and the other holds a stale copy: add an **Anti-Corruption Layer** at the consumer's boundary instead of merging the models outright, so the consumer isn't coupled to the authority's internal representation.
- Either way, add an `arch-unit-ts` test (`04-architecture.md`) asserting the siblings depend on the shared module rather than reimplementing it, so the fix can't silently re-diverge.

## Narrative output format

One entry per true duplicate, ordered by priority:

```
### [Priority] Concern name

Found in: siblingA/path, siblingB/path, siblingC/path
Evidence: the shared rule/invariant that makes this one concept, not just similar code
Drift observed: yes/no - what's already diverged, if anything
Recommended fix: shared kernel | anti-corruption layer, and where it lands
```

List false cognates and legitimate variations separately and briefly, so the next audit doesn't re-flag them as bugs.
