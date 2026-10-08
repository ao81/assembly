'use strict';

const { randomBytes } = require('node:crypto');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => n.toString(16).toUpperCase().padStart(4, '0');

function renderTrace(result, name) {
  const nonce = randomBytes(16).toString('hex');
  const used = new Set(result.rows.flatMap(row => [...row.reads, ...row.writes]));
  const registers = Array.from({ length: 8 }, (_, i) => i).filter(i => used.has(i));
  const number = n => `<span data-word="${n}">${hex(n)}</span>`;
  const cell = (value, written, read, isFlag = false) => {
    const kind = written ? 'write' : read ? 'read' : '';
    const title = written && read ? '更新・参照' : written ? '更新' : read ? '参照' : '保持';
    return `<td class="${kind}" title="${title}">${isFlag ? value : number(value)}</td>`;
  };
  const stateCells = row => registers.map(i => cell(row.gr[i], row.writes?.includes(i), row.reads?.includes(i))).join('') +
    ['OF', 'SF', 'ZF'].map(f => cell(row.flags[f], row.flagWrites?.includes(f), row.flagReads?.includes(f), true)).join('') + `<td>${hex(row.sp)}</td>`;
  const rows = result.rows.map(row => `<tr><td>${row.step}</td><td>${hex(row.pr)}</td><td>${row.line}</td><td class="source">${escape(row.source.trim())}</td>${stateCells(row)}<td class="memory">${row.accesses.map(a => a.kind === 'write' ? `<span class="write" title="書込み">(${hex(a.address)}) ${number(a.before)} → ${number(a.value)}</span>` : `<span class="read" title="読出し">(${hex(a.address)}) ${number(a.value)}</span>`).join('<br>')}</td></tr>`).join('');
  const values = (items, initial) => {
    const part = (start, end) => items.slice(start, end).map((n, i) => `<span class="${initial && initial[start + i] !== n ? 'write' : ''}">${number(n)}</span>`).join(' ');
    if (!items.length) return '—';
    if (items.length <= 8) return part(0, items.length);
    return `${part(0, 8)}<details><summary>残り${items.length - 8}語</summary><div class="array">${part(8, items.length)}</div></details>`;
  };
  const variables = result.variables.map(v => `<tr><th scope="row">${escape(v.name)}</th><td>${hex(v.address)}</td><td>${v.size}</td><td class="values">${values(v.initial)}</td><td class="values">${values(v.final, v.initial)}</td></tr>`).join('');
  const status = result.status === 'completed' ? '正常終了' : result.message;
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>CASL II 実行履歴</title><style nonce="${nonce}">
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family, system-ui); color: var(--vscode-editor-foreground, #dce3ef); background: var(--vscode-editor-background, #18202c); margin: 0; padding: 10px; height: 100vh; display: flex; flex-direction: column; gap: 10px; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; flex-shrink: 0; font-size: 12px; }
.file { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30vw; }
select { font: inherit; padding: 3px; background: var(--vscode-dropdown-background, #263344); color: inherit; border: 1px solid var(--vscode-dropdown-border, #8290a5); }
.status.completed { color: var(--vscode-testing-iconPassed, #69c98e); }
.status.limit, .status.error { color: var(--vscode-editorWarning-foreground, #e5b965); }
.table-wrap { overflow: auto; border: 1px solid var(--vscode-panel-border, #526174); }
.trace { flex: 1; min-height: 140px; }
.variables { flex-shrink: 0; max-height: 30vh; overflow: auto; }
.variables > summary { cursor: pointer; font-size: 12px; font-weight: 600; margin-bottom: 5px; }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 12px; }
th, td { border-right: 1px solid var(--vscode-panel-border, #526174); border-bottom: 1px solid var(--vscode-panel-border, #526174); padding: 5px 7px; white-space: nowrap; text-align: right; }
thead th { position: sticky; top: 0; background: var(--vscode-editorWidget-background, #263344); z-index: 1; }
.source, .memory, .values { text-align: left; }
.source { white-space: pre; }
.values { white-space: normal; min-width: 90px; }
.values > span, .array > span { display: inline-block; margin: 2px 5px 2px 0; }
.values summary { cursor: pointer; margin-top: 4px; }
tbody tr:hover { background: var(--vscode-list-hoverBackground, #253246); }
.write { background: var(--vscode-diffEditor-insertedTextBackground, #286e494a); text-decoration: underline double; text-underline-offset: 3px; font-weight: 700; }
.read { background: var(--vscode-editor-findMatchHighlightBackground, #b8913333); text-decoration: underline dotted; text-underline-offset: 3px; }
.legend { padding: 2px 5px; }
</style></head><body>
<header class="toolbar"><span class="file" title="${escape(name)}">${escape(name)}</span><span class="status ${result.status}" role="status">${escape(status)} · ${result.rows.length}命令</span>
<select id="base" aria-label="値の表示形式"><option value="hex">16進数</option><option value="signed">10進数</option><option value="binary">2進数</option></select>
<span class="legend write" title="更新・参照の両方の場合もこの表示">更新</span><span class="legend read">参照</span></header>
${variables ? `<details class="variables" open><summary>変数 · ${result.variables.length}</summary><div class="table-wrap"><table aria-label="変数の初期値と実行終了時の値"><thead><tr><th scope="col">名前</th><th scope="col">アドレス</th><th scope="col">語数</th><th scope="col">初期値</th><th scope="col">終了時</th></tr></thead><tbody>${variables}</tbody></table></div></details>` : ''}
<div class="table-wrap trace" tabindex="0" role="region" aria-label="実行履歴"><table aria-label="命令ごとの実行履歴">
<thead><tr><th scope="col">#</th><th scope="col" title="実行した命令のアドレス（16進数）">PR</th><th scope="col">行</th><th scope="col">命令</th>${registers.map(i => `<th scope="col" title="実行後の値">GR${i}</th>`).join('')}<th scope="col">OF</th><th scope="col">SF</th><th scope="col">ZF</th><th scope="col" title="実行後の値（16進数）">SP</th><th scope="col">メモリー</th></tr></thead>
<tbody><tr><td>0</td><td>—</td><td>—</td><td class="source">初期状態</td>${stateCells(result.initial)}<td></td></tr>${rows}</tbody></table></div>
<script nonce="${nonce}">document.getElementById('base').addEventListener('change', event => {
  const base = event.target.value;
  document.querySelectorAll('[data-word]').forEach(element => {
    const n = Number(element.dataset.word);
    element.textContent = base === 'binary' ? n.toString(2).padStart(16, '0') : base === 'signed' ? String(n >= 32768 ? n - 65536 : n) : n.toString(16).toUpperCase().padStart(4, '0');
  });
});</script></body></html>`;
}
module.exports = { renderTrace };
