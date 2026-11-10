'use strict';

const BASE = 0x1000;
const binary = { LD: [0x10, 0x14], ADDA: [0x20, 0x24], SUBA: [0x21, 0x25], ADDL: [0x22, 0x26], SUBL: [0x23, 0x27], AND: [0x30, 0x34], OR: [0x31, 0x35], XOR: [0x32, 0x36], CPA: [0x40, 0x44], CPL: [0x41, 0x45] };
const jumps = { JMI: 0x61, JNZ: 0x62, JZE: 0x63, JUMP: 0x64, JPL: 0x65, JOV: 0x66 };
const shifts = { SLA: 0x50, SRA: 0x51, SLL: 0x52, SRL: 0x53 };
const targetOpcodes = { ...jumps, PUSH: 0x70, CALL: 0x80, SVC: 0xf0 };
const inputSize = 256;
const maxOutputSize = 65536;
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

function containsData(ranges, address, size) {
  return ranges.some(([start, end]) => address >= start && address + size <= end);
}

function inputAreaError(ranges, buffer, lengthAddress) {
  if (!containsData(ranges, buffer, inputSize) || !containsData(ranges, lengthAddress, 1)) {
    return 'INには256語の入力領域と1語の文字数領域が必要です。';
  }
  if (lengthAddress >= buffer && lengthAddress < buffer + inputSize) {
    return 'INの入力領域と文字数領域が重複しています。';
  }
}

