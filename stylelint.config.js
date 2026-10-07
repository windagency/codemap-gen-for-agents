// Config for the CSS living as `css`-tagged template literals in `src/output/html/*-css.ts`
// (CODING_RULES/06-frontend.md's CSS property-order rule, CODING_RULES/09-enforcement.md /
// CONTRIBUTING.md's Definition of Done). `postcss-styled-syntax` extracts real CSS out of a
// `css\`...\`` tagged template literal - it recognises the `css` tag by convention, which is why
// each of those files' export is wrapped with the identity `css` tag from `css-tag.ts` rather than
// left as a plain untagged template literal.
export default {
	extends: ["stylelint-config-standard"],
	plugins: ["stylelint-order"],
	overrides: [
		{
			files: ["src/output/html/*-css.ts"],
			customSyntax: "postcss-styled-syntax",
			rules: {
				// positioning -> display/flexbox/grid -> box model (sizing, spacing, overflow) ->
				// typography -> visual (background, border, shadow) -> transforms/animation ->
				// misc (cursor, opacity, etc.) - CODING_RULES/06-frontend.md's exact category order.
				"order/properties-order": [
					{
						groupName: "positioning",
						emptyLineBefore: "never",
						properties: ["position", "top", "right", "bottom", "left", "z-index"],
					},
					{
						groupName: "display/flexbox/grid",
						emptyLineBefore: "never",
						properties: [
							"display",
							"flex",
							"flex-grow",
							"flex-shrink",
							"flex-basis",
							"flex-direction",
							"flex-wrap",
							"justify-content",
							"align-items",
							"align-self",
							"align-content",
							"gap",
							"grid",
							"grid-template-columns",
							"grid-template-rows",
							"grid-column",
							"grid-row",
						],
					},
					{
						groupName: "box model",
						emptyLineBefore: "never",
						properties: [
							"box-sizing",
							"width",
							"min-width",
							"max-width",
							"height",
							"min-height",
							"max-height",
							"margin",
							"margin-top",
							"margin-right",
							"margin-bottom",
							"margin-left",
							"padding",
							"padding-top",
							"padding-right",
							"padding-bottom",
							"padding-left",
							"overflow",
							"overflow-x",
							"overflow-y",
						],
					},
					{
						groupName: "typography",
						emptyLineBefore: "never",
						properties: [
							"font",
							"font-family",
							"font-size",
							"font-weight",
							"line-height",
							"letter-spacing",
							"text-align",
							"text-anchor",
							"text-transform",
							"dominant-baseline",
							"white-space",
						],
					},
					{
						groupName: "visual",
						emptyLineBefore: "never",
						properties: [
							"background",
							"background-color",
							"color",
							"fill",
							"border",
							"border-top",
							"border-right",
							"border-bottom",
							"border-left",
							"border-color",
							"border-radius",
							"box-shadow",
							"outline",
							"outline-offset",
							"stroke",
							"stroke-width",
							"stroke-dasharray",
							"stroke-linejoin",
							"paint-order",
							"rx",
						],
					},
					{
						groupName: "transforms/animation",
						emptyLineBefore: "never",
						properties: ["transform", "transition", "animation"],
					},
					{
						groupName: "misc",
						emptyLineBefore: "never",
						properties: ["cursor", "opacity", "pointer-events"],
					},
				],
			},
		},
	],
};
