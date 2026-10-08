'use strict';

const data = JSON.parse(document.getElementById('trace-data').textContent);
const byId = id => document.getElementById(id);
const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const saved = host?.getState() || {};
let watches = resolveWatches(data.variables, saved.watches), histories = [], selected = 0, page = 0, visibleSteps = [];
const traceRows = [...document.querySelectorAll('tr[data-step]')];
const format = n => byId('base').value === 'binary' ? n.toString(2).padStart(16, '0') : byId('base').value === 'hex' ? n.toString(16).toUpperCase().padStart(4, '0') : String(n >= 32768 ? n - 65536 : n);
const hexAddress = n => n.toString(16).toUpperCase().padStart(4, '0');
const watchName = watch => watch.name + (data.variables[watch.index].size > 1 ? '[' + watch.offset + ']' : '');
const currentVariable = () => data.variables[Number(byId('variable').value)];
const persist = () => host?.setState({ watches: watches.map(({ name, offset }) => ({ name, offset })), base: byId('base').value, filter: byId('filter').value, registers: byId('registers').checked, machine: byId('machine').checked });

if (['signed', 'hex', 'binary'].includes(saved.base)) byId('base').value = saved.base;
if (['all', 'write', 'access'].includes(saved.filter)) byId('filter').value = saved.filter;
byId('registers').checked = saved.registers !== false;
byId('machine').checked = saved.machine === true;

byId('refresh').disabled = !host;
byId('refresh').addEventListener('click', () => {
  if (!host) return;
  persist();
  byId('refresh').disabled = true;
  byId('refresh-status').textContent = '更新中…';
  host.postMessage({ type: 'refresh' });
});
window.addEventListener('message', event => {
  if (event.data?.type === 'refreshError') {
    byId('refresh-status').textContent = event.data.message;
    byId('refresh').disabled = false;
  } else if (event.data?.type === 'refreshComplete') {
    byId('refresh').disabled = !host;
    if (byId('refresh-status').textContent === '更新中…') byId('refresh-status').textContent = '';
  }
});

function refreshOptions() {
  const v = currentVariable();
  const max = Math.max(0, (v?.size || 0) - 1);
  byId('offset').max = String(max);
  byId('offset').value = String(Math.max(0, Math.min(max, Math.floor(Number(byId('offset').value) || 0))));
  byId('offset').disabled = !v || v.size <= 1;
  byId('add-watch').disabled = !v || !v.size || watches.length >= 12;
  byId('add-watch').title = watches.length >= 12 ? '同時表示は12列までです。不要な列を外してください。' : 'この変数を表に追加';
}

function addWatch(index, offset) {
  const v = data.variables[index];
  if (!v || !v.size || watches.length >= 12) return;
  watches = resolveWatches(data.variables, [...watches, { name: v.name, offset }]);
  refreshColumns();
}

function refreshColumns() {
  histories = watches.map(w => variableHistory(data, w.index, w.offset));
  document.querySelectorAll('.watch-column').forEach(element => element.remove());
  const chips = byId('watch-list'); chips.replaceChildren();
  watches.forEach((watch, index) => {
    const chip = document.createElement('button');
    chip.className = 'watch-chip'; chip.textContent = watchName(watch) + ' ×';
    chip.setAttribute('aria-label', watchName(watch) + 'を表から外す');
    chip.addEventListener('click', () => { watches.splice(index, 1); refreshColumns(); });
    chips.append(chip);
    const header = document.createElement('th'); header.className = 'watch-column'; header.scope = 'col';
    header.textContent = watchName(watch);
    header.title = '実行後の値 · ' + hexAddress(data.variables[watch.index].address + watch.offset);
    byId('watch-anchor').before(header);
    traceRows.forEach(row => {
      const entry = histories[index][Number(row.dataset.step)];
      const cell = document.createElement('td');
      cell.className = 'watch-column ' + (entry.written ? 'write' : entry.read ? 'read' : 'held');
      cell.textContent = entry.written ? format(entry.before) + ' → ' + format(entry.after) : format(entry.after);
      cell.title = watchName(watch) + ': ' + (entry.written ? '更新' : entry.read ? '参照' : '保持') + ' · 実行後 ' + format(entry.after);
      row.querySelector('.watch-anchor').before(cell);
    });
  });
  byId('watch-count').textContent = watches.length + '列 / ' + data.variables.filter(v => v.size > 0).length + '変数';
  byId('empty-watch').hidden = watches.length > 0 || !data.variables.length;
  byId('filter').disabled = watches.length === 0;
  refreshOptions(); refreshFilter(); persist();
}

function refreshFilter() {
  const steps = histories.length ? watchSteps(histories, byId('filter').value) : traceRows.map(row => Number(row.dataset.step));
  const visible = new Set(steps);
  visibleSteps = steps;
  traceRows.forEach(row => { row.hidden = !visible.has(Number(row.dataset.step)); });
  if (!visible.has(selected)) selected = 0;
  byId('row-count').textContent = Math.max(0, steps.length - 1) + ' / ' + data.rows.length + '命令';
  refreshDetail(); persist();
}

