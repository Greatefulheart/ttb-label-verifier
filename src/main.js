import { batchConcurrency, readLabel, warmUp } from './ocr.js';
import { parseCsv, toCsv } from './lib/csv.js';
import { FIELDS, verifyLabel } from './lib/verify.js';
import { badge, esc, renderResult, STATUS_TEXT } from './ui/render.js';

const $ = (id) => document.getElementById(id);
const SAMPLE_BASE = `${import.meta.env.BASE_URL}samples/`;

// ---------------------------------------------------------------- engine
const engineStatus = $('engine-status');
warmUp(1)
  .then(() => { engineStatus.textContent = 'Label reader ready.'; engineStatus.className = 'engine ready'; })
  .catch((err) => {
    console.error(err);
    engineStatus.textContent = 'The label reader could not load. Please refresh the page.';
    engineStatus.className = 'engine error';
  });

// ---------------------------------------------------------------- tabs
const tabs = [['tab-single', 'view-single'], ['tab-batch', 'view-batch']];
for (const [tabId, viewId] of tabs) {
  $(tabId).addEventListener('click', () => {
    for (const [t, v] of tabs) {
      $(t).setAttribute('aria-selected', String(t === tabId));
      $(v).hidden = v !== viewId;
    }
  });
}

/** Make a <label class="drop"> accept dragged files. */
function wireDrop(zone, input, onFiles) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    onFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => onFiles([...input.files]));
}

const isImage = (f) => f && (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(f.name));

// ================================================================ ONE LABEL
let singleFile = null;
const fieldsBox = $('fields');
fieldsBox.innerHTML = FIELDS.map((f) => `
  <div class="field">
    <label for="f-${f.key}">${esc(f.label)}${f.required ? '' : ' <span class="opt">(if on the application)</span>'}</label>
    <input type="text" id="f-${f.key}" name="${f.key}" autocomplete="off" placeholder="e.g. ${esc(f.example)}" />
  </div>`).join('');

function setSingleFile(file) {
  $('single-error').hidden = true;
  if (!isImage(file)) {
    showSingleError('That file is not an image. Please choose a JPG or PNG picture of the label.');
    return;
  }
  singleFile = file;
  const img = $('single-img');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(file);
  $('single-filename').textContent = file.name;
  $('single-preview').hidden = false;
  $('single-results').innerHTML = '';
}

function showSingleError(msg) {
  const el = $('single-error');
  el.textContent = msg;
  el.hidden = false;
}

wireDrop($('single-drop'), $('single-file'), (files) => files[0] && setSingleFile(files[0]));

