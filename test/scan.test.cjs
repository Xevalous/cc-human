'use strict';
// Standalone test for the cc-human rules engine. Not a hook, not installed.
// Run: node test/scan.test.cjs

const path = require('path');
const PLUGIN_ROOT = path.join(__dirname, '..', 'plugins', 'cc-human');
const rules = require(path.join(PLUGIN_ROOT, 'lib', 'rules.cjs'));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass += 1; console.log('  ok  ' + name); }
  else { fail += 1; console.log('  FAIL ' + name); }
}

// 1. Em dash in prose is a hard violation.
(function () {
  const c = '# Title\n\nThis has an em dash here.— Yep.\n';
  const v = rules.findHardViolations(c);
  ok('em dash detected', v.length === 1 && v[0].rule === 'em-dash');
})();

// 2. Double hyphen is a hard violation.
(function () {
  const c = 'A sentence--with a double hyphen.\n';
  const v = rules.findHardViolations(c);
  ok('double hyphen detected', v.length === 1 && v[0].rule === 'double-hyphen');
})();

// 3. Curly quotes are a hard violation.
(function () {
  const c = 'He said “hello” and ‘hi’.\n';
  const v = rules.findHardViolations(c);
  ok('curly quotes detected', v.length >= 1 && v[0].rule === 'curly-quotes');
})();

// 4. Chatbot artifact is a hard violation.
(function () {
  const c = 'Some text. I hope this helps! More text.\n';
  const v = rules.findHardViolations(c);
  ok('chatbot artifact detected', v.some(function (x) { return x.rule === 'chatbot-artifact'; }));
})();

// 5. Horizontal rule is NOT a double-hyphen false positive.
(function () {
  const c = 'Intro\n\n---\n\nMore text.\n';
  const v = rules.findHardViolations(c);
  ok('horizontal rule not flagged', v.length === 0);
})();

// 6. Table separator is NOT a false positive.
(function () {
  const c = '| Col A | Col B |\n|---|---|\n| 1 | 2 |\n';
  const v = rules.findHardViolations(c);
  ok('table separator not flagged', v.length === 0);
})();

// 7. Fenced code with -- inside is NOT flagged.
(function () {
  const c = 'Prose here.\n\n```\nlet x = a--b;\n```\n\nMore prose.\n';
  const v = rules.findHardViolations(c);
  ok('code block -- not flagged', v.length === 0);
})();

// 8. Density: one watchlist word twice in a section is a violation.
(function () {
  const c = '# Section\n\nWe delve into this. We delve again.\n';
  const v = rules.findDensityViolations(c);
  ok('duplicate watchlist word flagged', v.length === 1 && v[0].rule === 'watchlist-density');
})();

// 9. Density: three distinct watchlist words in a section is a violation.
(function () {
  const c = '# Section\n\nThis is robust. It is seamless. And holistic.\n';
  const v = rules.findDensityViolations(c);
  ok('three distinct watchlist words flagged', v.length === 1);
})();

// 10. Density: one watchlist word once is NOT a violation.
(function () {
  const c = '# Section\n\nWe delve into this once.\n';
  const v = rules.findDensityViolations(c);
  ok('single watchlist word not flagged', v.length === 0);
})();

// 11. Non-prose file extension is skipped.
(function () {
  ok('python file is not prose', !rules.isProsePath('foo.py'));
  ok('markdown file is prose', rules.isProsePath('foo.md'));
  ok('txt file is prose', rules.isProsePath('foo.txt'));
})();

// 12. Banned phrase: any single occurrence is a violation.
(function () {
  const c = '# Section\n\nAt the end of the day, this works.\n';
  const v = rules.findBannedPhraseViolations(c);
  ok('single banned phrase flagged', v.length === 1 && v[0].rule === 'banned-phrase');
})();

// 13. Another banned phrase.
(function () {
  const c = '# Section\n\nIn conclusion, the work is done.\n';
  const v = rules.findBannedPhraseViolations(c);
  ok('in conclusion flagged', v.length === 1);
})();

// 14. Transitional adverb is density, not banned-anywhere: one is fine.
(function () {
  const c = '# Section\n\nMoreover, this is fine once.\n';
  const banned = rules.findBannedPhraseViolations(c);
  const dens = rules.findDensityViolations(c);
  ok('moreover once is not banned', banned.length === 0);
  ok('moreover once is not density', dens.length === 0);
})();

// 15. Clean prose has no violations.
(function () {
  const c = '# Title\n\nThis is plain, clean prose. It has a period, a comma, and straight quotes only.\n\nIt varies length. Some sentences are short. Others take their time and run a little longer so the rhythm does not read as algorithmic.\n';
  ok('clean prose no hard', rules.findHardViolations(c).length === 0);
  ok('clean prose no banned', rules.findBannedPhraseViolations(c).length === 0);
  ok('clean prose no density', rules.findDensityViolations(c).length === 0);
})();

