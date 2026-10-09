export const CLI_USAGE =
	"Usage: codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests] [--scip-index <language>=<path>] [--run-indexers]";

export const CLI_HELP = `${CLI_USAGE}

Generates codemap.json and codemap.html for the repo at --root.

Options:
  --root <dir>      Repo root to analyse (default: current directory)
  --out <dir>       Output directory (default: .codemap, or the config's outDir)
  --config <path>   Config file path (default: <root>/codemap.config.json)
  --force           Skip the incremental cache and re-extract every file
  --include-tests   Include test files in discovery and Module clustering
  --scip-index <language>=<path>
                    SCIP index refining that language's call targets (python, go, or
                    rust, repeatable per language; default: <root>/index.scip if present)
  --run-indexers    Run scip-python, scip-go, or rust-analyzer for each Python, Go,
                    or Rust Package with no supplied index, writing under <out>/scip/.
                    Runs the repo's own tooling: only use it on a repo you would build
                    yourself
  -h, --help        Show this help and exit`;
