#!/usr/bin/env node
'use strict';
// cc-human scan hook. Runs as PreToolUse (mode "pre") and PostToolUse (mode "post").
// mode "pre": inspect the content about to be written and deny hard-rule violations.
// mode "post": read the written file from disk and flag hard-rule plus density violations.
// The scanner never blocks on its own errors: it fails open so the agent can keep working.

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const rules = require(path.join(PLUGIN_ROOT, 'lib', 'rules.cjs'));

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function getToolContent(toolName, toolInput) {
  // Returns the prose text the agent is about to write, or null if not text-bearing.
  if (toolName === 'Write') {
    return typeof toolInput.content === 'string' ? toolInput.content : null;
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    // Edit: single new_string. MultiEdit: array of edits with new_string each.
    if (toolName === 'Edit') {
      return typeof toolInput.new_string === 'string' ? toolInput.new_string : null;
    }
    if (Array.isArray(toolInput.edits)) {
      return toolInput.edits
        .map(function (e) { return typeof e.new_string === 'string' ? e.new_string : ''; })
        .join('\n');
    }
    return null;
  }
  if (toolName === 'NotebookEdit') {
    return typeof toolInput.new_source === 'string' ? toolInput.new_source : null;
  }
  return null;
}

// True when an Edit or MultiEdit only touches text inside fenced code blocks
// of the file on disk. The fragment then holds diagram or code content (a
// mermaid arrow like -->, a config sample), not prose, so scanning it would
// only produce false positives. Returns false when the file or the target
// strings cannot be found: the fragment then gets scanned as before.
function editsInsideCodeFences(filePath, toolName, toolInput) {
  if (toolName !== 'Edit' && toolName !== 'MultiEdit') return false;
  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return false;
  }
  if (toolName === 'Edit') {
    const oldStr = typeof toolInput.old_string === 'string' ? toolInput.old_string : '';
    return rules.allOccurrencesInsideFences(fileContent, oldStr);
  }
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
  if (edits.length === 0) return false;
  return edits.every(function (e) {
    return !!e && typeof e.old_string === 'string' &&
      rules.allOccurrencesInsideFences(fileContent, e.old_string);
  });
}

function emitPreDeny(reason) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  };
  process.stdout.write(JSON.stringify(out));
}

function emitPostDeny(reason) {
  // PostToolUse cannot undo the write. stderr plus exit 2 returns the
  // feedback to the agent so it can revise the file.
  process.stderr.write(reason);
  process.exitCode = 2;
}

function main() {
  if (process.env.CCHUMAN_DISABLE === '1') {
    process.exit(0);
  }
  const mode = process.argv[2] || 'pre';
  const raw = readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    // Malformed input: do not block.
    process.exit(0);
  }

  const toolName = payload.tool_name || '';
  const toolInput = payload.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';

  // Only scan prose files. Code, config, and binary are left alone.
  if (!rules.isProsePath(filePath)) {
    process.exit(0);
  }

  if (mode === 'pre') {
    const content = getToolContent(toolName, toolInput);
    if (!content) process.exit(0);
    if (content.indexOf(rules.SKIP_MARKER) !== -1) process.exit(0);
    // An Edit aimed entirely at the inside of a fenced code block carries
    // diagram or code content, not prose. Scanning the fragment out of
    // context only produces false positives (mermaid arrows, say), so skip.
    if (editsInsideCodeFences(filePath, toolName, toolInput)) process.exit(0);
    // Hard rules and banned phrases fire on any occurrence, so they apply to
    // both full files (Write) and fragments (Edit, MultiEdit). Density needs a
    // full file to be meaningful, so only run it on Write.
    const isFullFile = toolName === 'Write';
    const hard = rules.findHardViolations(content);
    const banned = rules.findBannedPhraseViolations(content);
    const dens = isFullFile ? rules.findDensityViolations(content) : [];
    const violations = hard.concat(banned).concat(dens);
    if (violations.length > 0) {
      emitPreDeny(rules.formatReason(violations, filePath, 'write'));
    }
    process.exit(0);
  }

  if (mode === 'post') {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      // File not readable: nothing to scan.
      process.exit(0);
    }
    if (content.indexOf(rules.SKIP_MARKER) !== -1) process.exit(0);
    const violations = rules.findAllViolations(content);
    if (violations.length > 0) {
      emitPostDeny(rules.formatReason(violations, filePath, 'edit'));
    }
    process.exit(process.exitCode || 0);
  }

  // Unknown mode: no-op.
  process.exit(0);
}

try {
  main();
} catch (e) {
  // Never let a scanner crash block the agent.
  try {
    process.stderr.write('cc-human scanner error: ' + (e && e.message || String(e)) + '\n');
  } catch (_) {}
  process.exit(0);
}