function refreshDetail() {
  const current = data.rows[selected - 1];
  byId('position').textContent = selected === 0 ? '初期状態' : '#' + selected + ' 実行後';
  byId('selected-source').textContent = current?.source.trim() || '';
  const changes = byId('changes'); changes.replaceChildren();
  watches.forEach((watch, i) => {
    const entry = histories[i][selected];
    const item = document.createElement('span');
    item.className = 'state-chip' + (entry.written ? ' write' : entry.read ? ' read' : '');
    item.textContent = watchName(watch) + ' = ' + format(entry.after);
    changes.append(item);
  });
  traceRows.forEach(row => {
    const active = Number(row.dataset.step) === selected;
    row.classList.toggle('selected', active);
    row.querySelector('button').setAttribute('aria-pressed', String(active));
  });
  const changeSteps = histories.length ? watchSteps(histories, 'write').filter(step => step !== 0) : [];
  byId('previous-change').disabled = !changeSteps.some(step => step < selected);
  byId('next-change').disabled = !changeSteps.some(step => step > selected);
  byId('previous').disabled = visibleSteps.indexOf(selected) <= 0;
  byId('next').disabled = visibleSteps.indexOf(selected) >= visibleSteps.length - 1;
  refreshArray();
}

function refreshArray() {
  const v = currentVariable(), container = byId('variable-values');
  container.replaceChildren();
  if (!v) return;
  const values = variableAt(data, Number(byId('variable').value), selected);
  const pages = Math.max(1, Math.ceil(v.size / 32));
  page = Math.max(0, Math.min(page, pages - 1));
  byId('page-label').textContent = (page + 1) + ' / ' + pages;
  byId('page-prev').disabled = page === 0; byId('page-next').disabled = page === pages - 1;
  byId('variable-address').textContent = v.name + ' · ' + hexAddress(v.address) + ' · ' + v.size + '語';
  if (!v.size) { container.textContent = '領域なし（DS 0）'; return; }
  const accesses = data.rows[selected - 1]?.accesses || [];
  for (let i = page * 32; i < Math.min(values.length, (page + 1) * 32); i++) {
    const target = accesses.filter(a => a.address === v.address + i);
    const watched = watches.some(w => w.index === Number(byId('variable').value) && w.offset === i);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'value-cell' + (target.some(a => a.kind === 'write') ? ' write' : target.length ? ' read' : '');
    button.setAttribute('aria-pressed', String(watched));
    button.title = hexAddress(v.address + i) + (watched ? ' · 表示中' : ' · クリックで表に追加');
    const label = document.createElement('small'), value = document.createElement('strong');
    label.textContent = v.size === 1 ? v.name : v.name + '[' + i + ']';
    value.textContent = format(values[i]); button.append(label, value);
    button.addEventListener('click', () => addWatch(Number(byId('variable').value), i));
    container.append(button);
  }
}

function selectStep(step) {
  selected = step;
  refreshDetail();
  traceRows[step]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function move(direction) {
  selectStep(visibleSteps[Math.max(0, Math.min(visibleSteps.length - 1, visibleSteps.indexOf(selected) + direction))] || 0);
}
function moveChange(direction) {
  const steps = watchSteps(histories, 'write').filter(step => step !== 0 && (direction > 0 ? step > selected : step < selected));
  const target = direction > 0 ? steps[0] : steps.at(-1);
  if (target !== undefined) selectStep(target);
}
traceRows.forEach(row => row.addEventListener('click', event => {
  if (event.target.closest('summary,details')) return;
  selectStep(Number(row.dataset.step));
}));
byId('previous').addEventListener('click', () => move(-1));
byId('next').addEventListener('click', () => move(1));
byId('previous-change').addEventListener('click', () => moveChange(-1));
byId('next-change').addEventListener('click', () => moveChange(1));
byId('trace-region').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
});
byId('variable').addEventListener('change', () => { byId('detail-variable').value = byId('variable').value; byId('offset').value = '0'; page = 0; refreshOptions(); refreshArray(); });
byId('detail-variable').addEventListener('change', () => { byId('variable').value = byId('detail-variable').value; byId('offset').value = '0'; page = 0; refreshOptions(); refreshArray(); });
byId('offset').addEventListener('change', refreshOptions);
byId('add-watch').addEventListener('click', () => { refreshOptions(); addWatch(Number(byId('variable').value), Number(byId('offset').value)); });
byId('filter').addEventListener('change', refreshFilter);
byId('page-prev').addEventListener('click', () => { page--; refreshArray(); });
byId('page-next').addEventListener('click', () => { page++; refreshArray(); });
function refreshDisplay() {
  document.body.classList.toggle('hide-registers', !byId('registers').checked);
  document.body.classList.toggle('hide-machine', !byId('machine').checked);
  persist();
}
byId('registers').addEventListener('change', refreshDisplay);
byId('machine').addEventListener('change', refreshDisplay);
byId('base').addEventListener('change', () => {
  document.querySelectorAll('[data-word]').forEach(element => { element.textContent = format(Number(element.dataset.word)); });
  refreshColumns();
});
if (!data.variables.length) {
  byId('watch-controls').hidden = true; byId('array-detail').hidden = true;
}
document.querySelectorAll('[data-word]').forEach(element => { element.textContent = format(Number(element.dataset.word)); });
refreshDisplay(); refreshColumns();
