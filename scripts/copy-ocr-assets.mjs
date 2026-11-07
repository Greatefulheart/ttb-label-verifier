// Copies the OCR engine (worker, WebAssembly core, English model) from
// node_modules into public/ so the app serves everything itself.
// No requests go to third-party CDNs at runtime — important on networks that
// block outbound traffic.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'public', 'tesseract', ...p);

fs.mkdirSync(out('core'), { recursive: true });
fs.mkdirSync(out('lang'), { recursive: true });
fs.copyFileSync(nm('tesseract.js/dist/worker.min.js'), out('worker.min.js'));
// We run the LSTM engine only (oem 1), so only the -lstm builds are needed.
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  fs.copyFileSync(nm('tesseract.js-core', f), out('core', f));
}
// "best_int": the more accurate integer model, still only ~3 MB.
fs.copyFileSync(nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), out('lang', 'eng.traineddata.gz'));
console.log('OCR assets copied to public/tesseract');
