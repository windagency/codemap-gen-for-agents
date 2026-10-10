export const SKILL_USAGE =
	"Usage: skillEntry <generate|read> [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests] [--scip-index <language>=<path>] [--path <p>] [--symbol-kind <k>] [--search <s>]";

export const SKILL_HELP = `${SKILL_USAGE}

Commands:
  generate          Write codemap.json and codemap.html, print a count summary
  read              Re-run the pipeline, print the filtered graph

Options (both commands):
  --root <dir>      Repo root to analyse (default: current directory)
  --out <dir>       Output directory (default: .codemap, or the config's outDir)
  --config <path>   Config file path (default: <root>/codemap.config.json)
  --include-tests   Include test files in discovery and Module clustering
  --scip-index <language>=<path>
                    SCIP index refining that language's call targets (python only,
                    repeatable per language; default: <root>/index.scip if present)
  -h, --help        Show this help and exit

Options (generate only):
  --force           Skip the incremental cache and re-extract every file

Options (read only):
  --path <p>        Prefix/subtree filter; "." is the whole repo
  --symbol-kind <k> function, method, class, const, type, interface, or enum
  --search <s>      Case-insensitive substring match on node names`;