// 16. Frontmatter is stripped.
(function () {
  const c = '---\ntitle: Bad--Title\n---\n\nClean prose here.\n';
  const v = rules.findHardViolations(c);
  ok('frontmatter double hyphen not flagged', v.length === 0);
})();

// 17. findAllViolations aggregates all three tiers.
(function () {
  const c = '# Section\n\nBad—dash. At the end of the day. Delve delve.\n';
  const v = rules.findAllViolations(c);
  const tiers = v.map(function (x) { return x.tier; });
  ok('findAll has hard', tiers.indexOf('hard') !== -1);
  ok('findAll has banned', tiers.indexOf('banned') !== -1);
  ok('findAll has density', tiers.indexOf('density') !== -1);
})();

// 18. Skip marker in HTML comment is stripped, so banned phrases inside
// comments do not fire.
(function () {
  const c = '<!-- at the end of the day -->\n\nClean prose.\n';
  const v = rules.findBannedPhraseViolations(c);
  ok('banned phrase in comment not flagged', v.length === 0);
})();

// 19. Mermaid and ASCII diagram arrows are not double-hyphen violations,
// even outside a fence (an Edit fragment arrives without its fence).
(function () {
  const c = 'graph TD\n  A([Mulai]) --> B[Login]\n  B -- success --> C\n  C --> D[Done]\n';
  const v = rules.findHardViolations(c);
  ok('mermaid arrows not flagged', v.length === 0);
})();

(function () {
  const cases = ['x <-- y', 'x <--> y', 'x ==> y', 'x === y', 'x --- y', 'x ->> y'];
  cases.forEach(function (line) {
    const v = rules.findHardViolations(line + '\n');
    ok('arrow ' + JSON.stringify(line) + ' not flagged', v.length === 0);
  });
})();

// 20. CLI-style flags and CSS custom properties are not double hyphens.
(function () {
  const v = rules.findHardViolations('Run git commit --amend, then retry with --dry-run.\n');
  ok('cli flags not flagged', v.length === 0);
  const v2 = rules.findHardViolations('Set --primary-color in the stylesheet.\n');
  ok('css custom property not flagged', v2.length === 0);
})();

// 21. A real double hyphen in prose is still caught, at any boundary.
(function () {
  const v = rules.findHardViolations('A sentence--with a double hyphen.\n');
  ok('prose double hyphen still flagged', v.length === 1 && v[0].rule === 'double-hyphen');
  const v2 = rules.findHardViolations('Trailing dash-- here.\n');
  ok('trailing double hyphen still flagged', v2.length === 1);
  const v3 = rules.findHardViolations('Mid-- word.\n');
  ok('mid-line double hyphen still flagged', v3.length === 1);
})();

// 22. A double hyphen that does not hug a word on its left (spaced dashes,
// CLI flags, a dash opening a phrase) is ambiguous with flag syntax, so it
// is treated as syntax, not a prose dash.
(function () {
  const v = rules.findHardViolations('Leading -- dash here.\n');
  ok('spaced double hyphen not flagged', v.length === 0);
  const v2 = rules.findHardViolations('Leading --dash here.\n');
  ok('phrase-opening --dash not flagged', v2.length === 0);
})();

// 22. fenceRanges and allOccurrencesInsideFences.
(function () {
  const file = '# Doc\n\n```mermaid\ngraph TD\n  A([Mulai]) --> B[Login]\n```\n\nProse here.\n';
  const ranges = rules.fenceRanges(file);
  ok('one fence range found', ranges.length === 1);
  const inside = file.slice(ranges[0][0], ranges[0][1]);
  ok('range covers the diagram', inside.indexOf('A([Mulai]) --> B[Login]') !== -1);
  ok('old_string inside fence detected',
    rules.allOccurrencesInsideFences(file, '  A([Mulai]) --> B[Login]\n'));
  ok('old_string in prose not inside fence',
    !rules.allOccurrencesInsideFences(file, 'Prose here.'));
  ok('empty old_string not inside fence',
    !rules.allOccurrencesInsideFences(file, ''));
  ok('absent old_string not inside fence',
    !rules.allOccurrencesInsideFences(file, 'not in the file'));
  ok('no fences means false',
    !rules.allOccurrencesInsideFences('Just prose.\n', 'Just prose.'));
})();

// 23. Unclosed fence runs to end of file.
(function () {
  const file = 'Intro.\n\n```\ncode --here\n';
  const ranges = rules.fenceRanges(file);
  ok('unclosed fence reaches EOF', ranges.length === 1 && ranges[0][1] === file.length);
  ok('old_string in unclosed fence detected',
    rules.allOccurrencesInsideFences(file, 'code --here\n'));
})();

// 24. Tilde fences work, and a closing fence needs no info string.
(function () {
  const file = '~~~txt\nsome --code\n~~~\n';
  ok('tilde fence detected', rules.allOccurrencesInsideFences(file, 'some --code\n'));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
