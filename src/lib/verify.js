// Runs every check for one label and rolls them up into a single verdict.
import { checkAlcohol, checkNetContents, checkTextField, FAIL, PASS, REVIEW } from './fields.js';
import { checkWarning } from './warning.js';

export { PASS, REVIEW, FAIL };

/** Field definitions shared by the form, the CSV template and the checks. */
export const FIELDS = [
  { key: 'brand_name', label: 'Brand name', required: true, example: 'OLD TOM DISTILLERY' },
  { key: 'class_type', label: 'Class / type', required: true, example: 'Kentucky Straight Bourbon Whiskey' },
  { key: 'alcohol_content', label: 'Alcohol content', required: false, example: '45% Alc./Vol. (90 Proof)' },
  { key: 'net_contents', label: 'Net contents', required: true, example: '750 mL' },
  { key: 'bottler', label: 'Bottler / producer name and address', required: false, example: 'Old Tom Distillery, Bardstown, Kentucky' },
  { key: 'country_of_origin', label: 'Country of origin (imports only)', required: false, example: 'France' },
];

/**
 * @param {object} app  application values keyed by FIELDS[].key
 * @param {object} ocr  { passes: [{ text, words }], image?: { gray, width, height }, confidence }
 */
export function verifyLabel(app, ocr) {
  const ocrText = ocr.passes.map((p) => p.text).join('\n');
  const checks = [
    checkTextField({ id: 'brand', label: 'Brand name', expected: app.brand_name, ocrText }),
    checkTextField({ id: 'class', label: 'Class / type', expected: app.class_type, ocrText }),
    checkAlcohol({ expected: app.alcohol_content, ocrText }),
    checkNetContents({ expected: app.net_contents, ocrText }),
    checkTextField({ id: 'bottler', label: 'Bottler / producer', expected: app.bottler, ocrText, passAt: 0.86, reviewAt: 0.68 }),
    checkTextField({ id: 'origin', label: 'Country of origin', expected: app.country_of_origin, ocrText }),
    checkWarning({ passes: ocr.passes, image: ocr.image }),
  ].filter((c) => !c.skipped);

  const count = (s) => checks.filter((c) => c.status === s).length;
  const fails = count(FAIL);
  const reviews = count(REVIEW);
  const status = fails ? FAIL : reviews ? REVIEW : PASS;

  // Low OCR confidence usually means a poor photo: say so rather than guess.
  const lowQuality = typeof ocr.confidence === 'number' && ocr.confidence < 55;
  let summary;
  if (status === PASS) summary = 'All checks passed.';
  else if (status === REVIEW) summary = `${reviews} item${reviews > 1 ? 's need' : ' needs'} your review.`;
  else summary = `${fails} problem${fails > 1 ? 's' : ''} found${reviews ? `, ${reviews} more to review` : ''}.`;
  if (lowQuality) summary += ' The image was hard to read; a clearer photo may help.';

  return { status, summary, checks, ocrText, lowQuality };
}
