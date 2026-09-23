# cc-human

A Claude Code plugin that enforces the Human persona writing rules on every session. It makes the agent follow a style guide designed to keep prose from reading like AI output, and it enforces the rules mechanically rather than relying on the model to comply.

## What it does

Three layers run automatically when the plugin is enabled.

1. **SessionStart hook** injects a compact summary of the rules into context at the start of every session.
2. **PreToolUse hook** scans `Write`, `Edit`, and `MultiEdit` calls before the content lands. If the text breaks a hard rule, the call is denied with a reason. The agent must fix the content and write again.
3. **PostToolUse hook** reads the written file and flags hard-rule and watchlist-density violations as feedback, so anything that slipped past the pre check still gets caught.

A skill (`/cc-human:human-writing`) holds the full 10-section rules. A command (`/cc-human:check <file>`) runs a manual QC pass on one file.

## Install

This repository is a marketplace. Add it from GitHub, then install the plugin.

```powershell
claude plugin marketplace add Xevalous/cc-human
claude plugin install cc-human@cc-human
```

Or inside Claude Code:

```text
/plugin marketplace add Xevalous/cc-human
/plugin install cc-human@cc-human
```

Restart Claude Code after installing. The plugin is enabled by default for all projects.

## What the scanner catches

Three tiers.

**Hard rules** (any occurrence blocks the write): em dashes, double hyphens, curly quotes and apostrophes, invented data or anecdotes, and chatbot artifacts such as `I hope this helps`.

**Banned phrases** (any occurrence blocks): the openers, transitions, mid-copy filler, and social-media cliches listed in persona section 4. Examples are kept in a fenced block below so this README does not trip its own scanner.

```
in today's, let's dive in, deep dive, look no further,
at the end of the day, in conclusion, in summary,
it's crucial to, game-changer, cutting-edge, stakeholders, synergy
```

**Watchlist density** (per markdown section): blocks if one watchlist word appears twice, or three or more distinct watchlist words appear in one section. Mirrors the density rule from persona section 10.

## Scanner scope

Only prose files are scanned: `.md`, `.mdx`, `.markdown`, `.txt`, `.adoc`, `.rst`. Code, config, and binary files are skipped.

Before scanning, these regions are stripped so they do not cause false positives:

- YAML frontmatter
- HTML comments
- Fenced code blocks and inline code
- Bare URLs
- Horizontal rules and table separator lines
- Setext heading underlines

## Exempt a file

If a file legitimately needs to list banned terms (a reference document, this README, the skill itself), add this marker anywhere in the file:

```text
<!-- cchuman:skip -->
```

## Disable

Set the environment variable `CCHUMAN_DISABLE=1` to make every hook exit silently for that session.

## Develop

Load the plugin directly without installing it:

```powershell
claude --plugin-dir .\plugins\cc-human
```

After editing, run `/reload-plugins` in the session.

Validate the manifests:

```powershell
claude plugin validate .
claude plugin validate .\plugins\cc-human
```

Run the unit tests:

```powershell
node test\scan.test.cjs
```

## Layout

```text
cc-human/
  .claude-plugin/marketplace.json      local marketplace manifest
  plugins/cc-human/
    .claude-plugin/plugin.json         plugin manifest
    hooks/
      hooks.json                       SessionStart, PreToolUse, PostToolUse
      session-inject.cjs               prints the rules summary
      scan.cjs                         pre and post scanner
    lib/rules.cjs                      shared rules engine
    skills/human-writing/SKILL.md      full 10-section rules
    commands/check.md                  /cc-human:check <file>
  test/scan.test.cjs                   unit tests for the rules engine
```

## License

MIT
