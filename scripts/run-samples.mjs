// End-to-end check: real OCR + verification on every sample in the batch CSV.
// Usage: node scripts/run-samples.mjs [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { parseCsv } from '../src/lib/csv.js';
import { targetScale, toGrayStretched } from '../src/lib/preprocess.js';
import { verifyLabel } from '../src/lib/verify.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'public/samples');
const rows = parseCsv(fs.readFileSync(path.join(dir, 'batch-applications.csv'), 'utf8'));
const verbose = process.argv.includes('--verbose');

const opts = { langPath: path.join(root, 'public/tesseract/lang'), cacheMethod: 'none' };
const [auto, sparse] = await Promise.all([createWorker('eng', 1, opts), createWorker('eng', 1, opts)]);
await sparse.setParameters({ tessedit_pageseg_mode: '11' });

const words = (data) => (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));

for (const row of rows) {
  const t0 = Date.now();
  const meta = await sharp(path.join(dir, row.filename)).metadata();
  const s = targetScale(meta.width, meta.height);
  const { data: rgba, info } = await sharp(path.join(dir, row.filename)).rotate()
    .resize(Math.round(meta.width * s)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const gray = toGrayStretched(rgba, info.width, info.height);
  const png = await sharp(Buffer.from(gray), { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
  const [a, b] = await Promise.all([
    auto.recognize(png, {}, { text: true, blocks: true }),
    sparse.recognize(png, {}, { text: true, blocks: true }),
  ]);
  const result = verifyLabel(row, {
    passes: [
      { text: a.data.text, words: words(a.data) },
      { text: b.data.text, words: words(b.data) },
    ],
    image: { gray, width: info.width, height: info.height },
    confidence: a.data.confidence,
  });
  const ms = Date.now() - t0;
  console.log(`\n${row.filename}  [${result.status.toUpperCase()}] ${result.summary}  (${ms} ms)`);
  console.log(`   expected: ${row.expected}`);
  for (const c of result.checks) {
    if (verbose || c.status !== 'pass') console.log(`   - ${c.status.padEnd(6)} ${c.label}: found "${(c.found || '').slice(0, 70)}" — ${c.note}`);
    if (c.id === 'warning' && c.bold?.known) console.log(`     bold ratio ${c.bold.ratio.toFixed(2)}`);
    if (c.id === 'warning' && c.ops) {
      const bad = c.ops.filter((o) => o.type !== 'ok');
      if (bad.length) console.log('     diff:', bad.map((o) => `${o.type}(${o.expected ?? ''}→${o.found ?? ''})`).join(' '));
    }
  }
}
await auto.terminate();
await sparse.terminate();
