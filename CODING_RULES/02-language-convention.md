# Language Convention

[Back to CONTRIBUTING.md](../CONTRIBUTING.md)

Always load this file.

This project uses two spelling conventions, decided by file type and by role within a file. Never mix them in the same document or file.

## Decision table

| Content                                                                     | Convention |
| --------------------------------------------------------------------------- | ---------- |
| Code identifiers - function, variable, class names; string literals in code | American   |
| Inline comments - in code files *or* in documentation                       | British    |
| Documentation, README, guides                                               | British    |
| Reports - CHANGELOG, TODO, summaries                                        | British    |

In short: a `.ts` file has American identifiers but British comments. A `.md` guide is British throughout. A technical artefact whose whole content is code (e.g. a generated config or a prompt template, should this repo ever add one) is American throughout, including its own comments, because it isn't documentation.

**Audience carve-out:** documentation written primarily for an agent to read - skill files, and the domain docs `AGENTS.md` routes agents to (`CONTEXT.md`, `documentation/adr/*`) - stays American throughout, including prose, the same reasoning as code-only files: an agent audience makes the American spelling of a borrowed technical term (e.g. "artifact") the more legible default, not an error to correct. Documentation written for a human reader (`README.md`, `documentation/USER_GUIDE.md`, and guides like it) follows the British rule above without exception.

## Common conversions (British - used in docs and comments)

| American       | British      |
| -------------- | ------------ |
| optimization   | optimisation |
| organization   | organisation |
| analyze        | analyse      |
| color          | colour       |
| behavior       | behaviour    |
| center         | centre       |
| defense        | defence      |
| license (noun) | licence      |
| catalog        | catalogue    |
| modeling       | modelling    |
| fulfill        | fulfil       |

## Never convert

Function/method names (`optimize()`), CSS or code properties (`color: red`), command or prompt IDs (`analyze-*`), template content, variable names. These stay American even inside an otherwise British document - they are literal code, not prose.

## New-file checklist

- [ ] File type identified (technical vs documentation) before writing.
- [ ] Correct convention applied throughout.
- [ ] No mixed spelling within the same document.
- [ ] Spellchecked against the correct dictionary (en-US or en-GB).
