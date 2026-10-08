'use strict';

const BASE = 0x1000;
const binary = { LD: [0x10, 0x14], ADDA: [0x20, 0x24], SUBA: [0x21, 0x25], ADDL: [0x22, 0x26], SUBL: [0x23, 0x27], AND: [0x30, 0x34], OR: [0x31, 0x35], XOR: [0x32, 0x36], CPA: [0x40, 0x44], CPL: [0x41, 0x45] };
const jumps = { JMI: 0x61, JNZ: 0x62, JZE: 0x63, JUMP: 0x64, JPL: 0x65, JOV: 0x66 };
const signed = n => n & 0x8000 ? n - 0x10000 : n;
const word = n => n & 0xffff;
const reg = text => /^GR[0-7]$/.test(text || '') ? Number(text[2]) : -1;

class CaslError extends Error {
  constructor(line, message) { super(`${line}行: ${message}`); this.line = line; }
}

function numeric(text, line, address = false) {
  let value;
  if (/^#[0-9A-Fa-f]{1,4}$/.test(text)) value = parseInt(text.slice(1), 16);
  else if (/^[+-]?\d+$/.test(text)) value = Number(text);
  else throw new CaslError(line, `数値が必要です: ${text}`);
  if (!Number.isInteger(value) || value < (address ? 0 : -32768) || value > 65535) {
    throw new CaslError(line, `16ビットの範囲外です: ${text}`);
  }
  return word(value);
}

function assemble(source) {
  const memory = new Uint16Array(65536), symbols = new Map(), instructions = new Map();
  const nodes = [], literals = new Map(), variables = [];
  let address = BASE, started = false, ended = false, startTarget, startLine = 1;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = index + 1, text = original.split(';')[0].trimEnd();
    if (!text.trim()) continue;
    if (ended) throw new CaslError(line, 'ENDの後には命令を書けません。');
    const match = text.match(/^(?:(\S+)\s+)?\s*([A-Z]+)(?:\s+(.*))?$/);
    if (!match) throw new CaslError(line, '「ラベル 命令 オペランド」の形式を確認してください。');
    const [, label, op, operands = ''] = match;
    const args = operands ? operands.split(',').map(s => s.trim()) : [];
    if (args.some(s => !s)) throw new CaslError(line, '空のオペランドがあります。');
    if (label) {
      if (!/^[A-Z][A-Z0-9]{0,7}$/.test(label) || reg(label) >= 0) throw new CaslError(line, `不正なラベルです: ${label}`);
      if (symbols.has(label)) throw new CaslError(line, `ラベルが重複しています: ${label}`);
      symbols.set(label, address);
    }
    if (op === 'START') {
      if (started || nodes.length || !label || args.length > 1) throw new CaslError(line, 'STARTはラベル付きで先頭に1回指定してください。');
      started = true; startTarget = args[0]; startLine = line; continue;
    }
    if (!started) throw new CaslError(line, '先頭にSTARTが必要です。');
    if (op === 'END') {
      if (label || args.length) throw new CaslError(line, 'ENDにはラベルやオペランドを指定できません。');
      ended = true; continue;
    }
    let size, form, opcode;
    const fail = () => { throw new CaslError(line, `${op}のオペランドを確認してください。`); };
    if (op === 'DC') {
      if (!args.length) fail();
      args.forEach(a => numeric(a, line)); size = args.length; form = 'data';
    } else if (op === 'DS') {
      if (args.length !== 1 || !/^\d+$/.test(args[0])) fail();
      size = numeric(args[0], line, true); form = 'reserve';
    } else if (op === 'IN') {
      if (args.length !== 2 || args.some(a => !/^[A-Z][A-Z0-9]{0,7}$/.test(a) || reg(a) >= 0)) fail();
      size = 2; opcode = 0xf0; form = 'input';
    } else if (op === 'NOP' || op === 'RET') {
      if (args.length) fail();
      size = 1; opcode = op === 'NOP' ? 0 : 0x81; form = 'none';
    } else if (binary[op] || op === 'LAD' || op === 'ST') {
      if (args.length < 2 || args.length > 3 || reg(args[0]) < 0) fail();
      if (binary[op] && args.length === 2 && reg(args[1]) >= 0) {
        form = 'register'; opcode = binary[op][1]; size = 1;
      } else {
        form = 'address'; opcode = binary[op] ? binary[op][0] : op === 'LAD' ? 0x12 : 0x11; size = 2;
        if (reg(args[1]) >= 0 || (args.length === 3 && reg(args[2]) < 1)) fail();
      }
    } else if (jumps[op]) {
      if (args.length < 1 || args.length > 2 || reg(args[0]) >= 0 || (args.length === 2 && reg(args[1]) < 1)) fail();
      form = 'jump'; opcode = jumps[op]; size = 2;
    } else throw new CaslError(line, `未対応の命令です: ${op}（対応範囲はREADMEを参照）`);
    if (form === 'address' || form === 'jump') {
      const operand = args[form === 'jump' ? 0 : 1];
      if (operand.startsWith('=')) {
        const value = numeric(operand.slice(1), line);
        if (!literals.has(operand)) literals.set(operand, { value, line });
      }
    }
    if (address + size > 0xff00) throw new CaslError(line, 'プログラム領域が上限を超えました。');
    if (label && (form === 'data' || form === 'reserve')) variables.push({ name: label, address, size });
    nodes.push({ line, source: original, op, args, address, size, form, opcode });
    address += size;
  }
  if (!started || !ended) throw new CaslError(startLine, 'STARTとENDが必要です。');
  for (const literal of literals.values()) {
    if (address >= 0xff00) throw new CaslError(literal.line, 'リテラル領域が上限を超えました。');
    literal.address = address; memory[address++] = literal.value;
  }
  const resolve = (text, line) => {
    if (literals.has(text)) return literals.get(text).address;
    if (symbols.has(text)) return symbols.get(text);
    if (/^[A-Z]/.test(text)) throw new CaslError(line, `未定義ラベルです: ${text}`);
    return numeric(text, line, true);
  };
  for (const node of nodes) {
    const { args, line, address: at, form, opcode } = node;
    if (form === 'data') args.forEach((a, i) => { memory[at + i] = numeric(a, line); });
    else if (form !== 'reserve') {
      let first = opcode << 8;
      if (form === 'register') first |= reg(args[0]) << 4 | reg(args[1]);
      if (form === 'address') first |= reg(args[0]) << 4 | (args[2] ? reg(args[2]) : 0);
      if (form === 'jump') first |= args[1] ? reg(args[1]) : 0;
      memory[at] = first;
      if (form === 'input') {
        node.buffer = resolve(args[0], line); node.lengthAddress = resolve(args[1], line);
        const allocated = nodes.filter(n => n.form === 'data' || n.form === 'reserve');
        const contains = (address, size) => {
          for (let offset = 0; offset < size; offset++) {
            if (!allocated.some(n => address + offset >= n.address && address + offset < n.address + n.size)) return false;
          }
          return true;
        };
        if (!contains(node.buffer, 256) || !contains(node.lengthAddress, 1)) throw new CaslError(line, 'INには256語の入力領域と1語の文字数領域が必要です。');
        if (node.lengthAddress >= node.buffer && node.lengthAddress < node.buffer + 256) throw new CaslError(line, 'INの入力領域と文字数領域が重複しています。');
        // Private simulator service; target addresses are carried by the assembled node.
        memory[at + 1] = 0xfff0;
      } else if (node.size === 2) memory[at + 1] = resolve(args[form === 'jump' ? 0 : 1], line);
      node.words = Array.from(memory.slice(at, at + node.size));
      instructions.set(at, node);
    }
  }
  if (startTarget && !symbols.has(startTarget)) throw new CaslError(startLine, `STARTの開始ラベルが未定義です: ${startTarget}`);
  const entry = startTarget ? symbols.get(startTarget) : BASE;
  if (!instructions.has(entry)) throw new CaslError(startLine, '開始位置に実行命令がありません。');
  return { memory, instructions, symbols, entry, variables };
}

