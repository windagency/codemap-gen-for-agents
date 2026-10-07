import { runEntrypoint } from "src/integration/run-entrypoint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("runEntrypoint", () => {
	let stderr: ReturnType<typeof vi.spyOn>;
	let stdout: ReturnType<typeof vi.spyOn>;
	let exit: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		stdout = vi.spyOn(console, "log").mockImplementation(() => {});
		exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prints the result as JSON on success", () => {
		runEntrypoint(() => ({ ok: true }));

		expect(stdout).toHaveBeenCalledWith('{"ok":true}');
		expect(exit).not.toHaveBeenCalled();
	});

	it("logs a failure with a runId and the caller's context, then exits 1", () => {
		runEntrypoint(
			() => {
				throw new Error("Unknown flag --bogus");
			},
			{ subcommand: "generate" },
		);

		const entry = JSON.parse(stderr.mock.calls[0]?.[0] as string);
		expect(entry).toMatchObject({
			level: "error",
			message: "Unknown flag --bogus",
			subcommand: "generate",
			runId: expect.any(String),
		});
		expect(exit).toHaveBeenCalledWith(1);
	});
});
