// Estimate stroke thickness of text inside a bounding box.
// Bold type has thicker strokes than regular type at the same size, so the
// "GOVERNMENT WARNING" heading should measure noticeably thicker than the
// words that follow it. Works on a grayscale image: { gray, width, height }.

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/**
 * Average stroke width in pixels ≈ 2 × ink area ÷ ink perimeter.
 * Returns 0 if the box is unusable.
 */
export function strokeWidth(image, bbox) {
  const { gray, width, height } = image;
  const x0 = Math.max(0, Math.floor(bbox.x0));
  const y0 = Math.max(0, Math.floor(bbox.y0));
  const x1 = Math.min(width, Math.ceil(bbox.x1));
  const y1 = Math.min(height, Math.ceil(bbox.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return 0;

  const hist = new Uint32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[gray[y * width + x]]++;
  const t = otsu(hist, w * h);

  // Decide polarity: text is the minority class (dark-on-light or light-on-dark).
  let dark = 0;
  for (let i = 0; i <= t; i++) dark += hist[i];
  const inkIsDark = dark <= (w * h) / 2;

  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[(y + y0) * width + (x + x0)];
      ink[y * w + x] = inkIsDark ? (v <= t ? 1 : 0) : (v > t ? 1 : 0);
    }
  }
  let area = 0;
  let edge = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      area++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !ink[y * w + x - 1] || !ink[y * w + x + 1] || !ink[(y - 1) * w + x] || !ink[(y + 1) * w + x]) edge++;
    }
  }
  if (!edge || area < 10) return 0;
  return (2 * area) / edge;
}
