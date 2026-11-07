// Image clean-up applied before OCR. Pure function on pixel arrays so the
// same code runs in the browser (canvas) and in Node tests.

/** Target size for OCR: small photos are upscaled, huge ones shrunk for speed. */
export function targetScale(width, height) {
  const longest = Math.max(width, height);
  if (longest < 1400) return Math.min(2.5, 1600 / longest);
  if (longest > 2600) return 2400 / longest;
  return 1;
}

/**
 * RGBA -> grayscale with a percentile contrast stretch, which evens out dim
 * photos and softens glare. Returns a Uint8Array (one byte per pixel).
 */
export function toGrayStretched(rgba, width, height) {
  const n = width * height;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    gray[i] = v;
    hist[gray[i]]++;
  }
  const pick = (frac) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * frac) return i; }
    return 255;
  };
  const lo = pick(0.01);
  const hi = pick(0.99);
  if (hi - lo > 20) {
    const scale = 255 / (hi - lo);
    for (let i = 0; i < n; i++) gray[i] = Math.max(0, Math.min(255, (gray[i] - lo) * scale));
  }
  return gray;
}

/** Expand grayscale back to RGBA (what canvas and Tesseract expect). */
export function grayToRgba(gray) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = gray[i];
    out[p + 3] = 255;
  }
  return out;
}
