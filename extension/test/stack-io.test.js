'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble, execute, executeWithInput } = require('../src/core');
const program = body => assemble(`TEST START\n${body}\n END`);
const run = body => execute(program(body));

test('PUSHは実効アドレスを格納し、POPはLIFOでGR0にも取り出せる', () => {
  const result = run(' LD GR0,=-1\n LAD GR2,2\n PUSH DATA,GR2\n PUSH #FFFF,GR2\n POP GR7\n POP GR0\n NOP\n RET\nDATA DS 3');
  const [, , first, second, pop7, pop0, nop] = result.rows;
  assert.equal(result.status, 'completed');
  assert.deepEqual([first.sp, second.sp, pop7.sp, pop0.sp], [0xffff, 0xfffe, 0xffff, 0]);
  assert.deepEqual(first.reads, [2]);
  assert.deepEqual(first.accesses, [{ kind: 'write', address: 0xffff, before: 0, value: result.symbols.get('DATA') + 2 }]);
  assert.deepEqual(second.accesses, [{ kind: 'write', address: 0xfffe, before: 0, value: 1 }]);
  assert.deepEqual(pop7.accesses, [{ kind: 'read', address: 0xfffe, value: 1 }]);
  assert.deepEqual(pop0.writes, [0]);
  assert.equal(nop.gr[0], result.symbols.get('DATA') + 2);
  assert.equal(nop.gr[7], 1);
  assert.ok(result.rows.every(row => row.flags.SF === 1 && row.flags.ZF === 0 && row.flags.OF === 0));
  assert.deepEqual(nop.accesses, []);
});

test('指標付きCALLと入れ子のRETが、正しい戻り番地とSPを復元する', () => {
  const result = run(' LAD GR1,1\n CALL FIRST,GR1\nDONE RET\nFIRST NOP\nINNER CALL DEEP\nRETURN RET\nDEEP PUSH 9\n POP GR0\n RET');
  const [, outer, inner, , , deepRet, innerRet, topRet] = result.rows;
  assert.equal(result.status, 'completed');
  assert.equal(outer.nextPr, result.symbols.get('INNER'));
  assert.equal(outer.accesses[0].value, result.symbols.get('DONE'));
  assert.equal(inner.accesses[0].value, result.symbols.get('RETURN'));
  assert.deepEqual([deepRet.nextPr, innerRet.nextPr, topRet.pr],
    [result.symbols.get('RETURN'), result.symbols.get('DONE'), result.symbols.get('DONE')]);
  assert.deepEqual([deepRet.sp, innerRet.sp, topRet.sp], [0xffff, 0, 0]);
  assert.equal(topRet.gr[0], 9);
});