function encodeInput(text) {
  if (typeof text !== 'string') throw new Error('文字列を入力してください。');
  return Array.from(text).slice(0, 256).map(char => {
    const n = char.codePointAt(0);
    if (n >= 0x20 && n <= 0x7e) return n;
    if (n >= 0xff61 && n <= 0xff9f) return n - 0xff61 + 0xa1;
    if (char === '¥') return 0x5c;
    if (char === '‾') return 0x7e;
    throw new Error('半角英数字・記号・半角カナを入力してください。');
  });
}

function* execution(program, maxSteps = 2000) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 2000) throw new Error('実行上限は1～2000です。');
  const memory = program.memory.slice(), gr = Array(8).fill(0), flags = { OF: 0, SF: 0, ZF: 0 };
  let pr = program.entry, status = 'limit', message = `${maxSteps}命令の上限に達したため停止しました。`, errorLine;
  const snapshot = () => ({ gr: [...gr], flags: { ...flags }, sp: 0 });
  const initial = snapshot(), rows = [];
  for (let step = 1; step <= maxSteps; step++) {
    const node = program.instructions.get(pr);
    if (!node || node.words.some((v, i) => memory[pr + i] !== v)) {
      status = 'error'; message = `#${pr.toString(16).toUpperCase()} は実行命令の先頭ではないか、命令が書き換えられています。`; errorLine = node?.line; break;
    }
    let input;
    if (node.form === 'input') {
      input = yield { line: node.line, buffer: node.args[0], length: node.args[1] };
      if (input === undefined) { status = 'cancelled'; message = '入力を中止しました。'; break; }
    }
    const instructionAddress = pr, code = memory[pr] >>> 8, r = memory[pr] >>> 4 & 15, x = memory[pr] & 15;
    const reads = new Set(), writes = new Set(), flagWrites = new Set(), flagReads = new Set(), accesses = [];
    const readReg = i => { reads.add(i); return gr[i]; };
    const writeReg = (i, value) => { writes.add(i); gr[i] = word(value); };
    const readMemory = at => { accesses.push({ kind: 'read', address: at, value: memory[at] }); return memory[at]; };
    const setFlags = (result, overflow) => {
      flags.OF = Number(overflow); flags.SF = Number((word(result) & 0x8000) !== 0); flags.ZF = Number(word(result) === 0);
      ['OF', 'SF', 'ZF'].forEach(f => flagWrites.add(f));
    };
    const address = node.size === 2 ? word(memory[pr + 1] + (x ? readReg(x) : 0)) : 0;
    pr = word(pr + node.size);
    if (node.form === 'input') {
      let codes;
      try { codes = input === null ? [] : encodeInput(input); }
      catch (error) { throw new CaslError(node.line, error.message); }
      const store = (at, value) => { accesses.push({ kind: 'write', address: at, before: memory[at], value }); memory[at] = value; };
      codes.forEach((value, i) => store(node.buffer + i, value));
      store(node.lengthAddress, input === null ? 0xffff : codes.length);
      // FR is unspecified by CASL II after IN. This environment resets it to zero.
      flags.OF = flags.SF = flags.ZF = 0;
      ['OF', 'SF', 'ZF'].forEach(f => flagWrites.add(f));
    } else if (code === 0x12) writeReg(r, address);
    else if (code === 0x11) {
      const value = readReg(r); accesses.push({ kind: 'write', address, before: memory[address], value }); memory[address] = value;
    } else if (code === 0x81) { status = 'completed'; message = '正常終了しました。'; }
    else if (code >= 0x61 && code <= 0x66) {
      const used = { 0x61: ['SF'], 0x62: ['ZF'], 0x63: ['ZF'], 0x64: [], 0x65: ['SF', 'ZF'], 0x66: ['OF'] }[code];
      used.forEach(f => flagReads.add(f));
      const take = { 0x61: flags.SF === 1, 0x62: flags.ZF === 0, 0x63: flags.ZF === 1, 0x64: true, 0x65: flags.SF === 0 && flags.ZF === 0, 0x66: flags.OF === 1 }[code];
      if (take) pr = address;
    } else if (code !== 0) {
      const value = node.form === 'register' ? readReg(x) : readMemory(address);
      const op = node.op;
      if (op === 'LD') { writeReg(r, value); setFlags(value, false); }
      else {
        const left = readReg(r);
        if (op === 'CPA' || op === 'CPL') {
          const a = op === 'CPA' ? signed(left) : left, b = op === 'CPA' ? signed(value) : value;
          flags.OF = 0; flags.SF = Number(a < b); flags.ZF = Number(a === b);
          ['OF', 'SF', 'ZF'].forEach(f => flagWrites.add(f));
        } else {
          let result, overflow = false;
          if (op === 'ADDA' || op === 'SUBA') {
            result = signed(left) + (op === 'ADDA' ? signed(value) : -signed(value)); overflow = result < -32768 || result > 32767;
          } else if (op === 'ADDL' || op === 'SUBL') {
            result = left + (op === 'ADDL' ? value : -value); overflow = result < 0 || result > 65535;
          } else result = op === 'AND' ? left & value : op === 'OR' ? left | value : left ^ value;
          writeReg(r, result); setFlags(result, overflow);
        }
      }
    }
    rows.push({ step, pr: instructionAddress, nextPr: pr, line: node.line, source: node.source, ...snapshot(), reads: [...reads], writes: [...writes], flagWrites: [...flagWrites], flagReads: [...flagReads], accesses });
    if (status === 'completed') break;
  }
  const variables = program.variables.map(variable => ({ ...variable,
    initial: Array.from(program.memory.slice(variable.address, variable.address + variable.size)),
    final: Array.from(memory.slice(variable.address, variable.address + variable.size)),
  }));
  return { initial, rows, status, message, errorLine, memory, symbols: program.symbols, variables };
}

function execute(program, maxSteps = 2000, inputs = []) {
  const machine = execution(program, maxSteps);
  let state = machine.next(), index = 0;
  while (!state.done) state = machine.next(inputs[index++]);
  return state.value;
}

async function executeWithInput(program, readInput, maxSteps = 2000) {
  const machine = execution(program, maxSteps);
  let state = machine.next();
  while (!state.done) state = machine.next(await readInput(state.value));
  return state.value;
}

module.exports = { assemble, execute, executeWithInput, encodeInput, CaslError, signed };
