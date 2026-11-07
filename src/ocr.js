// Browser OCR: loads the self-hosted Tesseract engine and reads one label.
// Two passes run in parallel on two workers:
//   - "auto" layout: best for paragraphs (the government warning)
//   - "sparse text": finds scattered display text (big brand names, ABV)
import { createWorker } from 'tesseract.js';
import { grayToRgba, targetScale, toGrayStretched } from './lib/preprocess.js';

const asset = (p) => new URL(`${import.meta.env.BASE_URL}tesseract/${p}`, window.location.href).href;

async function makeWorker(psm) {
  const worker = await createWorker('eng', 1, {
    workerPath: asset('worker.min.js'),
    corePath: asset('core'),
    langPath: asset('lang').replace(/\/$/, ''),
  });
  if (psm) await worker.setParameters({ tessedit_pageseg_mode: psm });
  return worker;
}

/** A pair of workers that together read one label. */
class Reader {
  constructor() { this.ready = Promise.all([makeWorker(null), makeWorker('11')]); }
  async read(canvas) {
    const [auto, sparse] = await this.ready;
    const [a, b] = await Promise.all([
      auto.recognize(canvas, {}, { text: true, blocks: true }),
      sparse.recognize(canvas, {}, { text: true, blocks: true }),
    ]);
    return [a.data, b.data];
  }
  async terminate() { (await this.ready).forEach((w) => w.terminate()); }
}

let pool = [];
let next = 0;

/** Start loading the engine early so the first check is fast. */
export function warmUp(size = 1) {
  while (pool.length < size) pool.push(new Reader());
  return Promise.all(pool.map((r) => r.ready));
}

/** How many labels to read at once in batch mode (each uses 2 workers). */
export function batchConcurrency() {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/** Decode, orient (EXIF), resize and clean up an image file. */
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = targetScale(bitmap.width, bitmap.height);
  const width = Math.round(bitmap.width * s);
  const height = Math.round(bitmap.height * s);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = toGrayStretched(data, width, height);
  ctx.putImageData(new ImageData(grayToRgba(gray), width, height), 0, 0);
  return { canvas, image: { gray, width, height } };
}

const wordsOf = (data) => (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));

/** Read a label image file. Returns the input expected by verifyLabel(). */
export async function readLabel(file) {
  if (!pool.length) warmUp(1);
  const reader = pool[next++ % pool.length];
  const { canvas, image } = await prepareImage(file);
  const [auto, sparse] = await reader.read(canvas);
  return {
    passes: [
      { text: auto.text, words: wordsOf(auto) },
      { text: sparse.text, words: wordsOf(sparse) },
    ],
    image,
    confidence: auto.confidence,
  };
}
