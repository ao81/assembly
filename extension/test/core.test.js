'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assemble, execute } = require('../src/core');
const { renderTrace } = require('../src/render');
const run = body => execute(assemble(`TEST START\n${body}\n END`));
const sample = name => execute(assemble(fs.readFileSync(path.join(__dirname, '../examples', name), 'utf8')));

test('ループの実行順、加算、メモリー書込みと履歴の独立性', () => {
  const result = sample('sum.cas');
  assert.equal(result.status, 'completed');
  assert.equal(result.rows.at(-1).gr[1], 15);
  assert.equal(result.memory[result.symbols.get('RESULT')], 15);
  assert.equal(result.rows.filter(row => row.line === 4).length, 5);
  assert.equal(result.rows[0].gr[1], 0);
  const store = result.rows.find(row => row.source.includes('ST '));
  assert.deepEqual(store.accesses, [{ kind: 'write', address: result.symbols.get('RESULT'), before: 0, value: 15 }]);
});
test('算術オーバーフロー、LADによるFR保持、JOV', () => {
  const result = sample('overflow.cas');
  assert.deepEqual(result.rows[1].flags, { OF: 1, SF: 1, ZF: 0 });
  assert.deepEqual(result.rows[2].flags, result.rows[1].flags);
  assert.equal(result.rows.at(-1).gr[2], 1);
});
test('論理減算の借りとレジスタ参照・更新', () => {
  const result = run(' LAD GR1,100\n LAD GR2,300\n SUBL GR1,GR2\n RET');
  assert.equal(result.rows[2].gr[1], 0xff38);
  assert.deepEqual(result.rows[2].flags, { OF: 1, SF: 1, ZF: 0 });
  assert.deepEqual(result.rows[2].reads, [2, 1]);
  assert.deepEqual(result.rows[2].writes, [1]);
});
test('CPAは符号付き、CPLは符号なしで比較する', () => {
  const result = run(' LD GR1,=-1\n CPA GR1,=1\n CPL GR1,=1\n RET');
  assert.deepEqual(result.rows[1].flags, { OF: 0, SF: 1, ZF: 0 });
  assert.deepEqual(result.rows[2].flags, { OF: 0, SF: 0, ZF: 0 });
});
test('LDのフラグ、論理演算、指標修飾、STARTの開始ラベル', () => {
  const result = execute(assemble('TEST START MAIN\nDATA DC 1,2\nMAIN LAD GR2,1\n LD GR1,DATA,GR2\n XOR GR1,GR1\n RET\n END'));
  assert.equal(result.rows[1].gr[1], 2);
  assert.deepEqual(result.rows[2].flags, { OF: 0, SF: 0, ZF: 1 });
});
test('無限ループを上限で止め、途中履歴を残す', () => {
  const result = execute(assemble('TEST START\nLOOP JUMP LOOP\n END'), 5);
  assert.equal(result.status, 'limit'); assert.equal(result.rows.length, 5);
});
test('診断: 未定義ラベル、未対応命令、GR0指標、重複ラベル、範囲外、END欠落', () => {
  for (const [body, expected] of [
    [' LD GR1,MISSING\n RET', /未定義/], [' OUT BUF,LEN', /未対応/],
    [' LAD GR1,0,GR0', /オペランド/], ['X NOP\nX RET', /重複/], [' LD GR1,=65536', /範囲外/],
  ]) assert.throws(() => run(body), expected);
  assert.throws(() => assemble('TEST START\n RET'), /STARTとEND/);
});
test('自己書換えとデータ領域への分岐は実行エラー', () => {
  const modified = run(' LAD GR1,0\n ST GR1,NEXT\nNEXT RET');
  assert.equal(modified.status, 'error'); assert.equal(modified.rows.length, 2);
  assert.equal(run(' JUMP DATA\nDATA DC 0').status, 'error');
});
test('機械語の1語・2語形式を生成する', () => {
  const program = assemble('TEST START\n LAD GR1,5\n ADDA GR1,GR1\n ST GR1,DATA\n RET\nDATA DS 1\n END');
  assert.deepEqual(Array.from(program.memory.slice(0x1000, 0x1006)), [0x1210, 5, 0x2411, 0x1110, 0x1006, 0x8100]);
});
test('HTML特殊文字の無害化と表示する数値の属性', () => {
  const result = run(' LAD GR1,5 ; <script>alert("x")</script>\n RET');
  const html = renderTrace(result, '<img src=x>');
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('data-word="5"'));
  assert.ok(!html.includes('data-word="65280"'));
  assert.ok(html.includes("default-src 'none'"));
});

test('SPは初期状態から終了まで0000', () => {
  const result = sample('variables.cas');
  assert.equal(result.initial.sp, 0);
  assert.ok(result.rows.every(row => row.sp === 0));
});

test('データラベルの初期値と終了時の値を独立して保存', () => {
  const result = sample('variables.cas');
  assert.deepEqual(result.variables.map(v => [v.name, v.initial, v.final]), [
    ['A', [10], [10]], ['B', [20], [20]], ['ANSWER', [0], [30]],
  ]);
  assert.ok(!result.variables.some(v => v.name === 'CALC'));
  const array = run(' LAD GR1,7\n ST GR1,DATA\n RET\nDATA DS 2\nEMPTY DS 0');
  assert.deepEqual(array.variables[0].initial, [0, 0]);
  assert.deepEqual(array.variables[0].final, [7, 0]);
  assert.deepEqual(array.variables[1].final, []);
});

test('実際に使用したGRだけを表示し、参照のみ・指標用も残す', () => {
  const result = run(' LD GR1,GR0\n LAD GR2,DATA,GR7\n JUMP EXIT\n LD GR6,GR5\nEXIT RET\nDATA DS 1');
  const html = renderTrace(result, 'test.cas');
  for (const i of [0, 1, 2, 7]) assert.ok(html.includes(`>GR${i}</th>`));
  for (const i of [3, 4, 5, 6]) assert.ok(!html.includes(`>GR${i}</th>`));
  assert.ok(!/>GR[0-7]<\/th>/.test(renderTrace(run(' RET'), 'test.cas')));
});

test('変数選択と配列のページ操作を表示', () => {
  const html = renderTrace(sample('variables.cas'), 'variables.cas');
  assert.ok(html.includes('>A</option>'));
  assert.ok(html.includes('>B</option>'));
  assert.ok(html.includes('data-word="30"'));
  assert.ok(!html.includes('README参照'));
  const array = renderTrace(run(' RET\nDATA DS 10'), 'array.cas');
  assert.ok(array.includes('id="page-next"'));
  assert.ok(array.includes('DATA [10語]'));
});
