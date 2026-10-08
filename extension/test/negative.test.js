'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble, execute, signed } = require('../src/core');
const run = body => execute(assemble(`TEST START\n${body}\n END`));

test('LADの負の定数と負の指標変位を16ビットで扱う', () => {
  const result = run(' LAD GR1,-3\n LAD GR1,-1,GR1\n RET');
  assert.equal(result.rows[0].gr[1], 0xfffd);
  assert.equal(signed(result.rows[1].gr[1]), -4);
  assert.deepEqual(result.rows[1].flags, { OF: 0, SF: 0, ZF: 0 });
});
test('負のDC・リテラル・境界値と実効アドレスの折返し', () => {
  const result = run(' LD GR1,=-3\n ADDA GR1,VALUE\n LAD GR2,-32768\n LAD GR3,0\n LAD GR3,-1,GR3\n RET\nVALUE DC -3');
  assert.equal(signed(result.rows[1].gr[1]), -6);
  assert.equal(result.rows[2].gr[2], 0x8000);
  assert.equal(result.rows[4].gr[3], 0xffff);
  assert.throws(() => run(' LAD GR1,-32769\n RET'), /範囲外/);
  assert.throws(() => run('AREA DS -3\n RET'), /オペランド/);
});
test('負のアドレス指定も即値ではなくメモリー参照として扱う', () => {
  const result = run(' LAD GR1,7\n ST GR1,-3\n LD GR2,-3\n RET');
  assert.equal(result.memory[0xfffd], 7);
  assert.equal(result.rows[2].gr[2], 7);
});
test('INの負数入力は符号を含む文字列のまま格納する', () => {
  const result = execute(assemble('TEST START\n IN BUF,LEN\n RET\nBUF DS 256\nLEN DS 1\n END'), 2000, ['-3']);
  assert.deepEqual(result.variables[0].final.slice(0, 2), [0x2d, 0x33]);
  assert.equal(result.variables[1].final[0], 2);
});
