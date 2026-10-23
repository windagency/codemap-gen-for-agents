# Changelog

[Back to README.md](README.md) • [Back to .github/rulesets/README.md](.github/rulesets/README.md) • [Back to 10-commits-and-versioning.md](CODING_RULES/10-commits-and-versioning.md) • [Back to DEPLOYMENT.md](documentation/DEPLOYMENT.md) • [Back to SEMVER.md](documentation/SEMVER.md)

All significant changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/) as applied per-package (see `CODING_RULES/10-commits-and-versioning.md`).

Versioned entries below this point are written by `semantic-release` (`@semantic-release/changelog`, see `release.config.js`) from Conventional Commits history on every release - do not hand-edit them; fix the triggering commit message instead. Use `Unreleased` only to call out something worth flagging to readers ahead of the next release; it is not a substitute for a commit message.

## [Unreleased](https://github.com/windagency/codemap-gen-for-agents/commits/main)

### Added

### Fixed

### Changed

### Removed

## [1.1.0-rc.2](https://github.com/windagency/codemap-gen-for-agents/compare/v1.1.0-rc.1...v1.1.0-rc.2) (2026-10-23)

### Bug Fixes

* **deps:** require zod 4.6.7 or later ([89ad1be](https://github.com/windagency/codemap-gen-for-agents/commit/89ad1be16c9abc3326a1c07a63eadb83e1dad832))

## [1.1.0-rc.1](https://github.com/windagency/codemap-gen-for-agents/compare/v1.0.3...v1.1.0-rc.1) (2026-10-10)

### Features

* accept a constructor anchor on its class's name ([acb6635](https://github.com/windagency/codemap-gen-for-agents/commit/acb6635cf2a5167992f31c8b1ac7cf2ee4c241c6))
* build each Go Package before scip-go and warn when it fails ([0ce0bc6](https://github.com/windagency/codemap-gen-for-agents/commit/0ce0bc6e3ba1eb3d4ea41fbad4108ab9f356daba))
* map a definition past a leading annotation to its Symbol ([621fae8](https://github.com/windagency/codemap-gen-for-agents/commit/621fae8f93d522134cbd32022f2f753bc9f75306))
* read a SCIP index for Python from --scip-index, scipIndexes, or index.scip ([5e1c951](https://github.com/windagency/codemap-gen-for-agents/commit/5e1c951cc829ae38b198752111ee1103006c48aa))
* read Java calls from a supplied SCIP index ([c524de5](https://github.com/windagency/codemap-gen-for-agents/commit/c524de572371107f41d2b8ac49f40c253f6f89a5))
* refine Go calls from a SCIP index and run scip-go ([74b7635](https://github.com/windagency/codemap-gen-for-agents/commit/74b7635f61a54e3f7ac04bda89d261c62b742532))
* refine Python call candidates from a SCIP index ([f78868a](https://github.com/windagency/codemap-gen-for-agents/commit/f78868ac9a7c18cca800174049749a9b59bc8b45))
* refine Rust calls from a SCIP index and run rust-analyzer ([3fe58d3](https://github.com/windagency/codemap-gen-for-agents/commit/3fe58d379d9bdd80a82a7aa480942beb79fba68f))
* run SCIP indexers from generate when asked with --run-indexers ([ad3664d](https://github.com/windagency/codemap-gen-for-agents/commit/ad3664d11fb068e2a85fac2f02de30ef8e0631e1))
* run scip-python per Python Package and trust its recorded hashes ([02b15fb](https://github.com/windagency/codemap-gen-for-agents/commit/02b15fb0e1615150eddba946239e9db1445b0488))
* skip anchor occurrences on operators, whitespace, and Self ([b5f7b4a](https://github.com/windagency/codemap-gen-for-agents/commit/b5f7b4a1bb05777317d6196fa3503d73620f73ef))

### Bug Fixes

* fetch Debian packages over HTTPS in the dev image ([#29](https://github.com/windagency/codemap-gen-for-agents/issues/29)) ([aea6d75](https://github.com/windagency/codemap-gen-for-agents/commit/aea6d75002a4f590ea5bb8c20c79aa6d15b21824))
* hash ancestor manifests for reuse and drop the repo root from reasons ([b654f5f](https://github.com/windagency/codemap-gen-for-agents/commit/b654f5f57f2dbff1b9b0666817263f9a42c33ea8))
* keep release notes below the changelog header ([6a7479a](https://github.com/windagency/codemap-gen-for-agents/commit/6a7479a23db38b8b15e11c79002ca5b95de57bc0))
* keep tree-sitter candidates when an in-repo index target has no Symbol ([dc04424](https://github.com/windagency/codemap-gen-for-agents/commit/dc044245a598b9cfb354e248b59886e52ab6f1af))
* load each tree-sitter grammar only when its language has files to extract ([c051742](https://github.com/windagency/codemap-gen-for-agents/commit/c051742355034c77c22d360bdce8686a7d77d25f))
* name an unreadable SCIP index by its repo-relative path ([46595df](https://github.com/windagency/codemap-gen-for-agents/commit/46595df787ea69888b52fea2d8b2e5908f6991c2))
* never write back-links into the root README ([0621e66](https://github.com/windagency/codemap-gen-for-agents/commit/0621e66a36b4d767d874bbba3a86021c2c2e6ae7))
* re-run an indexer when its Package's manifest or lockfile changes ([1db6851](https://github.com/windagency/codemap-gen-for-agents/commit/1db685155ca6f6779ca4c769ce11555516c27174))
* run indexers past an unreadable root index.scip ([4a40c98](https://github.com/windagency/codemap-gen-for-agents/commit/4a40c989b4cdc1875fbed8332a6390dd3ca4ae89))

## [1.0.3](https://github.com/windagency/codemap-gen-for-agents/compare/v1.0.2...v1.0.3) (2026-10-08)

### Bug Fixes

* load each tree-sitter grammar only when its language has files to extract ([#45](https://github.com/windagency/codemap-gen-for-agents/issues/45)) ([65115cb](https://github.com/windagency/codemap-gen-for-agents/commit/65115cbbd09b4628ccfb692541a279dd4c58a3c9))

## [1.0.2](https://github.com/windagency/codemap-gen-for-agents/compare/v1.0.1...v1.0.2) (2026-10-08)

### Bug Fixes

* keep husky output out of the release tarball name ([#38](https://github.com/windagency/codemap-gen-for-agents/issues/38)) ([ac1088e](https://github.com/windagency/codemap-gen-for-agents/commit/ac1088ee14b408c48cf52365986f015b9627cd13))
* update runtime dependencies and dev tooling ([#37](https://github.com/windagency/codemap-gen-for-agents/issues/37)) ([f2a6fa9](https://github.com/windagency/codemap-gen-for-agents/commit/f2a6fa98e21deb6b0a61165662e2e26451c71438))

## [1.0.1](https://github.com/windagency/codemap-gen-for-agents/compare/v1.0.0...v1.0.1) (2026-10-08)

### Bug Fixes

* keep release notes below the changelog header ([#12](https://github.com/windagency/codemap-gen-for-agents/issues/12)) ([5b25dd8](https://github.com/windagency/codemap-gen-for-agents/commit/5b25dd8b80e1aba889c768983df7ba318aa7c7f8))

## 1.0.0 (2026-10-07)

### Features

* initial release of codemap-gen-for-agents ([b67a21f](https://github.com/windagency/codemap-gen-for-agents/commit/b67a21fa3659b212511dae02d70f1f9b23885e7e))

### Bug Fixes

* install no git hooks on CI runners ([#4](https://github.com/windagency/codemap-gen-for-agents/issues/4)) ([24a56e6](https://github.com/windagency/codemap-gen-for-agents/commit/24a56e6290631461b0a989972e167abf808597f8))
* let semantic-release authenticate to npm with NPM_TOKEN ([#2](https://github.com/windagency/codemap-gen-for-agents/issues/2)) ([8426a87](https://github.com/windagency/codemap-gen-for-agents/commit/8426a8732f76e7f0dad084122ddc352e0ebfe23d))
* normalize CRLF in third-party license manifest ([#1](https://github.com/windagency/codemap-gen-for-agents/issues/1)) ([1e23b51](https://github.com/windagency/codemap-gen-for-agents/commit/1e23b513623fc4a7f142f51e3a93feffbab715b5))
* render release notes with the preset the notes writer supports ([#3](https://github.com/windagency/codemap-gen-for-agents/issues/3)) ([3acb4a0](https://github.com/windagency/codemap-gen-for-agents/commit/3acb4a091291659726c8b8d587b93c1d12fb2ca0))
