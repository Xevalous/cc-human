'use strict';
// cc-human rules engine. No external dependencies. Loaded by hooks/scan.cjs.
// Three tiers:
//   1. HARD: any occurrence anywhere (em dash, double hyphen, curly quotes,
//      chatbot artifacts, banned phrases). These block on first sighting.
//   2. DENSITY: watchlist vocabulary, checked per markdown section. A section
//      violates if one term appears twice or three or more distinct terms appear.
// All strings here use straight quotes and no em dashes so the scanner does
// not trip on its own output.

const path = require('path');

const PROSE_EXTENSIONS = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.adoc', '.rst'
]);

const SKIP_MARKER = '<!-- cchuman:skip -->';

function getExtension(filePath) {
  if (!filePath) return '';
  try {
    return path.extname(filePath).toLowerCase();
  } catch (e) {
    const i = String(filePath).lastIndexOf('.');
    return i === -1 ? '' : String(filePath).slice(i).toLowerCase();
  }
}

function isProsePath(filePath) {
  return PROSE_EXTENSIONS.has(getExtension(filePath));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strip non-prose regions so they do not cause false positives:
// YAML frontmatter, HTML comments, fenced code, inline code, URLs,
// horizontal rules, table separators, and setext underlines.
function stripForScan(content) {
  let s = String(content || '');
  s = s.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/```[\s\S]*?(```|$)/g, '');
  s = s.replace(/~~~[\s\S]*?(~~~|$)/g, '');
  s = s.replace(/`[^`\n]*`/g, '');
  s = s.replace(/https?:\/\/[^\s)]+/g, ' ');
  s = s.replace(/^[ \t]*([-*_])(?:\1[ \t]*){2,}$/gm, '');
  s = s.replace(/^[ \t]*\|[\s:|-]+\|?[ \t]*$/gm, '');
  s = s.replace(/^[ \t]*={3,}[ \t]*$/gm, '');
  return s;
}

function splitSections(content) {
  const stripped = stripForScan(content);
  const parts = stripped.split(/^#{1,6}\s+/m);
  return parts.map(function (p) { return p.trim(); }).filter(Boolean);
}

// Compute the character ranges covered by fenced code blocks (``` or ~~~).
// Edit and MultiEdit only hand the scanner a fragment, so a change aimed at
// the inside of a fence (mermaid diagram source, a config sample) arrives
// with no fence markers around it. The scanner uses these ranges against the
// file on disk to tell such fragments apart from prose.
function fenceRanges(content) {
  const s = String(content || '');
  const ranges = [];
  const re = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/gm;
  let open = null;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (open === null) {
      open = { start: m.index, marker: m[1].charAt(0), len: m[1].length };
    } else if (m[1].charAt(0) === open.marker && m[1].length >= open.len && m[2].trim() === '') {
      // A closing fence repeats the marker and takes no info string.
      ranges.push([open.start, m.index + m[0].length]);
      open = null;
    }
  }
  if (open !== null) ranges.push([open.start, s.length]);
  return ranges;
}

// True when every occurrence of needle lies inside a fenced code block in
// haystack. Returns false when the string is absent or crosses a boundary:
// in both cases the scanner falls back to checking the fragment directly.
function allOccurrencesInsideFences(haystack, needle) {
  const s = String(haystack || '');
  if (!needle) return false;
  const ranges = fenceRanges(s);
  if (ranges.length === 0) return false;
  let idx = s.indexOf(needle);
  if (idx === -1) return false;
  while (idx !== -1) {
    const end = idx + needle.length;
    let inside = false;
    for (let i = 0; i < ranges.length; i++) {
      if (idx >= ranges[i][0] && end <= ranges[i][1]) { inside = true; break; }
    }
    if (!inside) return false;
    idx = s.indexOf(needle, end);
  }
  return true;
}

