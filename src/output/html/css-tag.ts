// A no-op identity tag: `css\`...\`` produces exactly the same string as the equivalent untagged
// template literal. Its only purpose is the tag name itself - `postcss-styled-syntax` (wired up
// via `stylelint.config.js`) recognises a `css`-tagged template literal by convention and extracts
// real CSS out of it for Stylelint to lint, which it can't do for a plain untagged string.
export const css = (strings: TemplateStringsArray, ...values: unknown[]): string =>
	String.raw({ raw: strings }, ...values);
