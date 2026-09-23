---
description: Run the Human persona QC pass on one file. Reports violations and fixes them.
disable-model-invocation: false
user-invocable: true
argument-hint: <file path>
allowed-tools: Read Edit Bash
---

Run the cc-human QC pass on the file at `$ARGUMENTS`.

Steps:

1. Read the file at the path given as the argument.
2. Run the scanner against it by invoking the plugin's rules engine with the Bash tool:
   `node "$CLAUDE_PLUGIN_ROOT/lib/rules.cjs"` is not directly executable, so instead echo a minimal PostToolUse-shaped JSON payload to the scan hook, or call the rules module directly with a small node one-liner:
   `node -e "const r=require(process.env.CLAUDE_PLUGIN_ROOT+'/lib/rules.cjs'); const fs=require('fs'); const p=process.argv[1]; const c=fs.readFileSync(p,'utf8'); const h=r.findHardViolations(c); const d=r.findDensityViolations(c); console.log(JSON.stringify({hard:h,density:d},null,2));" "<file>"`
3. If there are no violations, tell the user the file passes the QC pass.
4. If there are violations, list them grouped by hard rules and density, then fix each one directly with Edit. Re-run the scan after fixing until it passes.
5. Apply the judgment-based rules from sections 2, 5, 6, 7, and 9 of the human-writing skill that the scanner cannot check automatically. Read the file as if out loud. If it sounds like a press release or a bot, rewrite per section 9.

Do not skip the read-aloud test. The scanner catches the mechanical tells. Voice is the other half.
