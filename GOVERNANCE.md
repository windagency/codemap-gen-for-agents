# Governance

[Back to README.md](README.md)

This project is run BDFL-style: one maintainer has final say on every decision - design, what gets merged, when a release ships. See [`MAINTAINERS.md`](MAINTAINERS.md) for who that is and response-time expectations.

There is a documented path to co-maintainer status (below), and issues use public voting to help decide what to prioritise - but neither changes who has final say. This file can be revisited once there's more than one active maintainer; until then, treat it as the BDFL model with the surrounding process spelled out.

## Day-to-day decisions

Most changes - bug fixes, small features, refactors that don't change a public interface - go straight through the normal PR flow in [`CONTRIBUTING.md`](CONTRIBUTING.md): open a PR, pass the definition of done, get it reviewed, merge. No proposal step required.

## When a change needs an ADR first

A change needs a written [ADR](documentation/adr/) *before* (or as part of) the implementing PR, not after, when it does any of the following:

- Changes the public interface contract: CLI flags, MCP tool shapes, the `codemap.json` schema, or the Skill's contract (see ADR-0004).
- Changes one of the pipeline seams - Discovery, Parser, GraphBuilder, ModuleDetector, or one of the three adapters (see ADR-0003).
- Is a breaking change under [`CODING_RULES/10-commits-and-versioning.md`](CODING_RULES/10-commits-and-versioning.md)'s SemVer rules.
- Reverses or materially amends an existing ADR.
- Isn't cheaply reversible once merged (a data format change existing `.codemap/` output would need to migrate away from, for example).

To propose one: open an issue describing the problem and the direction, tag it `proposal`, and let it sit for discussion. Once the direction is settled, add the ADR to `documentation/adr/` (follow the numbering and structure of an existing one, e.g. [ADR-0027](documentation/adr/0027-tree-sitter-multi-language-extraction.md)) in the same PR as the implementation, or as a PR of its own first if the change is large enough to want sign-off before any code is written. The maintainer decides whether discussion has converged enough to proceed - there is no vote and no quorum.

Everything else in `documentation/adr/` is a record of a decision already made, not a gate other contributors need to clear - only the categories above require one in advance.

## Prioritisation: issue voting

Anyone can signal what they want built next by reacting 👍 on the relevant issue (GitHub's own reaction count, sorted via the "Most reactions" issue list sort - no separate tool or form). This is read as a signal of demand, not a binding vote: the maintainer still decides what actually gets worked on next, weighing it against complexity, maintenance burden, and fit with the project's direction. A low-reaction issue a maintainer considers important can still jump the queue; a high-reaction one that conflicts with the project's scope can still be declined.

## Becoming a co-maintainer

There's no fixed timeline, but the bar is:

- A track record of multiple merged PRs, across more than one area of the codebase (not repeated small fixes to the same file).
- Contributions that hold up against [`CODING_RULES/09-enforcement.md`](CODING_RULES/09-enforcement.md)'s severity table without heavy rework in review.
- Demonstrated judgement on when an ADR is needed (the section above) without being told, on at least one PR.
- Being responsive enough in review threads that a second maintainer would reduce the bottleneck MAINTAINERS.md already names, not add to it.

If you think you meet this, say so on an issue or PR rather than waiting to be asked - the current maintainer will make the call and, if granted, update [`MAINTAINERS.md`](MAINTAINERS.md) and `.github/CODEOWNERS` in the same PR that grants access.

## Code of Conduct

Governed separately by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md); violations are handled per that file's Enforcement section, independent of the technical decisions this file covers.
