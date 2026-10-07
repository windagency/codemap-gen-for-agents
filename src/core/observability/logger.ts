import { AsyncLocalStorage } from "node:async_hooks";

// Structured logging adapter (documentation/adr/0022-structured-logging-adapter.md). Callers depend on
// this Logger interface, never on a concrete transport, per 04-architecture.md's third-party
// isolation rule - swapping the console-based default for Pino/Winston later touches only this
// file. Every line goes to stderr as JSON so stdout stays reserved for tool output (CLI/MCP JSON
// results) that consumers may pipe or parse.

export interface LogContext {
	[key: string]: unknown;
}

export interface Logger {
	debug(message: string, context?: LogContext): void;
	info(message: string, context?: LogContext): void;
	warn(message: string, context?: LogContext): void;
	error(message: string, context?: LogContext): void;
}

type LogLevel = "debug" | "info" | "warn" | "error";

// Fields every log line inside a `withLogContext` call carries, such as one run's `runId`, so a
// whole run can be reassembled from its lines (14-observability.md). Held in AsyncLocalStorage so
// no seam interface has to thread a logger or an id through.
const ambientContext = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(context: LogContext, run: () => T): T {
	return ambientContext.run({ ...currentLogContext(), ...context }, run);
}

export function currentLogContext(): LogContext {
	return ambientContext.getStore() ?? {};
}

function writeConsoleLog(level: LogLevel, message: string, context?: LogContext): void {
	const entry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...currentLogContext(),
		...(context ?? {}),
	};
	console.error(JSON.stringify(entry));
}

export function createConsoleLogger(): Logger {
	return {
		debug: (message, context) => writeConsoleLog("debug", message, context),
		info: (message, context) => writeConsoleLog("info", message, context),
		warn: (message, context) => writeConsoleLog("warn", message, context),
		error: (message, context) => writeConsoleLog("error", message, context),
	};
}

export function createNullLogger(): Logger {
	const noop = () => {};
	return { debug: noop, info: noop, warn: noop, error: noop };
}
