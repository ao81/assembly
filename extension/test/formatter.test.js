'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatSource } = require('../src/formatter');
const { assemble, execute } = require('../src/core');

test('ラベル・命令・オペランド・コメントの開始位置を揃える', () => {
  const lines = formatSource('TEST START\n  LD GR1,A ; load\nA DC 10 ; value\n RET\n END').split('\r\n');
  assert.equal(lines[0], 'TEST    START');
  assert.equal(lines[1].indexOf('LD'), 8);
  assert.equal(lines[2].indexOf('DC'), 8);
  assert.equal(lines[1].indexOf('GR1'), 16);
  assert.equal(lines[2].indexOf('10'), 16);
  assert.equal(lines[1].indexOf(';'), 40);
  assert.equal(lines[2].indexOf(';'), 40);
  assert.equal(lines[3], '        RET');
});
test('文字列内の空白・セミコロン・引用符とコメントを保持', () => {
  const text = formatSource("TEXT DC 'a; b,  c''d' ; keep  spaces\n ; standalone\n\nBROKEN DC 'unterminated");
  assert.ok(text.includes("'a; b,  c''d'"));
  assert.ok(text.includes('; keep  spaces'));
  assert.ok(text.includes('\r\n ; standalone\r\n\r\n'));
  assert.ok(text.endsWith("BROKEN DC 'unterminated"));
});
test('8文字ラベルや長いオペランドでも区切りを残し、再整形で変化しない', () => {
  const text = formatSource("LONGNAME DC 'a long literal that exceeds the comment column' ; note\n\tLD\tGR1,LONGNAME ; load\n END\n");
  assert.ok(text.startsWith('LONGNAME DC'));
  const lines = text.split('\r\n');
  assert.equal(lines[0].indexOf(';'), lines[1].indexOf(';'));
  assert.equal(formatSource(text), text);
  assert.ok(text.endsWith('\r\n'));
});
test('実行結果を変えず、未知の構文を保持する', () => {
  const source = 'TEST START\n LD GR1,A\n ADDA GR1,=2\n ST GR1,A\n RET\nA DC 3\n END';
  const before = execute(assemble(source)), after = execute(assemble(formatSource(source)));
  assert.deepEqual(after.memory, before.memory);
  assert.deepEqual(after.rows.map(r => r.gr), before.rows.map(r => r.gr));
  assert.equal(formatSource('  UNKNOWN  GR1,A'), '  UNKNOWN  GR1,A');
});
test('全角文字の後でもコメントの表示列を揃える', () => {
  const lines = formatSource("A DC '日本' ; first\nB DC 'abcd' ; second").split('\r\n');
  assert.equal(lines[0].indexOf(';') + 2, lines[1].indexOf(';'));
});
