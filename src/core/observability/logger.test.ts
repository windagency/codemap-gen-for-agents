import {
	createConsoleLogger,
	createNullLogger,
	currentLogContext,
	withLogContext,
} from "src/core/observability/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createConsoleLogger", () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		stderrSpy.mockRestore();
	});

	it("writes a structured JSON line to stderr for each level", () => {
		const logger = createConsoleLogger();

		logger.info("pipeline started", { rootDir: "/repo" });

		expect(stderrSpy).toHaveBeenCalledTimes(1);
		const entry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
		expect(entry).toMatchObject({
			level: "info",
			message: "pipeline started",
			rootDir: "/repo",
		});
		expect(typeof entry.timestamp).toBe("string");
	});

	it("supports debug/warn/error without a context", () => {
		const logger = createConsoleLogger();

		logger.debug("a");
		logger.warn("b");
		logger.error("c");

		expect(stderrSpy).toHaveBeenCalledTimes(3);
		const levels = stderrSpy.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string).level);
		expect(levels).toEqual(["debug", "warn", "error"]);
	});
});

describe("withLogContext", () => {
	it("adds its context to every console line written inside it, nested contexts merged", () => {
		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = createConsoleLogger();

		withLogContext({ runId: "r1" }, () => withLogContext({ tool: "read" }, () => logger.info("inside", { n: 1 })));
		logger.info("outside");

		const entries = stderrSpy.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string));
		expect(entries[0]).toMatchObject({ runId: "r1", tool: "read", n: 1 });
		expect(entries[1]).not.toHaveProperty("runId");
		stderrSpy.mockRestore();
	});

	it("returns the callback's value and restores the outer context afterwards", () => {
		const result = withLogContext({ runId: "r2" }, () => currentLogContext());

		expect(result).toStrictEqual({ runId: "r2" });
		expect(currentLogContext()).toStrictEqual({});
	});
});

describe("createNullLogger", () => {
	it("never writes to stderr", () => {
		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = createNullLogger();

		logger.debug("a");
		logger.info("b");
		logger.warn("c");
		logger.error("d");

		expect(stderrSpy).not.toHaveBeenCalled();
		stderrSpy.mockRestore();
	});
});
