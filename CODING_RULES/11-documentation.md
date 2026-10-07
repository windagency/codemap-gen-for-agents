# Documentation

[Back to pull_request_template.md](../.github/pull_request_template.md) • [Back to 09-enforcement.md](09-enforcement.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md)

Load when writing or updating documentation, and always at the end of a task before marking it done.

## Two audiences, never conflated

Every document is read by two different people. Confusing them makes the document useless to both.

- **Consumers** scan it like a menu: find the thing, see what it takes, copy the example, move on. They will not read a wall of text. Too little information and too much information fail the same way - both get skipped.
- **Maintainers** need the full picture: why there are two calls instead of one, why a field is nullable, the history behind a workaround. They're the ones debugging this at 2am.

Don't write one document that tries to serve both by hedging everything in the middle. Serve the consumer first, then give the maintainer a clearly separated place to go deeper.

## Structure rule

Lead with **what it does**. Follow with **how to use it**. Put the *why* - rationale, history, edge cases, links to the decision - after that, clearly separated, not interleaved.

```markdown
# functionName

Does X, given Y.

## Usage

\`\`\`ts
functionName(input); // -> output
\`\`\`

## Notes

Why it's built this way, edge cases, links to related decisions.
```

A reader who only needs the what and the how never has to scroll past the why to find them.

## End-of-run check

Before a task is marked complete, documentation affected by the change is reviewed and brought up to date as part of the same change, not deferred to a follow-up:

- [ ] Any README, guide, or reference page describing behaviour that changed has been updated.
- [ ] New public functions, endpoints, or components have a "what it does" line and a usage example.
- [ ] Nothing was added to the top of a doc that belongs in a "why"/notes section instead.
- [ ] No wall-of-text was created where a scannable structure (heading, short description, example) would serve the consumer better.
- [ ] Removed or renamed things have their old documentation removed, not left stale alongside the new.

Undocumented behaviour change is treated the same as an untested one: the task isn't done until it's covered.
