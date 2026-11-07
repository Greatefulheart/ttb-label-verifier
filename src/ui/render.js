// Turns a verifyLabel() result into HTML.

export const STATUS_TEXT = {
  pass: { word: 'Match', icon: '✓', headline: 'Label matches the application' },
  review: { word: 'Check by eye', icon: '!', headline: 'Needs your review' },
  fail: { word: 'Mismatch', icon: '✕', headline: 'Problems found' },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function badge(status) {
  const t = STATUS_TEXT[status];
  return `<span class="badge ${status}"><span aria-hidden="true">${t.icon}</span> ${t.word}</span>`;
}

function warningDiff(check) {
  if (!check.ops) return '';
  const hasIssue = check.ops.some((o) => o.type !== 'ok');
  if (!hasIssue) return '';
  const parts = check.ops.map((o) => {
    switch (o.type) {
      case 'ok': return esc(o.found);
      case 'misread': return `<span class="w-misread" title="Required: ${esc(o.expected)}">${esc(o.found)}</span> <small>(should be “${esc(o.expected)}”)</small>`;
      case 'changed': return `<span class="w-changed" title="Required: ${esc(o.expected)}">${esc(o.found)}</span> <small>(should be “${esc(o.expected)}”)</small>`;
      case 'missing': return `<span class="w-missing" title="Missing from label">${esc(o.expected)}</span>`;
      case 'extra': return `<span class="w-extra" title="Not in the required wording">${esc(o.found)}</span>`;
      default: return '';
    }
  });
  return `<div class="diff" aria-label="Warning text as read from the label"><strong>${esc(check.heading)}</strong> ${parts.join(' ')}</div>
    <p class="legend">Yellow: possibly misread — compare by eye. Red: different wording. Struck through: missing from label.</p>`;
}

export function renderCheck(c) {
  const isWarning = c.id === 'warning';
  const compare = isWarning ? '' : `
    <dl class="compare">
      <dt>Application:</dt><dd>${esc(c.expected)}</dd>
      <dt>On label:</dt><dd>${c.found ? esc(c.found) : '<em>not found</em>'}</dd>
    </dl>`;
  return `<li class="check ${c.status}">
    <div class="check-head">${badge(c.status)}<h3>${esc(c.label)}</h3></div>
    ${compare}
    <p class="why">${esc(c.note)}</p>
    ${isWarning ? warningDiff(c) : ''}
  </li>`;
}

/** Full result block: verdict banner, checks (problems first), raw text. */
export function renderResult(result, { ms, filename } = {}) {
  const t = STATUS_TEXT[result.status];
  const order = { fail: 0, review: 1, pass: 2 };
  const checks = [...result.checks].sort((a, b) => order[a.status] - order[b.status]);
  return `
    <div class="verdict ${result.status}-tone">
      <span class="icon" aria-hidden="true">${t.icon}</span>
      <div>
        <h2>${t.headline}</h2>
        <p>${esc(result.summary)}</p>
        ${ms ? `<p class="timing">Checked${filename ? ` ${esc(filename)}` : ''} in ${(ms / 1000).toFixed(1)} seconds.</p>` : ''}
      </div>
    </div>
    <ul class="checks">${checks.map(renderCheck).join('')}</ul>
    <details class="raw"><summary>Show all text the scanner read from the label</summary><pre>${esc(result.ocrText.trim())}</pre></details>`;
}
