'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble, execute, executeWithInput, encodeInput } = require('../src/core');
const program = (body = ' IN BUF,LEN\n RET') => assemble(`TEST START\n${body}\nBUF DS 256\nLEN DS 1\n END`);

test('INは1文字1語と文字数を格納し、GRとSPを保存する', () => {
  const result = execute(program(' LAD GR1,123\n IN BUF,LEN\n RET'), 2000, ['AB 12']);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.variables[0].final.slice(0, 6), [65, 66, 32, 49, 50, 0]);
  assert.deepEqual(result.variables[1].final, [5]);
  assert.equal(result.rows[1].gr[1], 123);
  assert.equal(result.rows[1].sp, 0);
  assert.equal(result.rows[1].accesses.length, 6);
  assert.deepEqual(result.rows[1].writes, []);
});
test('空入力・EOF・キャンセルを区別し、未入力領域を保持する', () => {
  const p = program(' IN BUF,LEN\n IN BUF,LEN\n RET');
  const empty = execute(p, 2000, ['ABC', '']);
  assert.equal(empty.variables[1].final[0], 0);
  assert.deepEqual(empty.variables[0].final.slice(0, 3), [65, 66, 67]);
  const eof = execute(p, 2000, ['ABC', null]);
  assert.equal(eof.variables[1].final[0], 65535);
  assert.deepEqual(eof.variables[0].final.slice(0, 3), [65, 66, 67]);
  const cancel = execute(p, 2000, ['ABC']);
  assert.equal(cancel.status, 'cancelled');
  assert.equal(cancel.rows.length, 1);
  assert.equal(cancel.variables[1].final[0], 3);
});
test('256文字で切り詰め、半角カナをJIS X 0201に変換する', () => {
  const result = execute(program(), 2000, ['A'.repeat(257)]);
  assert.equal(result.variables[1].final[0], 256);
  assert.ok(result.variables[0].final.every(n => n === 65));
  assert.deepEqual(encodeInput('ｱｲｳ¥‾'), [0xb1, 0xb2, 0xb3, 0x5c, 0x7e]);
  assert.throws(() => encodeInput('日本語'), /半角/);
  assert.throws(() => encodeInput('a\nb'), /半角/);
});
test('分岐で到達したINのみ入力を待ち、途中から再開する', async () => {
  const p = program(' LAD GR3,2\nLOOP IN BUF,LEN\n SUBA GR3,=1\n JNZ LOOP\n RET');
  const inputs = ['LONG', 'X'], requests = [];
  const result = await executeWithInput(p, async request => { requests.push(request); return inputs.shift(); });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].buffer, 'BUF');
  assert.deepEqual(result.variables[0].final.slice(0, 4), [88, 79, 78, 71]);
  assert.equal(result.rows.filter(row => row.source.includes('LOOP IN')).length, 2);
  const skipped = await executeWithInput(program(' JUMP FINISH\n IN BUF,LEN\nFINISH RET'), () => { throw new Error('must not prompt'); });
  assert.equal(skipped.status, 'completed');
});
test('不正な領域やオペランドは実行前に診断する', () => {
  assert.throws(() => assemble('TEST START\n IN BUF,LEN\n RET\nBUF DS 255\nLEN DS 1\n END'), /重複/);
  assert.throws(() => assemble('TEST START\n IN BUF,LEN\n RET\nBUF DS 10\nLEN DS 1\n END'), /256語/);
  assert.throws(() => program(' IN BUF,MISSING\n RET'), /未定義/);
  assert.throws(() => program(' IN GR1,LEN\n RET'), /オペランド/);
  assert.throws(() => program(' IN BUF\n RET'), /オペランド/);
});