function countTerm(lowerText, term) {
  if (term.indexOf(' ') !== -1 || term.indexOf('-') !== -1) {
    let count = 0;
    let pos = 0;
    while ((pos = lowerText.indexOf(term, pos)) !== -1) {
      count += 1;
      pos += term.length;
    }
    return count;
  }
  const re = new RegExp('\\b' + escapeRegex(term) + '\\b', 'g');
  const matches = lowerText.match(re);
  return matches ? matches.length : 0;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
function lineText(text, lineNo) {
  const lines = text.split('\n');
  return (lines[lineNo - 1] || '').trim();
}

// ----- Tier 1: hard rules, any occurrence anywhere. -----

const HARD_RULES = [
  {
    id: 'em-dash',
    name: 'Em dash',
    re: /—/g,
    fix: 'Replace the em dash with a period, comma, colon, or parentheses.'
  },
  {
    id: 'double-hyphen',
    name: 'Double hyphen',
    // A prose double hyphen is a dash stand-in, so it hugs the word on its
    // left (word--word, word-- then a space). Anything else is syntax, not
    // a dash: diagram arrows (-->, <--, ---), arrow labels (-- yes -->),
    // CLI flags (--apply), CSS custom properties (--color). The trade-off:
    // a dash opening a phrase (-- like this) reads as the flag form and
    // is not flagged; that shape is ambiguous with real flags, and the
    // persona bans it regardless when it appears in prose.
    re: /(?<=[\p{L}\p{N}])--/gu,
    fix: 'Replace the double hyphen with a period, comma, colon, or parentheses.'
  },
  {
    id: 'curly-quotes',
    name: 'Curly quote or apostrophe',
    re: /[“”‘’«»]/g,
    fix: 'Use straight quotes and straight apostrophes only.'
  }
];

const CHATBOT_ARTIFACTS = [
  'i hope this helps',
  'certainly!',
  'let me know if you\'d like me to expand',
  'let me know if you\'d like me to',
  'feel free to ask',
  'i\'d be happy to help',
  'as of my last training',
  'great question!',
  'is there anything else',
  'happy to help'
];

// Banned phrases: any occurrence in a section is a violation. From persona
// section 4 (mid-copy filler, social-media cliches, openers) and section 3
// (inflated significance, promotional tone). A single occurrence is enough.
// Transitional adverbs (moreover, furthermore) are NOT here: they are
// density-based, because the persona says one is fine.
const BANNED_PHRASES = [
  'in today\'s', 'in a world where',
  'let\'s dive in', 'let\'s break it down', 'let\'s explore',
  'here\'s the thing',
  'thrilled to share', 'proud to announce', 'excited to announce',
  'leverage the power of', 'dive deep into', 'deep dive', 'unlock the potential',
  'it\'s crucial to', 'it\'s essential to', 'it is important to note that',
  'look no further',
  'due to the fact that', 'in order to', 'at this point in time',
  'in the event that', 'has the ability to',
  'let that sink in', 'read that again',
  'at the end of the day', 'the secret is', 'game-changer',
  'in conclusion', 'in summary', 'ultimately',
  'stands as a testament', 'serves as a testament',
  'plays a vital role', 'plays a crucial role', 'plays a pivotal role',
  'setting the stage', 'indelible mark', 'deeply rooted', 'focal point',
  'mission-critical', 'value-add', 'move the needle', 'circle back',
  'innovative solutions', 'natural beauty', 'in the heart of', 'must-visit',
  'your journey', 'embrace the change', 'level up', 'unlock your potential',
  'cutting-edge', 'best-in-class', 'world-class',
  'actionable insights'
];

// ----- Tier 2: density watchlist, per section. -----

const WATCHLIST_WORDS = [
  'delve', 'delved', 'delving', 'delves',
  'tapestry', 'testament', 'intricate', 'intricacies',
  'pivotal', 'crucial', 'vital',
  'foster', 'fostering', 'cultivate', 'garner',
  'showcase', 'highlight', 'highlighted', 'highlights',
  'enhance', 'enhanced', 'enhances', 'elevate', 'elevated', 'elevates',
  'empower', 'empowering', 'harness', 'harnessing',
  'holistic', 'robust', 'seamless', 'seamlessly', 'effortless', 'effortlessly',
  'streamline', 'streamlining', 'supercharge', 'unlock', 'unlocking',
  'boast', 'vibrant', 'landscape', 'realm', 'interplay',
  'enduring', 'evolving', 'utilize', 'utilized',
  'leverage', 'leveraged', 'leveraging',
  'navigate', 'navigating', 'navigation',
  'groundbreaking', 'renowned', 'breathtaking', 'stunning', 'profound',
  'synergy', 'stakeholders', 'actionable', 'innovative',
  'underscore', 'underscored', 'underscores',
  'moreover', 'furthermore', 'additionally',
  'very', 'truly', 'incredibly', 'undeniably', 'remarkably'
];

const MAX_SAME_TERM = 2;
const MAX_DISTINCT = 3;

// ----- Finders. -----

function findHardViolations(content) {
  const stripped = stripForScan(content);
  const violations = [];
  for (const rule of HARD_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(stripped)) !== null) {
      const ln = lineOf(stripped, m.index);
      violations.push({
        tier: 'hard',
        rule: rule.id,
        name: rule.name,
        line: ln,
        evidence: lineText(stripped, ln),
        fix: rule.fix
      });
      if (violations.length >= 60) return violations;
      if (m.index === rule.re.lastIndex) rule.re.lastIndex += 1;
    }
  }
  const lower = stripped.toLowerCase();
  for (const art of CHATBOT_ARTIFACTS) {
    const pos = lower.indexOf(art);
    if (pos !== -1) {
      const ln = lineOf(stripped, pos);
      violations.push({
        tier: 'hard',
        rule: 'chatbot-artifact',
        name: 'Chatbot artifact',
        line: ln,
        evidence: lineText(stripped, ln),
        fix: 'Remove the chatbot phrase. It must never appear in deliverable copy.'
      });
    }
  }
  return violations;
}

