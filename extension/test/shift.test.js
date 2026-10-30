'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assemble, execute } = require('../src/core');
const { renderTrace } = require('../src/render');

const program = body => assemble(`TEST START\n${body}\n END`);
const run = body => execute(program(body));
const operations = ['SLA', 'SRA', 'SLL', 'SRL'];

test('シフト4命令のオペコード、2語形式、指標レジスタを生成する', () => {
  const assembled = program(' SLA GR0,1\n SRA GR1,2,GR7\n SLL GR2,3\n SRL GR3,4,GR1\n RET');
  assert.deepEqual(Array.from(assembled.memory.slice(0x1000, 0x1009)), [
    0x5000, 1, 0x5117, 2, 0x5220, 3, 0x5331, 4, 0x8100,
  ]);
});

test('符号保持、ゼロ埋め、最後に押し出したビットとSF/ZF', () => {
  for (const [op, value, count, expected, of] of [
    ['SLA', 0x4001, 1, 0x0002, 1], ['SLL', 0x4001, 1, 0x8002, 0],
    ['SLA', 0x8001, 1, 0x8002, 0], ['SLL', 0x8001, 1, 0x0002, 1],
    ['SRA', 0x8001, 1, 0xc000, 1], ['SRL', 0x8001, 1, 0x4000, 1],
    ['SRA', 0xfffd, 1, 0xfffe, 1], ['SRL', 0xfffd, 1, 0x7ffe, 1],
    ['SLA', 0x4000, 2, 0x0000, 0], ['SLL', 0x8000, 2, 0x0000, 0],
    ['SRA', 0x0001, 2, 0x0000, 0], ['SRL', 0x0001, 2, 0x0000, 0],
    ['SLA', 0xffff, 15, 0x8000, 1], ['SLA', 0xffff, 16, 0x8000, 0],
    ['SRA', 0x8000, 15, 0xffff, 0], ['SRA', 0x8000, 16, 0xffff, 1],
    ['SLL', 0xffff, 16, 0x0000, 1], ['SRL', 0xffff, 16, 0x0000, 1],
  ]) {
    const result = run(` LAD GR1,${value}\n ${op} GR1,${count}\n RET`);
    const row = result.rows[1], label = `${op} #${value.toString(16)},${count}`;
    assert.equal(result.status, 'completed', label);
    assert.equal(row.gr[1], expected, label);
    assert.deepEqual(row.flags, { OF: of, SF: Number(expected >= 0x8000), ZF: Number(expected === 0) }, label);
    assert.deepEqual(row.reads, [1]);
    assert.deepEqual(row.writes, [1]);
    assert.deepEqual(row.flagWrites, ['OF', 'SF', 'ZF']);
    assert.deepEqual(row.accesses, []);
    assert.equal(row.nextPr, row.pr + 2);
  }
});

test('0ビットでもOFをクリアし結果からSF/ZFを再設定する', () => {
  for (const op of operations) {
    for (const value of [0, 1, 0x8000]) {
      const result = run(` LAD GR2,65535\n ADDL GR2,=1\n LAD GR1,${value}\n ${op} GR1,0\n RET`);
      assert.equal(result.rows[1].flags.OF, 1);
      const row = result.rows[3];
      assert.equal(row.gr[1], value);
      assert.deepEqual(row.flags, { OF: 0, SF: Number(value >= 0x8000), ZF: Number(value === 0) });
    }
  }
});

test('境界回数と大きな回数をビット列による独立モデルで検証する', () => {
  for (const op of operations) {
    for (const value of [0, 1, 0x4000, 0x8000, 0xffff, 0xa55a]) {
      // This oracle moves array elements, without JavaScript bitwise shifts.
      let bits = value.toString(2).padStart(16, '0').split('').map(Number), of = 0, previous = 0;
      for (const count of [0, 1, 2, 14, 15, 16, 17, 31, 32, 33, 65535]) {
        for (let i = previous; i < count; i++) {
          if (op === 'SLA') { of = bits.splice(1, 1)[0]; bits.push(0); }
          else if (op === 'SLL') { of = bits.shift(); bits.push(0); }
          else { of = bits.pop(); bits.unshift(op === 'SRA' ? bits[0] : 0); }
        }
        previous = count;
        const expected = parseInt(bits.join(''), 2);
        const row = run(` LAD GR1,${value}\n ${op} GR1,${count}\n RET`).rows[1];
        const label = `${op} ${value},${count}`;
        assert.equal(row.gr[1], expected, label);
        assert.deepEqual(row.flags, { OF: of, SF: bits[0], ZF: Number(expected === 0) }, label);
      }
    }
  }
});

test('実効アドレス自体を回数に使い、指標の加算を16ビットに丸める', () => {
  for (const op of operations) {
    const result = run(` LAD GR1,4\n LAD GR2,3\n ${op} GR1,#FFFF,GR2\n RET`);
    const row = result.rows[2];
    assert.equal(row.gr[1], op === 'SLA' || op === 'SLL' ? 16 : 1);
    assert.equal(row.gr[2], 3);
    assert.deepEqual(row.reads, [2, 1]);
    assert.deepEqual(row.writes, [1]);
    assert.deepEqual(row.accesses, []);
    // A label supplies its address (over 16), not the DC value 1.
    const label = run(` LAD GR1,1\n ${op} GR1,COUNT\n RET\nCOUNT DC 1`).rows[1];
    assert.equal(label.gr[1], 0);
    assert.equal(label.flags.OF, 0);
    assert.deepEqual(label.accesses, []);
  }
  // The count must use the destination's old value when it is also the index.
  const alias = run(' LAD GR1,2\n SLL GR1,1,GR1\n RET').rows[1];
  assert.equal(alias.gr[1], 16);
  assert.deepEqual(alias.reads, [1]);
});

test('シフトのOF/SF/ZFをJOV/JMI/JZEから参照できる', () => {
  const result = run(' LAD GR1,32768\n SLL GR1,1\n JOV OFSET\n JUMP BAD\nOFSET JZE ZERO\n JUMP BAD\nZERO LAD GR1,32768\n SLA GR1,1\n JMI NEG\nBAD LAD GR7,1\nNEG RET');
  assert.equal(result.status, 'completed');
  assert.equal(result.rows.at(-1).gr[7], 0);
  assert.deepEqual(result.rows.filter(row => row.source.includes('JOV'))[0].flagReads, ['OF']);
});

test('不正なシフトオペランドを診断する', () => {
  for (const op of operations) {
    for (const args of ['', 'GR1', '1,2', 'GR8,1', 'GR1,GR2', 'GR1,1,GR0', 'GR1,1,GR8', 'GR1,1,1', 'GR1,1,GR2,GR3']) {
      assert.throws(() => program(` ${op}${args ? ' ' + args : ''}\n RET`), /オペランド/);
    }
    assert.throws(() => program(` ${op} GR1,MISSING\n RET`), /未定義/);
    assert.throws(() => program(` ${op} GR1,65536\n RET`), /範囲外/);
  }
});

test('シフトの実行例とトレース表示を確認する', () => {
  const result = execute(assemble(fs.readFileSync(path.join(__dirname, '../examples/shifts.cas'), 'utf8')));
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.rows.at(-1).gr.slice(1, 5), [0x8002, 0xc000, 0x0002, 0x4000]);
  const html = renderTrace(result, 'shifts.cas');
  for (const op of operations) assert.ok(html.includes(op));
  for (const i of [1, 2, 3, 4]) assert.ok(html.includes(`>GR${i}</th>`));
});