test('RPUSH/RPOPの機械語とGR1〜GR7の順序を検証する', () => {
  const loads = Array.from({ length: 8 }, (_, i) => ` LAD GR${i},${100 + i}`).join('\n');
  const clear = Array.from({ length: 8 }, (_, i) => ` LAD GR${i},0`).join('\n');
  const p = program(`${loads}\nSAVE RPUSH\n${clear}\nRESTORE RPOP\n RET`);
  const start = p.symbols.get('SAVE'), end = p.symbols.get('RESTORE');
  assert.deepEqual(Array.from(p.memory.slice(start, start + 14)), Array.from({ length: 7 }, (_, i) => [0x7001 + i, 0]).flat());
  assert.deepEqual(Array.from(p.memory.slice(end, end + 7)), Array.from({ length: 7 }, (_, i) => 0x7170 - (i << 4)));
  const result = execute(p);
  assert.equal(result.status, 'completed');
  const saved = result.rows.filter(row => row.source.includes('RPUSH'));
  const restored = result.rows.filter(row => row.source.includes('RPOP'));
  assert.deepEqual(saved.map(row => row.reads[0]), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(restored.map(row => row.writes[0]), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(result.rows.at(-1).gr, [0, 101, 102, 103, 104, 105, 106, 107]);
  assert.equal(result.rows.at(-1).sp, 0);
});

test('新しい機械語の符号化とオペランド診断', () => {
  const p = program(' PUSH 7,GR3\n POP GR0\n CALL SUB\n SVC 1,GR2\nSUB RET');
  assert.deepEqual(Array.from(p.memory.slice(p.entry, p.entry + 8)), [0x7003, 7, 0x7100, 0x8000, p.symbols.get('SUB'), 0xf002, 1, 0x8100]);
  for (const source of ['PUSH', 'PUSH 0,GR0', 'POP 0', 'POP GR1,GR2', 'CALL GR1', 'SVC 1,GR0', 'RPUSH GR1', 'RPOP 1', 'OUT BUF', 'NOP 1']) {
    assert.throws(() => program(` ${source}\n RET`), /2行: .*オペランド/, source);
  }
  assert.throws(() => program(' CALL MISSING\n RET'), /未定義ラベル/);
});

test('スタック不足・領域衝突・不正な呼出し先は停止する', () => {
  for (const op of ['POP GR1', 'RPOP']) {
    const result = run(` ${op}\n RET`);
    assert.equal(result.status, 'error');
    assert.equal(result.errorLine, 2);
    assert.match(result.message, /スタックが空/);
  }
  const exhausted = run('LOOP PUSH 1\n JUMP LOOP\nDATA DS 61180');
  assert.equal(exhausted.status, 'error');
  assert.match(exhausted.message, /スタック領域の上限/);
  assert.equal(exhausted.rows.at(-1).sp, 0xff00);
  assert.equal(exhausted.memory[0xfeff], 0);
  assert.equal(run(' CALL DATA\n RET\nDATA DC 0').status, 'error');
  const alteredReturn = run(' CALL SUB\nEXIT RET\nSUB LAD GR0,OTHER\n ST GR0,#FFFF\n RET\nOTHER LAD GR1,7\n RET');
  assert.equal(alteredReturn.status, 'completed');
  assert.equal(alteredReturn.rows.at(-1).gr[1], 7);
});

test('OUTは文字DC、下位8ビット、複数レコードと空レコードを扱う', () => {
  const result = run(` LD GR0,=-1
 OUT TEXT,LEN
 OUT EMPTY,ZERO
 RET
TEXT DC '<A;B,C>''',#F05C,'ｶ‾' ; trailing comment
LEN DC 11
ZERO DC 0
EMPTY DS 0`);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.output, ["<A;B,C>'¥ｶ‾", '']);
  assert.deepEqual(result.rows[1].gr, result.rows[0].gr);
  assert.deepEqual(result.rows[1].flags, { OF: 0, SF: 0, ZF: 0 });
  assert.equal(result.rows[1].accesses.length, 12);
  assert.ok(result.rows[1].accesses.every(access => access.kind === 'read'));
  assert.equal(result.rows[2].accesses.length, 1);
});

test('OUTの不正な長さ、データの隙間、出力上限でエラーを残す', () => {
  const invalid = run(' OUT BUF,LEN\n RET\nBUF DC 65\n NOP\nLEN DC 2');
  assert.equal(invalid.status, 'error');
  assert.equal(invalid.errorLine, 2);
  assert.deepEqual(invalid.output, []);
  assert.match(invalid.message, /データ領域/);
  assert.equal(run(' OUT BUF,LEN\n RET\nBUF DS 1\nLEN DC -1').status, 'error');
  assert.throws(() => program(' OUT BUF,NEXT\nNEXT RET\nBUF DS 1'), /文字数領域/);
  const cap = run(' OUT BUF,LEN\n OUT BUF,LEN\n RET\nBUF DS 40000\nLEN DC 40000');
  assert.equal(cap.status, 'error');
  assert.match(cap.message, /出力.*上限/);
  assert.deepEqual(cap.output.map(record => record.length), [40000]);
});

test('SVC 1と指標付きSVC 2が入出力し、EOFとキャンセルも既存のINと同じ', async () => {
  const p = program(' LAD GR1,BUF\n LAD GR2,LEN\n LAD GR3,2\n SVC #0001\n SVC 0,GR3\n RET\nBUF DS 256\nLEN DS 1');
  const requests = [];
  const result = await executeWithInput(p, async request => { requests.push(request); return 'ABC'; });
  assert.equal(result.status, 'completed');
  assert.deepEqual(requests, [{ line: 5, buffer: 'GR1', length: 'GR2', service: 1 }]);
  assert.deepEqual(result.output, ['ABC']);
  assert.deepEqual(result.rows[4].reads, [3, 1, 2]);
  assert.deepEqual(result.rows[4].gr, result.rows[2].gr);
  assert.equal(execute(p).status, 'cancelled');
  assert.equal(execute(p, 2000, [null]).memory[p.symbols.get('LEN')], 0xffff);
  const unknown = run(' SVC #FFFF\n RET');
  assert.equal(unknown.status, 'error');
  assert.match(unknown.message, /未対応のSVC番号.*#FFFF/);
  const bad = await executeWithInput(program(' SVC 1\n RET'), () => assert.fail('invalid input area must not prompt'));
  assert.equal(bad.status, 'error');
  assert.match(bad.message, /入力領域/);
});
