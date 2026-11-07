// Government Health Warning Statement check (27 CFR part 16).
// The statement must appear word-for-word, and "GOVERNMENT WARNING" must be
// in capital letters and bold. OCR can misread a letter or two, so the check
// separates "probably a misread" (needs a human look) from "the wording is
// actually different" (reject).
import { foldChars, similarity } from './text.js';
import { FAIL, PASS, REVIEW } from './fields.js';
import { strokeWidth } from './bold.js';

export const WARNING_HEADING = 'GOVERNMENT WARNING:';
export const WARNING_BODY =
  '(1) According to the Surgeon General, women should not drink alcoholic beverages ' +
  'during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic ' +
  'beverages impairs your ability to drive a car or operate machinery, and may cause ' +
  'health problems.';
export const WARNING_FULL = `${WARNING_HEADING} ${WARNING_BODY}`;

const wordKey = (w) => foldChars(w).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Locate "GOVERNMENT WARNING" in a list of OCR words (tolerant of misreads). */
export function findHeading(words) {
  let best = null;
  for (let i = 0; i + 1 < words.length; i++) {
    const a = similarity(wordKey(words[i].text), 'government');
    const b = similarity(wordKey(words[i + 1].text), 'warning');
    const score = (a + b) / 2;
    if (a >= 0.7 && b >= 0.7 && (!best || score > best.score)) best = { index: i, score };
  }
  // Heading merged into one token, e.g. "GOVERNMENTWARNING:"
  if (!best) {
    for (let i = 0; i < words.length; i++) {
      if (similarity(wordKey(words[i].text), 'governmentwarning') >= 0.8) return { index: i, merged: true, score: 0.8 };
    }
  }
  return best;
}

/**
 * Align the standard body text against what was read. Semi-global: the
 * label may have more text after the warning, which is not penalised.
 * Returns a list of operations for display.
 */
export function alignBody(expectedWords, foundWords) {
  const E = expectedWords;
  const F = foundWords;
  const n = E.length;
  const m = F.length;
  const sub = (i, j) => {
    const a = wordKey(E[i]);
    const b = wordKey(F[j]);
    if (a === b) return 0;
    return similarity(a, b) >= 0.7 ? 0.45 : 1.2;
  };
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) dp[i][0] = i;
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j - 1] + sub(i - 1, j - 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  let j = 0;
  for (let k = 1; k <= m; k++) if (dp[n][k] < dp[n][j]) j = k;
  let i = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + sub(i - 1, j - 1))) < 1e-9) {
      const c = sub(i - 1, j - 1);
      ops.push({ type: c === 0 ? 'ok' : c < 1 ? 'misread' : 'changed', expected: E[i - 1], found: F[j - 1] });
      i--; j--;
    } else if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + 1)) < 1e-9) {
      ops.push({ type: 'missing', expected: E[i - 1] });
      i--;
    } else {
      ops.push({ type: 'extra', found: F[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

/** Compare stroke thickness of the heading against body words. */
function boldCheck(headWords, bodyWords, image) {
  if (!image?.gray) return { known: false };
  const sw = (w) => strokeWidth(image, w.bbox);
  const head = headWords.map(sw).filter((x) => x > 0);
  const body = bodyWords.map(sw).filter((x) => x > 0).sort((a, b) => a - b);
  if (!head.length || body.length < 3) return { known: false };
  const headAvg = head.reduce((a, b) => a + b, 0) / head.length;
  const bodyMed = body[Math.floor(body.length / 2)];
  const ratio = headAvg / bodyMed;
  return { known: true, ratio, bold: ratio >= 1.22 };
}

export function checkWarning({ passes, image }) {
  const base = { id: 'warning', label: 'Government warning', expected: WARNING_FULL };
  let words = null;
  let head = null;
  let usedImage = null;
  for (const p of passes) {
    const h = findHeading(p.words || []);
    if (h) { words = p.words; head = h; usedImage = p.useImageForBold === false ? null : image; break; }
  }
  if (!head) {
    return {
      ...base, status: FAIL, found: '',
      note: 'The "GOVERNMENT WARNING" statement was not found on the label. It is required on every alcohol beverage.',
      problems: ['Warning statement not found'],
    };
  }

  const headWords = head.merged ? [words[head.index]] : [words[head.index], words[head.index + 1]];
  const headingRaw = headWords.map((w) => w.text).join(' ');
  const bodyStart = head.index + headWords.length;
  const expectedBody = WARNING_BODY.split(' ');
  const foundBody = words.slice(bodyStart, bodyStart + expectedBody.length + 12).map((w) => w.text).filter((t) => wordKey(t));
  const ops = alignBody(expectedBody, foundBody);

  const problems = [];
  const reviews = [];

  // 1. Capital letters
  const letters = headingRaw.replace(/[^A-Za-z]/g, '');
  const lower = (letters.match(/[a-z]/g) || []).length;
  if (lower === 0) {
    // ok
  } else if (lower === 1 && /[l]/.test(letters)) {
    reviews.push('Heading looks all caps, but one letter was unclear. Confirm "GOVERNMENT WARNING" is in capitals.');
  } else {
    problems.push(`Heading reads "${headingRaw}". "GOVERNMENT WARNING" must be in all capital letters.`);
  }
  // 2. Colon
  if (!/:\s*$/.test(headingRaw)) {
    reviews.push(`Colon after "GOVERNMENT WARNING" was not detected (read as "${headingRaw}"). Please confirm.`);
  }
  // 3. Bold
  const bold = boldCheck(headWords, words.slice(bodyStart, bodyStart + 30), usedImage);
  if (!bold.known) {
    reviews.push('Could not measure whether the heading is bold. Please confirm "GOVERNMENT WARNING" is in bold type.');
  } else if (!bold.bold) {
    reviews.push('"GOVERNMENT WARNING" does not appear to be bold (its letters are no thicker than the rest). Please confirm.');
  }
  // 4. Exact wording
  const changed = ops.filter((o) => o.type === 'changed' || o.type === 'missing' || o.type === 'extra');
  const misread = ops.filter((o) => o.type === 'misread');
  if (changed.length) {
    problems.push(`Wording differs from the required statement in ${changed.length} place${changed.length > 1 ? 's' : ''}.`);
  }
  if (misread.length) {
    reviews.push(`${misread.length} word${misread.length > 1 ? 's' : ''} could be a misread by the scanner or a real typo (highlighted below). Please compare by eye.`);
  }

  const found = `${headingRaw} ${ops.filter((o) => o.found).map((o) => o.found).join(' ')}`;
  const status = problems.length ? FAIL : reviews.length ? REVIEW : PASS;
  const note = status === PASS
    ? 'Wording matches the required statement exactly, heading is in capitals and bold.'
    : [...problems, ...reviews].join(' ');
  return { ...base, status, found, note, problems, reviews, ops, heading: headingRaw, bold };
}
