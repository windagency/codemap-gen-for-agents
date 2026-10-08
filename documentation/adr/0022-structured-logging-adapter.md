# 0022: Structured logging adapter

[Back to 0056-scip-index-resolution-for-tree-sitter-languages.md](0056-scip-index-resolution-for-tree-sitter-languages.md) • [Back to documentation/adr/README.md](README.md)

## Status

Accepted.

## Context

A full standards review (see the repository's code-review history) found that no seam or command in the generator emits any log, metric, or trace - `14-observability.md`'s "instrument as you build" rule and `09-enforcement.md`'s HIGH-severity "no observability added for a new feature" line were violated repo-wide. Fixing this by threading a logger through every seam interface (`Parser`, `GraphBuilder`, `ModuleDetector`, `Transformer`, `Discovery`) would touch every implementation's constructor signature for a generator that is still a CLI/MCP tool run synchronously to completion, not a long-lived service - a disproportionate blast radius for the actual production questions that matter here: did a run complete, how big was the graph, what got skipped, was the cache used.

`09-enforcement.md` lists Pino/Winston as "recommended," explicitly noting "the practice is not optional; the specific package is." Pulling in a third-party logging dependency across the whole pipeline before any consumer has asked for structured shipping (to a file, a collector, etc.) is more commitment than the actual gap requires right now.

## Decision

A minimal `Logger` interface, `src/core/observability/logger.ts`, behind which any transport can sit later (per `04-architecture.md`'s third-party-isolation rule):

```ts
interface Logger {
	debug(message: string, context?: LogContext): void;
	info(message: string, context?: LogContext): void;
	warn(message: string, context?: LogContext): void;
	error(message: string, context?: LogContext): void;
}
```

`createConsoleLogger()` is the default implementation: one JSON line per call, to `stderr` (`console.error`), so `stdout` stays reserved for CLI/MCP JSON results a caller may pipe or parse. `createNullLogger()` is provided for tests that don't want log noise.

Logging is wired in at the **orchestration boundary** - `generate-map.ts`, `generate-command.ts`, `read-command.ts`, and the CLI/MCP entry points - rather than inside every pure seam implementation (`LouvainModuleDetector`, `DefaultGraphBuilder`, etc.), which stay pure and untouched. This answers the production questions ("did it run, how big, what broke, was cache hit") without changing any seam's public interface.

## Consequences

- Swapping the console transport for Pino/Winston/OpenTelemetry later means writing one new `Logger` implementation in this file; no call site elsewhere changes.
- Seam interfaces (`Parser`, `GraphBuilder`, `ModuleDetector`, `Transformer`, `Discovery`) are unchanged by this decision - they remain pure and untouched by logging concerns, by design.
- Log lines are unstructured-consumer-hostile in one sense: there is no correlation/trace ID propagation (`08-resilience.md`'s session-correlation guidance), since each CLI/MCP invocation is a single synchronous run with no retries or async boundaries to correlate across yet. Revisit if the MCP server ever serves concurrent long-running requests.

## Update: run correlation, stage timings, per-language counts

The MCP server now serves repeated requests in one process, the condition this record set for adding correlation. Every log line inside one run carries a `runId`, set once per CLI/Skill invocation (`run-entrypoint.ts`), per MCP tool call, and by `generateMap` itself when no caller set one. It travels through `withLogContext` (AsyncLocalStorage) so no seam interface changed.

`generateMap` logs `generate complete` with node/edge/warning counts, files and skipped files per language, and per-stage `durationsMs` (discover, parse, build, cluster, saveCache, transform, total). A failure logs `generate failed` with the stage it failed in before rethrowing. Each language's Parser is wrapped at the composition root (`withParseLogging`) to log `parse complete` with extracted/skipped counts and duration. Entry points import the logger through `core/compose.ts`, not directly, per ADR-0003's single-composition-root rule.
