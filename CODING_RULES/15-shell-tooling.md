# Shell Tooling

[Back to AGENTS.md](../AGENTS.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md)

Load for the rationale and example commands behind the shell-tooling substitutions listed in `AGENTS.md`.

Use the modern tool when it's installed. Fall back to the classic one if it isn't. Check with `command -v <tool>` first. Don't assume either way, and don't fail the task just because a preferred tool is missing.

| Legacy | Modern | Why | Example |
|---|---|---|---|
| `grep`, `egrep`, `fgrep` | ripgrep's `rg` | Skips `.git` and `node_modules` by default, faster on large trees | `rg 'TODO' src/` |
| `find` | `fd` | Simpler syntax, same `.gitignore` awareness | `fd -e ts . src/` |
| `cat` on a JSON file | `jq` | Pulls one field instead of dumping the whole file into context | `jq '.version' package.json` |
| `cat` on a YAML file | `yq` | Same idea as `jq`, for YAML, TOML, and XML | `yq '.image.tag' values.yaml` |
| `ls`, `tree` | `eza` | Git status and a tree view in one command | `eza -la --tree --level=2` |
| A manual `cd` chain | `zoxide` | Jumps to a frequently used directory from a fragment of its name | `zoxide query project-name` |
| Scrolling a list by hand | `fzf` | Fuzzy match over piped input | `fd -e ts \| fzf` |
| A multi-step Git workflow | `lazygit` | One TUI for staging, diffing, and rebasing instead of several separate commands | `lazygit` |

If a modern tool isn't installed and there's no way to install it right now, the classic command still works. Don't block the task on a missing CLI tool.
