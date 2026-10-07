# Semantic version management

[Back to README.md](../README.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to DEPLOYMENT.md](DEPLOYMENT.md) • [Back to SECURITY.md](../SECURITY.md)

To keep the ecosystem healthy, reliable and secure, this project's version number in `package.json` follows [SemVer 2.0.0](https://semver.org/) (also used by npm).

Following the semantic version specification helps other developers who depend on your code to understand the extent of changes in a given version and adjust their own code if necessary.

**/!\\ NOTE**: the version bump is not chosen by hand. It's derived from the Conventional Commits merged since the last release - the highest of PATCH/MINOR/MAJOR implied by the commit types and any breaking-change markers present wins. Full rules: [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md).

- `fix:` commits => PATCH (e.g. 0.0.1 becomes 0.0.2)
- `feat:` commits => MINOR, resets PATCH (e.g. 0.0.56 becomes 0.1.0)
- A breaking change (`!` or a `BREAKING CHANGE:` footer, on any type) => MAJOR, resets MINOR and PATCH (e.g. 0.8.45 becomes 1.0.0)

## CHANGELOG.md

A [CHANGELOG.md](../CHANGELOG.md) is kept at the project root. Its header format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), but only the `## [Unreleased]` section is ever hand-written - use it to flag something worth calling out ahead of the next release, not as a substitute for a well-formed commit message:

```markdown
## [Unreleased](https://github.com/windagency/codemap-gen-for-agents/commits/main)

### Added

### Fixed

### Changed

### Removed
```

Every versioned section below it is written by `semantic-release` (the `@semantic-release/changelog` plugin, configured in [`.releaserc.json`](../.releaserc.json)) on each release, from Conventional Commits history via the `conventionalcommits` release-notes preset - grouped by commit type (`Features`, `Bug Fixes`, `BREAKING CHANGES`, and so on), not by Keep a Changelog's `Added`/`Changed`/`Removed` categories. Never hand-edit a versioned entry; fix the triggering commit message instead, since that's what the next release's notes are generated from. Full release pipeline: [`DEPLOYMENT.md`](DEPLOYMENT.md).

A `release/<major>.x` branch publishes patch/minor releases scoped to that major only - see [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md)'s Branches section for the branch model, and [`GITFLOW.md`](GITFLOW.md) for how it fits the overall flow.