// Example labels come from the same CSV used for the example batch.
let sampleRows = [];
async function loadSampleRows() {
  if (sampleRows.length) return sampleRows;
  const res = await fetch(`${SAMPLE_BASE}batch-applications.csv`);
  sampleRows = parseCsv(await res.text());
  return sampleRows;
}
async function fetchSampleFile(name) {
  const res = await fetch(SAMPLE_BASE + name);
  if (!res.ok) throw new Error(`Could not load ${name}`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

loadSampleRows().then((rows) => {
  $('example-select').insertAdjacentHTML('beforeend', rows.map((r, i) =>
    `<option value="${i}">${esc(r.filename.replace(/^\d+-|\.\w+$/g, '').replace(/-/g, ' '))} — ${esc(r.expected)}</option>`).join(''));
}).catch(() => { $('example-select').disabled = true; });

$('example-select').addEventListener('change', async (e) => {
  const row = sampleRows[e.target.value];
  if (!row) return;
  try {
    setSingleFile(await fetchSampleFile(row.filename));
    for (const f of FIELDS) $(`f-${f.key}`).value = row[f.key] || '';
  } catch (err) {
    showSingleError('The example could not be loaded. Please check your connection and try again.');
  }
});

$('clear-btn').addEventListener('click', () => {
  singleFile = null;
  $('single-form').reset();
  $('single-file').value = '';
  $('single-preview').hidden = true;
  $('single-results').innerHTML = '';
  $('single-error').hidden = true;
  $('example-select').value = '';
});

$('single-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('single-error').hidden = true;
  const app = Object.fromEntries(FIELDS.map((f) => [f.key, $(`f-${f.key}`).value.trim()]));
  const brand = $('f-brand_name');
  brand.setAttribute('aria-invalid', String(!app.brand_name));
  if (!singleFile) return showSingleError('Please choose a label image first (step 1).');
  if (!app.brand_name) { brand.focus(); return showSingleError('Please enter at least the brand name from the application.'); }

  const out = $('single-results');
  const btn = $('check-btn');
  btn.disabled = true;
  out.innerHTML = '<div class="working"><span class="spinner" aria-hidden="true"></span> Reading the label…</div>';
  const t0 = performance.now();
  try {
    const ocr = await readLabel(singleFile);
    const result = verifyLabel(app, ocr);
    out.innerHTML = renderResult(result, { ms: performance.now() - t0 });
    out.focus();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    out.innerHTML = '';
    showSingleError('Sorry, this image could not be read. Try a different file, or refresh the page and try again.');
  } finally {
    btn.disabled = false;
  }
});

// ================================================================ MANY LABELS
const batch = { images: new Map(), rows: [], results: [], running: false, stop: false, filter: 'all' };
const keyOf = (name) => name.split(/[\\/]/).pop().trim().toLowerCase();

function updateBatchReady() {
  const n = batch.images.size;
  $('batch-image-count').textContent = n ? `${n} image${n > 1 ? 's' : ''} chosen.` : 'No images chosen yet.';
  $('batch-run').disabled = !n || batch.running;
  $('batch-run').lastChild.textContent = n ? ` Check ${n} label${n > 1 ? 's' : ''}` : ' Check all labels';
}

function addImages(files) {
  $('batch-error').hidden = true;
  const imgs = files.filter(isImage);
  for (const f of imgs) batch.images.set(keyOf(f.name), f);
  if (files.length && !imgs.length) showBatchError('None of those files are images.');
  updateBatchReady();
}

async function setCsv(file) {
  $('batch-error').hidden = true;
  if (!file) return;
  try {
    const rows = parseCsv(await file.text())
      .map((r) => ({ ...r, filename: r.filename ?? r.file_name ?? r.image ?? r.file ?? r.image_file }));
    if (!rows.length || !('filename' in rows[0])) throw new Error('missing filename column');
    batch.rows = rows;
    $('batch-csv-count').textContent = `${rows.length} application row${rows.length > 1 ? 's' : ''} loaded from ${file.name}.`;
  } catch {
    batch.rows = [];
    $('batch-csv-count').textContent = 'No CSV chosen yet.';
    showBatchError('That CSV could not be used. It needs a header row with a "filename" column — download the template to see the layout.');
  }
}

function showBatchError(msg) { const el = $('batch-error'); el.textContent = msg; el.hidden = false; }

wireDrop($('batch-drop'), $('batch-files'), addImages);
wireDrop($('csv-drop'), $('batch-csv'), (files) => setCsv(files.find((f) => /\.csv$/i.test(f.name)) || files[0]));

$('template-link').addEventListener('click', (e) => {
  e.preventDefault();
  const example = Object.fromEntries([['filename', 'label-001.jpg'], ...FIELDS.map((f) => [f.key, f.key === 'country_of_origin' ? '' : f.example])]);
  download('label-applications-template.csv', toCsv([example], ['filename', ...FIELDS.map((f) => f.key)]));
});

$('load-example-batch').addEventListener('click', async () => {
  try {
    const rows = await loadSampleRows();
    const files = await Promise.all(rows.map((r) => fetchSampleFile(r.filename)));
    batch.images.clear();
    addImages(files);
    batch.rows = rows;
    $('batch-csv-count').textContent = `${rows.length} application rows loaded (example batch).`;
  } catch {
    showBatchError('The example batch could not be loaded.');
  }
});

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('batch-run').addEventListener('click', runBatch);
$('batch-stop').addEventListener('click', () => { batch.stop = true; $('batch-stop').disabled = true; });

async function runBatch() {
  const rowsByFile = new Map(batch.rows.map((r) => [keyOf(r.filename), r]));
  const queue = [...batch.images.entries()].sort(([a], [b]) => a.localeCompare(b));
  batch.results = queue.map(([key, file]) => ({ key, file, app: rowsByFile.get(key), status: 'queued' }));
  // Rows that have no matching image are reported too, so nothing is silently dropped.
  for (const [key, app] of rowsByFile) {
    if (!batch.images.has(key)) batch.results.push({ key, file: null, app, status: 'review', summary: 'No image with this file name was provided.' });
  }
  batch.running = true;
  batch.stop = false;
  $('batch-results').hidden = false;
  $('batch-run').disabled = true;
  $('batch-stop').hidden = false;
  $('batch-stop').disabled = false;
  $('batch-export').disabled = true;
  renderBatch();

  const t0 = performance.now();
  const workers = batchConcurrency();
  warmUp(workers);
  let cursor = 0;
  const todo = batch.results.filter((r) => r.status === 'queued');
  async function lane() {
    while (!batch.stop && cursor < todo.length) {
      const item = todo[cursor++];
      item.status = 'working';
      if (!item.app) {
        item.status = 'review';
        item.summary = 'No application row in the CSV for this image, so it was not checked.';
      } else {
        try {
          const result = verifyLabel(item.app, await readLabel(item.file));
          Object.assign(item, { status: result.status, summary: result.summary, result });
        } catch (err) {
          console.error(err);
          Object.assign(item, { status: 'review', summary: 'This image could not be read. Check the file and try again.' });
        }
      }
      renderBatch(performance.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: workers }, lane));
  for (const r of batch.results) if (r.status === 'queued' || r.status === 'working') { r.status = 'skipped'; r.summary = 'Stopped before this label was checked.'; }
  batch.running = false;
  $('batch-stop').hidden = true;
  $('batch-export').disabled = false;
  updateBatchReady();
  renderBatch(performance.now() - t0, true);
}

function renderBatch(elapsed = 0, finished = false) {
  const all = batch.results;
  const done = all.filter((r) => ['pass', 'review', 'fail', 'skipped'].includes(r.status)).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  $('batch-bar').style.width = `${pct}%`;
  const rate = done && elapsed ? ` · about ${(elapsed / 1000 / done).toFixed(1)} s per label` : '';
  $('batch-progress-text').textContent = finished
    ? `Finished: ${done} of ${all.length} labels in ${(elapsed / 1000).toFixed(0)} seconds${rate}.`
    : `Checking… ${done} of ${all.length} done${rate}.`;

  const n = (s) => all.filter((r) => r.status === s).length;
  $('batch-tallies').innerHTML = ['pass', 'review', 'fail'].map((s) =>
    `<div class="tally ${s}"><strong>${n(s)}</strong>${{ pass: 'Passed', review: 'Need review', fail: 'Problems found' }[s]}</div>`).join('');

  const shown = all.filter((r) => batch.filter === 'all' || r.status === batch.filter);
  const order = { fail: 0, review: 1, pass: 2, working: 3, queued: 4, skipped: 5 };
  const sorted = finished || batch.filter !== 'all' ? [...shown].sort((a, b) => order[a.status] - order[b.status]) : shown;
  $('batch-rows').innerHTML = sorted.map((r) => {
    const i = all.indexOf(r);
    const result = STATUS_TEXT[r.status]
      ? badge(r.status)
      : `<span class="badge">${{ queued: 'Waiting', working: 'Reading…', skipped: 'Not checked' }[r.status]}</span>`;
    return `<tr>
      <td class="file">${esc(r.file?.name || r.app?.filename || r.key)}</td>
      <td>${esc(r.app?.brand_name || '—')}</td>
      <td>${result}<span class="summary">${esc(r.summary || '')}</span></td>
      <td>${r.result ? `<button type="button" class="btn link" data-detail="${i}" aria-expanded="false">Show details</button>` : ''}</td>
    </tr><tr class="detail" id="detail-${i}" hidden><td colspan="4"></td></tr>`;
  }).join('');
}

$('batch-rows').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-detail]');
  if (!btn) return;
  const i = Number(btn.dataset.detail);
  const row = $(`detail-${i}`);
  const open = row.hidden;
  row.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide details' : 'Show details';
  if (open) row.firstElementChild.innerHTML = renderResult(batch.results[i].result);
});

document.querySelector('.filters').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  batch.filter = chip.dataset.filter;
  document.querySelectorAll('.filters .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  renderBatch(0, !batch.running);
});

$('batch-export').addEventListener('click', () => {
  const ids = ['brand', 'class', 'alcohol', 'net', 'bottler', 'origin', 'warning'];
  const rows = batch.results.map((r) => {
    const out = { filename: r.file?.name || r.app?.filename || r.key, brand_name: r.app?.brand_name || '', overall: r.status, summary: r.summary || '' };
    for (const id of ids) {
      const c = r.result?.checks.find((x) => x.id === id);
      out[`${id}_result`] = c ? c.status : '';
      out[`${id}_note`] = c ? c.note : '';
    }
    return out;
  });
  const cols = ['filename', 'brand_name', 'overall', 'summary', ...ids.flatMap((id) => [`${id}_result`, `${id}_note`])];
  download(`label-check-results-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols));
});
