import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePackageJsonVersion } from "src/core/manifest-schema";
import { readPackageJson } from "src/core/read-package-json";

// Single shared source for the generator's own version - read once from this package's own
// `package.json` (never the target repo being scanned) via `readPackageJson`, so
// `generate-map.ts`'s cache epoch and `mcp/server.ts`'s McpServer registration can't drift out of
// sync the way two independently hand-kept "0.0.0" literals would.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const GENERATOR_VERSION: string = readPackageJson(packageRoot, parsePackageJsonVersion)?.version ?? "0.0.0";
