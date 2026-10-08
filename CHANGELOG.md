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
