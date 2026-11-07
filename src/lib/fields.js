// Field-by-field comparisons between the application (COLA form data)
// and the text read off the label.
import { bestMatch, foldChars, loose, tidy } from './text.js';

export const PASS = 'pass';
export const REVIEW = 'review';
export const FAIL = 'fail';

const stripEdgePunct = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '');

/**
 * Text fields (brand, class/type, bottler, country): judged on wording,
 * not on capitalization or punctuation. That is what an experienced agent
 * does by eye ("STONE'S THROW" vs "Stone's Throw" is the same brand).
 */
export function checkTextField({ id, label, expected, ocrText, passAt = 0.9, reviewAt = 0.72 }) {
  const base = { id, label, expected: tidy(expected) };
  if (!tidy(expected)) {
    return { ...base, status: PASS, found: '', note: 'Not provided on the application, so not checked.', skipped: true };
  }
  const m = bestMatch(expected, ocrText);
  const found = stripEdgePunct(m.raw);
  if (m.score >= 0.999) {
    const exact = tidy(found) === tidy(expected);
    return {
      ...base, status: PASS, found, score: m.score,
      note: exact ? 'Matches the application exactly.'
        : 'Same wording. Only capitalization or punctuation differs, which is acceptable.',
    };
  }
  if (m.score >= passAt) {
    return {
      ...base, status: PASS, found, score: m.score,
      note: 'Matches, allowing for a character or two the scanner may have misread.',
    };
  }
  if (m.score >= reviewAt) {
    return {
      ...base, status: REVIEW, found, score: m.score,
      note: 'Close but not identical. Please compare this field on the label by eye.',
    };
  }
  return {
    ...base, status: FAIL, found: m.score > 0.4 ? found : '', score: m.score,
    note: 'Could not find this on the label. Check that the label shows it, or that the image is readable.',
  };
}

// ---------------- Alcohol content ----------------

/** Pull "45%" style numbers and proof numbers out of text. */
export function parseAlcohol(text) {
  const t = foldChars(text).replace(/,(?=\d)/g, '.');
  const percents = [...t.matchAll(/(\d{1,2}(?:\.\d{1,2})?)\s*%/g)].map((m) => parseFloat(m[1]));
  // "ABV 6.8" / "Alc. 13.5 by vol" without a % sign
  for (const m of t.matchAll(/(?:abv|alc(?:ohol)?\.?)\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)(?!\s*%)/gi)) {
    percents.push(parseFloat(m[1]));
  }
  const proofs = [...t.matchAll(/(\d{2,3}(?:\.\d)?)\s*(?:°\s*)?proof/gi)].map((m) => parseFloat(m[1]));
  return { percents: [...new Set(percents)], proofs: [...new Set(proofs)] };
}

export function checkAlcohol({ expected, ocrText }) {
  const base = { id: 'alcohol', label: 'Alcohol content', expected: tidy(expected) };
  if (!tidy(expected)) {
    return { ...base, status: PASS, found: '', skipped: true, note: 'Not provided on the application, so not checked.' };
  }
  const want = parseAlcohol(expected);
  const wantPct = want.percents[0] ?? (want.proofs[0] ? want.proofs[0] / 2 : undefined);
  if (wantPct === undefined) {
    return { ...base, status: REVIEW, found: '', note: 'Could not read a percentage in the application value. Please check by eye.' };
  }
  const got = parseAlcohol(ocrText);
  const foundStr = [
    ...got.percents.map((p) => `${p}%`),
    ...got.proofs.map((p) => `${p} Proof`),
  ].join(', ');
  if (!got.percents.length && !got.proofs.length) {
    return { ...base, status: FAIL, found: '', note: 'No alcohol content statement was found on the label.' };
  }
  const near = (a, b) => Math.abs(a - b) < 0.051;
  const pctOk = got.percents.some((p) => near(p, wantPct));
  // A proof statement on the label must agree with the percentage (proof = 2 x ABV).
  const badProof = got.proofs.find((p) => !near(p, wantPct * 2));
  if (pctOk && badProof === undefined) {
    return { ...base, status: PASS, found: foundStr, note: 'Matches the application.' };
  }
  if (pctOk && badProof !== undefined) {
    return { ...base, status: FAIL, found: foundStr, note: `Percentage matches, but ${badProof} proof does not equal ${wantPct * 2} proof (proof must be twice the % alcohol).` };
  }
  const shown = got.percents.length ? `${got.percents.join('% / ')}%` : `${got.proofs[0]} proof`;
  return { ...base, status: FAIL, found: foundStr, note: `Label shows ${shown}; application says ${wantPct}%.` };
}

// ---------------- Net contents ----------------

const UNIT_ML = [
  [/^(ml|milliliters?|millilitres?)$/, 1],
  [/^(cl|centiliters?|centilitres?)$/, 10],
  [/^(l|liters?|litres?|ltr)$/, 1000],
  [/^(fl ?oz|fluid ?ounces?|oz|ounces?)$/, 29.5735],
  [/^(pints?|pt)$/, 473.176],
  [/^(gal|gallons?)$/, 3785.41],
];

/** Find every "<number> <unit>" volume in text, converted to millilitres. */
export function parseVolumes(text) {
  const t = foldChars(text).toLowerCase().replace(/,(?=\d)/g, '.').replace(/fl\.\s*/g, 'fl ').replace(/oz\./g, 'oz');
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(milliliters?|millilitres?|ml|centiliters?|centilitres?|cl|liters?|litres?|ltr|l|fl ?oz|fluid ?ounces?|ounces?|oz|pints?|pt|gallons?|gal)\b/g;
  for (const m of t.matchAll(re)) {
    const unit = m[2].replace(/\s+/g, ' ');
    const factor = UNIT_ML.find(([r]) => r.test(unit))?.[1];
    if (factor) out.push({ ml: parseFloat(m[1]) * factor, text: m[0] });
  }
  return out;
}

export function checkNetContents({ expected, ocrText }) {
  const base = { id: 'net', label: 'Net contents', expected: tidy(expected) };
  if (!tidy(expected)) {
    return { ...base, status: PASS, found: '', skipped: true, note: 'Not provided on the application, so not checked.' };
  }
  const want = parseVolumes(expected)[0];
  if (!want) {
    return { ...base, status: REVIEW, found: '', note: 'Could not read a volume in the application value. Please check by eye.' };
  }
  const got = parseVolumes(ocrText);
  if (!got.length) {
    return { ...base, status: FAIL, found: '', note: 'No net contents statement was found on the label.' };
  }
  // 1.5% tolerance covers metric/US rounding (12 fl oz = 354.9 mL, labeled 355 mL).
  const hit = got.find((g) => Math.abs(g.ml - want.ml) / want.ml <= 0.015);
  const found = [...new Set(got.map((g) => g.text))].join(', ');
  if (hit) {
    const sameUnits = loose(hit.text).replace(/\s/g, '') === loose(want.text).replace(/\s/g, '');
    return {
      ...base, status: PASS, found,
      note: sameUnits ? 'Matches the application.' : `Equivalent amounts (${hit.text} ≈ ${Math.round(want.ml)} mL).`,
    };
  }
  return { ...base, status: FAIL, found, note: `Label shows ${got[0].text}; application says ${tidy(expected)}.` };
}
