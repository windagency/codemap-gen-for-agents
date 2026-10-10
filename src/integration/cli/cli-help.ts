export const CLI_USAGE =
	"Usage: codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests] [--scip-index <language>=<path>]";

export const CLI_HELP = `${CLI_USAGE}

Generates codemap.json and codemap.html for the repo at --root.

Options:
  --root <dir>      Repo root to analyse (default: current directory)
  --out <dir>       Output directory (default: .codemap, or the config's outDir)
  --config <path>   Config file path (default: <root>/codemap.config.json)
  --force           Skip the incremental cache and re-extract every file
  --include-tests   Include test files in discovery and Module clustering
  --scip-index <language>=<path>
                    SCIP index refining that language's call targets (python only,
                    repeatable per language; default: <root>/index.scip if present)
  -h, --help        Show this help and exit`;