function assemble(source) {
  const memory = new Uint16Array(65536), symbols = new Map(), instructions = new Map();
  const nodes = [], literals = new Map(), variables = [], dataRanges = [];
  let address = BASE, started = false, ended = false, startTarget, startLine = 1;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = index + 1, text = original.replace(/('(?:[^']|'')*')|;.*/g, '$1').trimEnd();
    if (!text.trim()) continue;
    if (ended) throw new CaslError(line, 'ENDの後には命令を書けません。');
    const match = text.match(/^(?:(\S+)\s+)?\s*([A-Z]+)(?:\s+(.*))?$/);
    if (!match) throw new CaslError(line, '「ラベル 命令 オペランド」の形式を確認してください。');
    const [, label, op, operands = ''] = match;
    const separator = operands.includes("'") ? /,(?=(?:[^']*'[^']*')*[^']*$)/ : ',';
    const args = operands ? operands.split(separator).map(s => s.trim()) : [];
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
    let size, form, opcode, data;
    const fail = () => { throw new CaslError(line, `${op}のオペランドを確認してください。`); };
    if (op === 'RPUSH' || op === 'RPOP') {
      if (args.length) fail();
      const pushing = op === 'RPUSH', size = pushing ? 2 : 1;
      if (address + 7 * size > 0xff00) throw new CaslError(line, 'プログラム領域が上限を超えました。');
      for (let i = 1; i <= 7; i++) {
        nodes.push({ line, source: original, op: pushing ? 'PUSH' : 'POP', address, size,
          form: pushing ? 'target' : 'pop', opcode: pushing ? 0x70 : 0x71,
          args: pushing ? ['0', `GR${i}`] : [`GR${8 - i}`] });
        address += size;
      }
      continue;
    }
    if (op === 'DC') {
      if (!args.length) fail();
      data = args.flatMap(arg => {
        if (!/^'(?:[^']|'')+'$/.test(arg)) return [numeric(arg, line)];
        try { return Array.from(arg.slice(1, -1).replace(/''/g, "'"), encodeChar); }
        catch (error) { throw new CaslError(line, error.message); }
      });
      size = data.length; form = 'data';
    } else if (op === 'DS') {
      if (args.length !== 1 || !/^\d+$/.test(args[0])) fail();
      size = numeric(args[0], line, true); form = 'reserve';
    } else if (op === 'IN' || op === 'OUT') {
      if (args.length !== 2 || args.some(a => !/^[A-Z][A-Z0-9]{0,7}$/.test(a) || reg(a) >= 0)) fail();
      size = 2; opcode = 0xf0; form = op === 'IN' ? 'input' : 'output';
    } else if (op === 'POP') {
      if (args.length !== 1 || reg(args[0]) < 0) fail();
      size = 1; opcode = 0x71; form = 'pop';
    } else if (op === 'NOP' || op === 'RET') {
      if (args.length) fail();
      size = 1; opcode = op === 'NOP' ? 0 : 0x81; form = 'none';
    } else if (binary[op] || shifts[op] || op === 'LAD' || op === 'ST') {
      if (args.length < 2 || args.length > 3 || reg(args[0]) < 0) fail();
      if (binary[op] && args.length === 2 && reg(args[1]) >= 0) {
        form = 'register'; opcode = binary[op][1]; size = 1;
      } else {
        form = 'address'; opcode = binary[op] ? binary[op][0] : shifts[op] || (op === 'LAD' ? 0x12 : 0x11); size = 2;
        if (reg(args[1]) >= 0 || (args.length === 3 && reg(args[2]) < 1)) fail();
      }
    } else if (targetOpcodes[op]) {
      if (args.length < 1 || args.length > 2 || reg(args[0]) >= 0 || (args.length === 2 && reg(args[1]) < 1)) fail();
      form = 'target'; opcode = targetOpcodes[op]; size = 2;
    } else throw new CaslError(line, `未対応の命令です: ${op}（対応範囲はREADMEを参照）`);
    if (form === 'address' || form === 'target') {
      const operand = args[form === 'target' ? 0 : 1];
      if (operand.startsWith('=')) {
        const value = numeric(operand.slice(1), line);
        if (!literals.has(operand)) literals.set(operand, { value, line });
      }
    }
    if (address + size > 0xff00) throw new CaslError(line, 'プログラム領域が上限を超えました。');
    if (data) memory.set(data, address);
    if (form === 'data' || form === 'reserve') {
      if (label) variables.push({ name: label, address, size });
      const last = dataRanges.at(-1);
      if (size && last?.[1] === address) last[1] += size;
      else if (size) dataRanges.push([address, address + size]);
    }
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
    return numeric(text, line);
  };
  for (const node of nodes) {
    const { args, line, address: at, form, opcode } = node;
    if (form !== 'data' && form !== 'reserve') {
      let first = opcode << 8;
      if (form === 'register') first |= reg(args[0]) << 4 | reg(args[1]);
      if (form === 'address') first |= reg(args[0]) << 4 | (args[2] ? reg(args[2]) : 0);
      if (form === 'target') first |= args[1] ? reg(args[1]) : 0;
      if (form === 'pop') first |= reg(args[0]) << 4;
      memory[at] = first;
      if (form === 'input' || form === 'output') {
        node.buffer = resolve(args[0], line); node.lengthAddress = resolve(args[1], line);
        const error = form === 'input' ? inputAreaError(dataRanges, node.buffer, node.lengthAddress) :
          !containsData(dataRanges, node.lengthAddress, 1) && 'OUTには1語の文字数領域が必要です。';
        if (error) throw new CaslError(line, error);
        // The I/O macros carry their operands in the assembled node.
        memory[at + 1] = form === 'input' ? 0xfff0 : 0xfff1;
      } else if (node.size === 2) memory[at + 1] = resolve(args[form === 'target' ? 0 : 1], line);
      node.words = Array.from(memory.slice(at, at + node.size));
      instructions.set(at, node);
    }
  }
  if (startTarget && !symbols.has(startTarget)) throw new CaslError(startLine, `STARTの開始ラベルが未定義です: ${startTarget}`);
  const entry = startTarget ? symbols.get(startTarget) : BASE;
  if (!instructions.has(entry)) throw new CaslError(startLine, '開始位置に実行命令がありません。');
  return { memory, instructions, symbols, entry, variables, dataRanges, end: address };
}

function encodeChar(char) {
  const n = char.codePointAt(0);
  if (n >= 0x20 && n <= 0x7e) return n;
  if (n >= 0xff61 && n <= 0xff9f) return n - 0xff61 + 0xa1;
  if (char === '¥') return 0x5c;
  if (char === '‾') return 0x7e;
  throw new Error('半角英数字・記号・半角カナを入力してください。');
}

function encodeInput(text) {
  if (typeof text !== 'string') throw new Error('文字列を入力してください。');
  return Array.from(text).slice(0, inputSize).map(encodeChar);
}

function decodeChar(word) {
  const byte = word & 0xff;
  if (byte === 0x5c) return '¥';
  if (byte === 0x7e) return '‾';
  if (byte <= 0x7f) return String.fromCharCode(byte);
  if (byte >= 0xa1 && byte <= 0xdf) return String.fromCharCode(byte - 0xa1 + 0xff61);
  return '\ufffd';
}

function* execution(program, maxSteps = 2000) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 2000) throw new Error('実行上限は1～2000です。');
  const memory = program.memory.slice(), gr = Array(8).fill(0), flags = { OF: 0, SF: 0, ZF: 0 };
  const rows = [], output = [];
  let sp = 0, outputSize = 0;
  let pr = program.entry, status = 'limit', message = `${maxSteps}命令の上限に達したため停止しました。`, errorLine;
  const snapshot = () => ({ gr: [...gr], flags: { ...flags }, sp });
  const initial = snapshot();
  for (let step = 1; step <= maxSteps; step++) {
    const node = program.instructions.get(pr);
    if (!node || node.words.some((v, i) => memory[pr + i] !== v)) {
      status = 'error'; message = `#${pr.toString(16).toUpperCase()} は実行命令の先頭ではないか、命令が書き換えられています。`; errorLine = node?.line; break;
    }
    const instructionAddress = pr, code = memory[pr] >>> 8, r = memory[pr] >>> 4 & 15, x = memory[pr] & 15;
    const reads = new Set(), writes = new Set(), flagWrites = new Set(), flagReads = new Set(), accesses = [];
    const readReg = i => { reads.add(i); return gr[i]; };
    const writeReg = (i, value) => { writes.add(i); gr[i] = word(value); };
    const readMemory = at => { accesses.push({ kind: 'read', address: at, value: memory[at] }); return memory[at]; };
    const writeMemory = (at, value) => { accesses.push({ kind: 'write', address: at, before: memory[at], value }); memory[at] = value; };
    const fail = reason => { status = 'error'; message = `${node.line}行: ${reason}`; errorLine = node.line; };
    const setFlags = (result, overflow) => {
      flags.OF = Number(overflow); flags.SF = Number((word(result) & 0x8000) !== 0); flags.ZF = Number(word(result) === 0);
      ['OF', 'SF', 'ZF'].forEach(f => flagWrites.add(f));
    };
    const address = node.size === 2 ? word(memory[pr + 1] + (x ? readReg(x) : 0)) : 0;
    pr = word(pr + node.size);
    if (code === 0xf0) {
      const service = node.form === 'input' ? 1 : node.form === 'output' ? 2 : address;
      if (service !== 1 && service !== 2) {
        fail(`未対応のSVC番号です: #${service.toString(16).toUpperCase().padStart(4, '0')}（1: 入力、2: 出力）`);
        break;
      }
      const buffer = node.buffer ?? readReg(1), lengthAddress = node.lengthAddress ?? readReg(2);
      if (service === 1) {
        const error = inputAreaError(program.dataRanges, buffer, lengthAddress);
        if (error) { fail(error); break; }
        const input = yield node.form === 'input' ? { line: node.line, buffer: node.args[0], length: node.args[1] } :
          { line: node.line, buffer: 'GR1', length: 'GR2', service };
        if (input === undefined) { status = 'cancelled'; message = '入力を中止しました。'; break; }
        let codes;
        try { codes = input === null ? [] : encodeInput(input); }
        catch (error) { throw new CaslError(node.line, error.message); }
        codes.forEach((value, i) => writeMemory(buffer + i, value));
        writeMemory(lengthAddress, input === null ? 0xffff : codes.length);
      } else {
        if (!containsData(program.dataRanges, lengthAddress, 1)) { fail('OUTには1語の文字数領域が必要です。'); break; }
        const size = readMemory(lengthAddress);
        if (size && !containsData(program.dataRanges, buffer, size)) { fail('出力文字数がOUTのデータ領域を超えています。'); break; }
        if (outputSize + size > maxOutputSize) { fail(`出力が合計${maxOutputSize}文字の上限を超えました。`); break; }
        let record = '';
        for (let i = 0; i < size; i++) record += decodeChar(readMemory(buffer + i));
        output.push(record);
        outputSize += size;
      }
      // The I/O services preserve GR and SP and clear FR in this environment.
      flags.OF = flags.SF = flags.ZF = 0;
      ['OF', 'SF', 'ZF'].forEach(f => flagWrites.add(f));
    } else if (code === 0x12) writeReg(r, address);
    else if (code === 0x11) writeMemory(address, readReg(r));
    else if (code === 0x70 || code === 0x80) {
      const nextSp = word(sp - 1);
      if (nextSp < program.end) { fail('スタック領域の上限を超えました。'); break; }
      sp = nextSp;
      writeMemory(sp, code === 0x70 ? address : pr);
      if (code === 0x80) pr = address;
    } else if (code === 0x81 && sp === 0) {
      status = 'completed'; message = '正常終了しました。';
    } else if (code === 0x71 || code === 0x81) {
      if (sp === 0) { fail('スタックが空です。'); break; }
      const value = readMemory(sp);
      sp = word(sp + 1);
      if (code === 0x71) writeReg(r, value);
      else pr = value;
    } else if (code >= 0x61 && code <= 0x66) {
      const used = { 0x61: ['SF'], 0x62: ['ZF'], 0x63: ['ZF'], 0x64: [], 0x65: ['SF', 'ZF'], 0x66: ['OF'] }[code];
      used.forEach(f => flagReads.add(f));
      const take = { 0x61: flags.SF === 1, 0x62: flags.ZF === 0, 0x63: flags.ZF === 1, 0x64: true, 0x65: flags.SF === 0 && flags.ZF === 0, 0x66: flags.OF === 1 }[code];
      if (take) pr = address;
    } else if (code >= 0x50 && code <= 0x53) {
      // The effective address itself is the count; no operand memory is read.
      let result = readReg(r), overflow = 0;
      // The 16th logical shift can still emit a 1; after 17 both are stable.
      for (let i = 0; i < Math.min(address, 17); i++) {
        if (code === 0x50) {
          overflow = (result >>> 14) & 1;
          result = (result & 0x8000) | ((result << 1) & 0x7fff);
        } else if (code === 0x52) {
          overflow = result >>> 15;
          result = word(result << 1);
        } else {
          overflow = result & 1;
          result = (result >>> 1) | (code === 0x51 ? result & 0x8000 : 0);
        }
      }
      writeReg(r, result); setFlags(result, overflow);
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
  return { initial, rows, status, message, errorLine, memory, symbols: program.symbols, variables, output };
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
