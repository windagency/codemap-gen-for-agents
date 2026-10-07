import crypto from "node:crypto";
import { createConsoleLogger, type LogContext, withLogContext } from "src/core/compose";

// A bad flag or malformed config throws a plain `Error` from deep inside `core/` (see
// `cli-args.ts`'s `parseSymbolKind`, `config.ts`'s `readConfigFile`) - caught here so the user
// sees one clean stderr line instead of a raw Node stack trace for something this ordinary.
// Every log line of one invocation, including this error line, carries the same `runId`.
export function runEntrypoint(run: () => unknown, context?: LogContext): void {
	withLogContext({ runId: crypto.randomUUID(), ...context }, () => {
		try {
			const result = run();
			console.log(JSON.stringify(result));
		} catch (error) {
			createConsoleLogger().error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});
}
