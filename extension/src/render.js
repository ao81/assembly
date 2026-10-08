'use strict';

const { createNonce, client } = require('./render-platform');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => n.toString(16).toUpperCase().padStart(4, '0');

function renderTrace(result, name) {
  const nonce = createNonce();
  const payload = JSON.stringify({ variables: result.variables, rows: result.rows.map(({ step, source, accesses }) => ({ step, source, accesses })) }).replace(/</g, '\\u003c');
  const used = new Set(result.rows.flatMap(row => [...row.reads, ...row.writes]));
  const registers = Array.from({ length: 8 }, (_, i) => i).filter(i => used.has(i));
  const number = n => `<span data-word="${n}">${n >= 32768 ? n - 65536 : n}</span>`;
  const cell = (value, written, read, isFlag = false, extra = '') => {
    const kind = written ? 'write' : read ? 'read' : '';
    const title = written && read ? '更新・参照' : written ? '更新' : read ? '参照' : '保持';
    return `<td class="${kind} ${extra}" title="${title}">${isFlag ? value : number(value)}</td>`;
  };
  const stateCells = row => registers.map(i => cell(row.gr[i], row.writes?.includes(i), row.reads?.includes(i), false, 'register')).join('') +
    ['OF', 'SF', 'ZF'].map(f => cell(row.flags[f], row.flagWrites?.includes(f), row.flagReads?.includes(f), true, 'machine')).join('') + `<td class="machine">${hex(row.sp)}</td>`;
  const memoryName = at => {
    const v = result.variables.find(v => at >= v.address && at < v.address + v.size);
    return v ? escape(v.name + (v.size > 1 ? '[' + (at - v.address) + ']' : '')) : hex(at);
  };
  const accessList = accesses => {
    const items = accesses.map(a => a.kind === 'write' ? `<span class="write" title="${hex(a.address)} 書込み">${memoryName(a.address)}: ${number(a.before)} → ${number(a.value)}</span>` : `<span class="read" title="${hex(a.address)} 読出し">${memoryName(a.address)}: ${number(a.value)}</span>`);
    return items.slice(0, 2).join('<br>') + (items.length > 2 ? `<details><summary>ほか${items.length - 2}件</summary>${items.slice(2).join('<br>')}</details>` : '');
  };
  const rows = result.rows.map(row => `<tr data-step="${row.step}"><td class="step"><button aria-label="ステップ${row.step}を表示">${row.step}</button></td><td class="machine">${hex(row.pr)}</td><td>${row.line}</td><td class="source" title="${escape(row.source.trim())}">${escape(row.source.trim())}</td><td class="watch-anchor"></td>${stateCells(row)}<td class="memory machine">${accessList(row.accesses)}</td></tr>`).join('');
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
button, input { font: inherit; color: inherit; background: var(--vscode-input-background, #263344); border: 1px solid var(--vscode-panel-border, #526174); padding: 4px 7px; }
button { cursor: pointer; } button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--vscode-focusBorder, #68a9f5); }
[hidden] { display: none !important; }
.selected > td { border-top: 2px solid var(--vscode-focusBorder, #68a9f5); border-bottom: 2px solid var(--vscode-focusBorder, #68a9f5); }
.watch-column { min-width: 80px; font-weight: 600; }
thead .watch-column { color: var(--vscode-textLink-foreground, #89cbff); border-top: 3px solid currentColor; }
.held { color: var(--vscode-descriptionForeground, #9da9b9); font-weight: 400; }
.workspace { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
#inspector { flex-shrink: 0; max-height: 32vh; overflow: auto; border: 1px solid var(--vscode-panel-border, #526174); padding: 8px 10px; }
#position { font-weight: 600; } #selected-source { overflow-wrap: anywhere; font-size: 12px; }
#changes { display: flex; gap: 8px; flex-wrap: wrap; }
.state-chip { padding: 3px 6px; font-family: var(--vscode-editor-font-family, Consolas, monospace); }
#variable-address { font-size: 12px; margin: 8px 0; }
#variable-values { display: grid; grid-template-columns: repeat(auto-fill, minmax(95px, 1fr)); gap: 5px; }
.value-cell { display: flex; flex-direction: column; text-align: left; gap: 4px; overflow-wrap: anywhere; }
.value-cell[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder, #68a9f5); outline-offset: -2px; }
.pager { display: flex; gap: 8px; align-items: center; margin-top: 8px; font-size: 12px; }
#offset { width: 70px; }
.watchbar, #watch-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.watchbar { flex-shrink: 0; font-size: 12px; }
.watch-chip { border-radius: 4px; padding: 4px 8px; }
#watch-controls[open] { flex-basis: 100%; }
#watch-controls .toolbar { margin-top: 8px; }
#watch-count, #row-count { color: var(--vscode-descriptionForeground, #9da9b9); }
summary { cursor: pointer; font-size: 12px; }
#array-detail { margin-top: 8px; }
.watch-anchor, .hide-registers .register, .hide-machine .machine { display: none; }
.trace table { width: max-content; min-width: 100%; }
.step { position: sticky; left: 0; width: 44px; min-width: 44px; background: var(--vscode-editor-background, #18202c); z-index: 2; }
.source { position: sticky; left: 44px; max-width: 270px; overflow: hidden; text-overflow: ellipsis; background: var(--vscode-editor-background, #18202c); z-index: 2; }
thead .step, thead .source { z-index: 3; background: var(--vscode-editorWidget-background, #263344); }
@media(max-width: 600px) { .source { max-width: 180px; } .toolbar { gap: 6px; } }
</style></head><body>
<header class="toolbar"><span class="file" title="${escape(name)}">${escape(name)}</span><span class="status ${result.status}" role="status">${escape(status)} · ${result.rows.length}命令</span>
<button id="refresh" title="元のファイルの最新内容で再実行">更新</button><span id="refresh-status" role="status"></span>
<select id="base" aria-label="値の表示形式"><option value="signed" selected>10進数</option><option value="hex">16進数</option><option value="binary">2進数</option></select>
<span class="legend write" title="更新・参照の両方の場合もこの表示">書込</span><span class="legend read">参照</span></header>
<section class="watchbar" aria-label="表示する変数"><div id="watch-list"></div><span id="watch-count"></span>
<details id="watch-controls"><summary>変数・配列を追加</summary><div class="toolbar"><label>変数 <select id="variable">${result.variables.map((v, i) => `<option value="${i}">${escape(v.name)}${v.size > 1 ? ' [' + v.size + '語]' : ''}</option>`).join('')}</select></label><label>添字 <input id="offset" type="number" min="0" value="0" step="1"></label><button id="add-watch">列に追加</button></div></details><span id="empty-watch" hidden>「変数・配列を追加」から選択</span></section>
<nav class="toolbar" aria-label="履歴の操作"><label>表示 <select id="filter"><option value="all">すべての命令</option><option value="write">変数を更新した命令</option><option value="access">変数を参照・更新した命令</option></select></label><button id="previous" aria-label="前のステップ">←</button><button id="next" aria-label="次のステップ">→</button><button id="previous-change">前の更新</button><button id="next-change">次の更新</button><span id="row-count"></span><label><input id="registers" type="checkbox" checked>GR</label><label><input id="machine" type="checkbox">PR・FR・SP・メモリー</label></nav>
<main class="workspace">
<div id="trace-region" class="table-wrap trace" tabindex="0" role="region" aria-label="実行履歴"><table aria-label="命令ごとの実行履歴">
<thead><tr><th class="step" scope="col">#</th><th class="machine" scope="col" title="実行した命令のアドレス（16進数）">PR</th><th scope="col">行</th><th class="source" scope="col">命令</th><th id="watch-anchor" class="watch-anchor"></th>${registers.map(i => `<th class="register" scope="col" title="実行後の値">GR${i}</th>`).join('')}<th class="machine" scope="col">OF</th><th class="machine" scope="col">SF</th><th class="machine" scope="col">ZF</th><th class="machine" scope="col" title="実行後の値（16進数）">SP</th><th class="machine" scope="col">メモリー</th></tr></thead>
<tbody><tr data-step="0"><td class="step"><button aria-label="初期状態を表示">0</button></td><td class="machine">—</td><td>—</td><td class="source">初期状態</td><td class="watch-anchor"></td>${stateCells(result.initial)}<td class="machine"></td></tr>${rows}</tbody></table></div>
<footer id="inspector" aria-label="選択した時点の変数"><div class="toolbar"><span id="position" aria-live="polite"></span><code id="selected-source"></code><div id="changes"></div></div>
<details id="array-detail"><summary>配列・変数の詳細</summary><label>変数 <select id="detail-variable">${result.variables.map((v, i) => `<option value="${i}">${escape(v.name)}</option>`).join('')}</select></label><div id="variable-address"></div><div id="variable-values"></div><div class="pager"><button id="page-prev" aria-label="配列の前ページ">←</button><span id="page-label"></span><button id="page-next" aria-label="配列の次ページ">→</button></div></details></footer></main>
<script id="trace-data" type="application/json" nonce="${nonce}">${payload}</script>
<script nonce="${nonce}">${client}</script></body></html>`;
}
module.exports = { renderTrace };
