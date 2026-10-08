import { readFileSync } from "node:fs";

// @semantic-release/changelog puts each release's notes directly under `changelogTitle`. The header is
// everything in CHANGELOG.md before the first released version: the title, its back-link line, the intro
// and the Unreleased section. Computing it here keeps it in step when backlinks:generate rewrites the
// back-link line; a fixed string would go stale and the notes would land above the title again.
const changelog = readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8");
const firstRelease = changelog.search(/^## \[?\d/m);
const changelogTitle = (firstRelease === -1 ? changelog : changelog.slice(0, firstRelease)).trim();

export default {
	branches: [
		"main",
		{
			name: "release/+([0-9])?(.{+([0-9]),x}).x",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release's own lodash template, evaluated by semantic-release
			range: "${name.replace(/^release\\//, '')}",
		},
	],
	plugins: [
		[
			"@semantic-release/commit-analyzer",
			{
				preset: "conventionalcommits",
				releaseRules: [
					{
						type: "feat",
						release: "minor",
					},
					{
						type: "fix",
						release: "patch",
					},
					{
						type: "perf",
						release: false,
					},
					{
						type: "build",
						release: false,
					},
					{
						type: "chore",
						release: false,
					},
					{
						type: "ci",
						release: false,
					},
					{
						type: "docs",
						release: false,
					},
					{
						type: "style",
						release: false,
					},
					{
						type: "refactor",
						release: false,
					},
					{
						type: "test",
						release: false,
					},
					{
						type: "revert",
						release: false,
					},
				],
			},
		],
		[
			"@semantic-release/release-notes-generator",
			{
				preset: "conventionalcommits",
			},
		],
		[
			"@semantic-release/changelog",
			{
				changelogTitle: changelogTitle,
			},
		],
		// Staged publishing: the npm Trusted Publisher only allows `npm stage publish`, so a release is never
		// installable until a maintainer approves it with 2FA (`npm stage approve` or npmjs.com). This plugin
		// still bumps package.json and packs the tarball; it doesn't publish, so it needs no npm credentials.
		[
			"@semantic-release/npm",
			{
				npmPublish: false,
				tarballDir: "release-tarball",
			},
		],
		// Stages the tarball packed above. The npm CLI authenticates through OIDC (Trusted Publishing); a
		// maintenance-branch release goes to its own channel's dist-tag, as npm requires for non-latest versions.
		[
			"@semantic-release/exec",
			{
				publishCmd:
					// biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release's own lodash template, rendered by @semantic-release/exec
					'npm stage publish ./release-tarball/*-${nextRelease.version}.tgz --provenance --tag ${nextRelease.channel || "latest"}',
			},
		],
		"@semantic-release/git",
		[
			"@semantic-release/github",
			{
				successComment: false,
				assets: [{ path: "sbom.cdx.json", label: "SBOM (CycloneDX JSON, repository lockfile)" }],
			},
		],
	],
};
