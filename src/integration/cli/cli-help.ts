export const CLI_USAGE =
	"Usage: codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests]";

export const CLI_HELP = `${CLI_USAGE}

Generates codemap.json and codemap.html for the repo at --root.

Options:
  --root <dir>      Repo root to analyse (default: current directory)
  --out <dir>       Output directory (default: .codemap, or the config's outDir)
  --config <path>   Config file path (default: <root>/codemap.config.json)
  --force           Skip the incremental cache and re-extract every file
  --include-tests   Include test files in discovery and Module clustering
  -h, --help        Show this help and exit`;
