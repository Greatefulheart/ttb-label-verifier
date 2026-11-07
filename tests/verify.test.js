import { describe, expect, it } from 'vitest';
import { checkAlcohol, checkNetContents, checkTextField, parseAlcohol, parseVolumes } from '../src/lib/fields.js';
import { alignBody, checkWarning, WARNING_BODY, WARNING_FULL } from '../src/lib/warning.js';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import { verifyLabel } from '../src/lib/verify.js';

const words = (text) => text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 10 } }));
const pass = (text) => ({ text, words: words(text) });

describe('brand / text fields', () => {
  it('passes an exact match', () => {
    const r = checkTextField({ id: 'brand', label: 'Brand', expected: 'OLD TOM DISTILLERY', ocrText: 'Est. 1891\nOLD TOM DISTILLERY\nKentucky' });
    expect(r.status).toBe('pass');
    expect(r.note).toMatch(/exactly/);
  });
  it("treats capitalization-only differences as the same brand (STONE'S THROW vs Stone's Throw)", () => {
    const r = checkTextField({ id: 'brand', label: 'Brand', expected: "Stone's Throw", ocrText: "Small Batch\nSTONE’S THROW\nRye" });
    expect(r.status).toBe('pass');
    expect(r.found).toBe("STONE'S THROW");
    expect(r.note).toMatch(/capitalization/);
  });
  it('ignores accents the scanner drops (Château vs CHATEAU)', () => {
    expect(checkTextField({ id: 'b', label: 'B', expected: 'Château Belle Rive', ocrText: 'CHATEAU BELLE RIVE' }).status).toBe('pass');
  });
  it('asks for review on a near match', () => {
    const r = checkTextField({ id: 'b', label: 'B', expected: 'Harbor Light', ocrText: 'HARBOUR LIGHTS Brewing' });
    expect(r.status).toBe('review');
  });
  it('fails when the brand is not on the label', () => {
    expect(checkTextField({ id: 'b', label: 'B', expected: 'Blue Ridge', ocrText: 'OLD TOM DISTILLERY 750 mL' }).status).toBe('fail');
  });
  it('skips empty application fields', () => {
    expect(checkTextField({ id: 'b', label: 'B', expected: '', ocrText: 'anything' }).skipped).toBe(true);
  });
});

describe('alcohol content', () => {
  it('parses percent and proof', () => {
    expect(parseAlcohol('45% Alc./Vol. (90 Proof)')).toEqual({ percents: [45], proofs: [90] });
    expect(parseAlcohol('ALC 13.5% BY VOL').percents).toContain(13.5);
    expect(parseAlcohol('ABV 6.8').percents).toContain(6.8);
  });
  it('passes when the numbers agree', () => {
    expect(checkAlcohol({ expected: '45% Alc./Vol.', ocrText: '45% Alc./Vol. (90 Proof)' }).status).toBe('pass');
  });
  it('fails on a different percentage', () => {
    const r = checkAlcohol({ expected: '45%', ocrText: '40% Alc./Vol. (80 Proof)' });
    expect(r.status).toBe('fail');
    expect(r.note).toMatch(/40%.*45%/);
  });
  it('fails when proof on the label contradicts the percentage', () => {
    expect(checkAlcohol({ expected: '45%', ocrText: '45% Alc./Vol. (80 Proof)' }).status).toBe('fail');
  });
  it('fails when no alcohol statement is found', () => {
    expect(checkAlcohol({ expected: '45%', ocrText: 'OLD TOM 750 mL' }).status).toBe('fail');
  });
});

describe('net contents', () => {
  it('parses common units', () => {
    expect(parseVolumes('750 mL')[0].ml).toBe(750);
    expect(parseVolumes('1.75 L')[0].ml).toBe(1750);
    expect(Math.round(parseVolumes('12 FL. OZ.')[0].ml)).toBe(355);
    expect(parseVolumes('75 cl')[0].ml).toBe(750);
  });
  it('accepts equivalent amounts in different units', () => {
    const r = checkNetContents({ expected: '355 mL', ocrText: '12 FL. OZ.' });
    expect(r.status).toBe('pass');
    expect(r.note).toMatch(/Equivalent/);
  });
  it('fails on a different volume', () => {
    expect(checkNetContents({ expected: '750 mL', ocrText: '700 mL' }).status).toBe('fail');
  });
});

describe('government warning', () => {
  it('passes the exact statement', () => {
    const r = checkWarning({ passes: [pass(`Bourbon 750 mL ${WARNING_FULL}`)] });
    // No image supplied, so boldness can't be measured: ask the agent to confirm.
    expect(r.problems).toEqual([]);
    expect(r.reviews.join(' ')).toMatch(/bold/);
  });
  it('fails title-case "Government Warning"', () => {
    const r = checkWarning({ passes: [pass(`Government Warning: ${WARNING_BODY}`)] });
    expect(r.status).toBe('fail');
    expect(r.note).toMatch(/capital/);
  });
  it('fails altered wording', () => {
    const r = checkWarning({ passes: [pass(`GOVERNMENT WARNING: ${WARNING_BODY.replace('may cause health problems', 'may cause problems')}`)] });
    expect(r.status).toBe('fail');
    expect(r.ops.some((o) => o.type === 'missing' && o.expected === 'health')).toBe(true);
  });
  it('fails when the warning is absent', () => {
    expect(checkWarning({ passes: [pass('OLD TOM DISTILLERY 45% 750 mL')] }).status).toBe('fail');
  });
  it('flags a likely OCR misread for review instead of rejecting', () => {
    const r = checkWarning({ passes: [pass(`GOVERNMENT WARNING: ${WARNING_BODY.replace('because', 'pecause')}`)] });
    expect(r.problems).toEqual([]);
    expect(r.ops.find((o) => o.type === 'misread').expected).toBe('because');
  });
  it('does not penalise text that follows the warning', () => {
    const ops = alignBody(['a', 'b', 'c'], ['a', 'b', 'c', 'Bottled', 'in', 'USA']);
    expect(ops.every((o) => o.type === 'ok')).toBe(true);
  });
});

describe('verifyLabel roll-up', () => {
  const app = { brand_name: 'OLD TOM DISTILLERY', class_type: 'Kentucky Straight Bourbon Whiskey', alcohol_content: '45%', net_contents: '750 mL', bottler: '', country_of_origin: '' };
  it('fails overall if any check fails', () => {
    const r = verifyLabel(app, { passes: [pass(`OLD TOM DISTILLERY Kentucky Straight Bourbon Whiskey 40% 750 mL ${WARNING_FULL}`)] });
    expect(r.status).toBe('fail');
  });
  it('skips fields left blank', () => {
    const r = verifyLabel(app, { passes: [pass('x')] });
    expect(r.checks.map((c) => c.id)).not.toContain('bottler');
  });
});

describe('csv', () => {
  it('round-trips quoted values', () => {
    const csv = toCsv([{ filename: 'a.png', brand_name: 'Stone\'s "Throw", Inc' }], ['filename', 'brand_name']);
    expect(parseCsv(csv)).toEqual([{ filename: 'a.png', brand_name: 'Stone\'s "Throw", Inc' }]);
  });
  it('normalises header names', () => {
    expect(parseCsv('File Name,Brand Name\nx.png,Y')[0]).toEqual({ file_name: 'x.png', brand_name: 'Y' });
  });
});