// Banned phrases are checked per section (after splitting by headings), so a
// phrase that appears only inside a fenced code block (already stripped) is
// not flagged.
function findBannedPhraseViolations(content) {
  const sections = splitSections(content);
  const violations = [];
  for (let i = 0; i < sections.length; i++) {
    const lower = sections[i].toLowerCase();
    for (let p = 0; p < BANNED_PHRASES.length; p++) {
      const phrase = BANNED_PHRASES[p];
      if (lower.indexOf(phrase) !== -1) {
        violations.push({
          tier: 'banned',
          rule: 'banned-phrase',
          name: 'Banned phrase',
          section: i + 1,
          evidence: phrase,
          fix: 'Cut this phrase entirely. The persona section 4 bans it on any occurrence.'
        });
      }
    }
  }
  return violations;
}

function findDensityViolations(content) {
  const sections = splitSections(content);
  const violations = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const lower = section.toLowerCase();
    const counts = {};
    for (let t = 0; t < WATCHLIST_WORDS.length; t++) {
      const term = WATCHLIST_WORDS[t];
      const c = countTerm(lower, term);
      if (c > 0) counts[term] = (counts[term] || 0) + c;
    }
    const distinct = Object.keys(counts);
    const dups = distinct.filter(function (t) { return counts[t] >= MAX_SAME_TERM; });
    if (dups.length > 0 || distinct.length >= MAX_DISTINCT) {
      const reported = dups.length > 0 ? dups : distinct.slice(0, Math.min(distinct.length, MAX_DISTINCT));
      violations.push({
        tier: 'density',
        rule: 'watchlist-density',
        name: 'Watchlist density',
        section: i + 1,
        evidence: reported.map(function (t) {
          return t + ' (x' + counts[t] + ')';
        }).join(', '),
        fix: 'Rewrite this section. The persona section 10 rule: if a single watchlist term appears twice, or three or more distinct watchlist terms appear in one section, rewrite the section. Density is the tell.'
      });
    }
  }
  return violations;
}

// Aggregate all violations for a piece of content.
function findAllViolations(content) {
  return findHardViolations(content)
    .concat(findBannedPhraseViolations(content))
    .concat(findDensityViolations(content));
}

function formatReason(violations, filePath, mode) {
  const lines = [];
  lines.push('cc-human blocked this ' + mode + ' for ' + (filePath || '<unknown file>') + '.');
  lines.push('The file violates the Human persona writing rules.');
  lines.push('');
  const hard = violations.filter(function (v) { return v.tier === 'hard'; });
  const banned = violations.filter(function (v) { return v.tier === 'banned'; });
  const dens = violations.filter(function (v) { return v.tier === 'density'; });
  if (hard.length) {
    lines.push('Hard rule violations (fix every one):');
    hard.forEach(function (v) {
      lines.push('- ' + v.name + (v.line ? ' (line ' + v.line + ')' : '') + ': ' + v.evidence);
      lines.push('  Fix: ' + v.fix);
    });
  }
  if (banned.length) {
    lines.push('Banned phrases (cut entirely):');
    banned.forEach(function (v) {
      lines.push('- Section ' + v.section + ': "' + v.evidence + '"');
      lines.push('  Fix: ' + v.fix);
    });
  }
  if (dens.length) {
    lines.push('Watchlist density violations (rewrite the section):');
    dens.forEach(function (v) {
      lines.push('- Section ' + v.section + ': ' + v.evidence);
      lines.push('  Fix: ' + v.fix);
    });
  }
  lines.push('');
  lines.push('Rewrite the content to satisfy the rules, then write the file again. Do not work around the check. The skill cc-human:human-writing has the full rules.');
  return lines.join('\n');
}

module.exports = {
  PROSE_EXTENSIONS: PROSE_EXTENSIONS,
  SKIP_MARKER: SKIP_MARKER,
  getExtension: getExtension,
  isProsePath: isProsePath,
  stripForScan: stripForScan,
  fenceRanges: fenceRanges,
  allOccurrencesInsideFences: allOccurrencesInsideFences,
  findHardViolations: findHardViolations,
  findBannedPhraseViolations: findBannedPhraseViolations,
  findDensityViolations: findDensityViolations,
  findAllViolations: findAllViolations,
  formatReason: formatReason
};
