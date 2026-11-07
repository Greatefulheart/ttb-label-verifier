// Text helpers shared by every check. Pure functions: no DOM, no OCR.

/** Remove accents (Château -> Chateau) and unify look-alike punctuation. */
export function foldChars(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
}

/** Loose form used for "is this the same thing?" comparisons. */
export function loose(s) {
  return foldChars(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%.\s]/g, ' ') // drop punctuation except % and .
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ') // keep decimal points only
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse whitespace but keep case and punctuation. */
export function tidy(s) {
  return foldChars(s).replace(/\s+/g, ' ').trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 0..1 similarity based on edit distance. */
export function similarity(a, b) {
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/**
 * Find the stretch of OCR text that best matches `target`.
 * Slides a word window over each line (and across line breaks) and returns
 * the best-scoring span, both in loose form and in its original wording.
 */
export function bestMatch(target, ocrText) {
  const want = loose(target);
  const wantLen = want.split(' ').filter(Boolean).length;
  if (!wantLen) return { score: 0, text: '', raw: '' };

  // A line consisting of exactly this text (e.g. the brand headline) beats the
  // same words appearing inside a longer line such as the bottler's address.
  const wholeLine = String(ocrText).split(/\n/).map((l) => tidy(l)).find((l) => loose(l) === want);
  if (wholeLine) return { score: 1, text: want, raw: wholeLine, exact: wholeLine === tidy(target) };

  // Keep original tokens alongside loose ones so we can show the agent what
  // the label actually says (with its real capitalization).
  const rawTokens = tidy(ocrText).split(' ').filter(Boolean);
  const pairs = rawTokens
    .map((raw) => ({ raw, lo: loose(raw) }))
    .filter((t) => t.lo);

  let best = { score: 0, text: '', raw: '' };
  for (let size = Math.max(1, wantLen - 1); size <= wantLen + 1; size++) {
    for (let i = 0; i + size <= pairs.length; i++) {
      const slice = pairs.slice(i, i + size);
      const text = slice.map((t) => t.lo).join(' ');
      const score = similarity(want, text);
      const raw = slice.map((t) => t.raw).join(' ');
      // On a tie, prefer the occurrence that matches the exact capitalization
      // (e.g. the brand headline rather than the same words in the address).
      const exact = raw.replace(/[^\p{L}\p{N}' ]/gu, '') === tidy(target).replace(/[^\p{L}\p{N}' ]/gu, '');
      if (score > best.score || (score === best.score && exact && !best.exact)) best = { score, text, raw, exact };
    }
  }
  return best;
}
