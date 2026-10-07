# 0001: Module boundaries are detected algorithmically, not declared

[Back to documentation/adr/README.md](README.md) • [Back to HLD.md](../HLD.md) • [Back to LLD.md](../LLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

## Status

Accepted. The "static import/dependency graph, no other input" framing below is amended by documentation/adr/0007-folder-proximity-weighted-detection.md, which weights import edges exponentially by how folder-proximate their two files are, using each file's own path (already present on the graph). In practice this makes folder cohesion the dominant signal for codebases organized along directory lines - see 0007's Consequences for the resulting narrowing of this decision's original "no signal but the import graph" bet.

## Context

The code-map generator groups files into Modules (domain/bounded-context labels, see `CONTEXT.md`). The obvious alternative to detecting these automatically is letting a human or a config file declare them explicitly - the way most monorepo tools let you name a "domain" or "team boundary" directly.

We considered three approaches: a declared config file mapping directories to domain names, an LLM call that reads the code and proposes domain names/groupings, and a purely algorithmic approach (graph community detection over the static import graph, with no external input).

## Decision

Module detection is fully deterministic and algorithmic: it runs graph community detection over the codebase's static import/dependency graph, with no config file, no LLM call, and no human declaration involved. The same input code must produce the same Module grouping on every run. A file the algorithm can't confidently place is left unassigned rather than forced into the nearest cluster.

## Consequences

- The generator can run unattended (on-demand or in CI) without anyone maintaining a config file that drifts out of date as the codebase evolves.
- Output is reproducible and auditable: re-running on unchanged code always yields the same Modules, which the tool's golden-file and repeatability tests can verify directly.
- Module names/labels are themselves a downstream question (the algorithm produces groupings, not necessarily human-friendly names) - resolved separately, not by this decision.
- This forecloses, for this milestone, the more flexible case where a team wants to *assert* a domain boundary the import graph doesn't structurally reflect yet (e.g. a boundary they're migrating towards). That's accepted as a real limitation, not an oversight - revisiting it would mean loosening the "no config, no declaration" rule and is out of scope for this milestone.
