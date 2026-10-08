"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/core.js
var require_core = __commonJS({
  "src/core.js"(exports2, module2) {
    "use strict";
    var BASE = 4096;
    var binary = { LD: [16, 20], ADDA: [32, 36], SUBA: [33, 37], ADDL: [34, 38], SUBL: [35, 39], AND: [48, 52], OR: [49, 53], XOR: [50, 54], CPA: [64, 68], CPL: [65, 69] };
    var jumps = { JMI: 97, JNZ: 98, JZE: 99, JUMP: 100, JPL: 101, JOV: 102 };
    var signed = (n) => n & 32768 ? n - 65536 : n;
    var word = (n) => n & 65535;
    var reg = (text) => /^GR[0-7]$/.test(text || "") ? Number(text[2]) : -1;
    var CaslError2 = class extends Error {
      constructor(line, message) {
        super(`${line}\u884C: ${message}`);
        this.line = line;
      }
    };
    function numeric(text, line, address = false) {
      let value;
      if (/^#[0-9A-Fa-f]{1,4}$/.test(text)) value = parseInt(text.slice(1), 16);
      else if (/^[+-]?\d+$/.test(text)) value = Number(text);
      else throw new CaslError2(line, `\u6570\u5024\u304C\u5FC5\u8981\u3067\u3059: ${text}`);
      if (!Number.isInteger(value) || value < (address ? 0 : -32768) || value > 65535) {
        throw new CaslError2(line, `16\u30D3\u30C3\u30C8\u306E\u7BC4\u56F2\u5916\u3067\u3059: ${text}`);
      }
      return word(value);
    }
    function assemble2(source) {
      const memory = new Uint16Array(65536), symbols = /* @__PURE__ */ new Map(), instructions = /* @__PURE__ */ new Map();
      const nodes = [], literals = /* @__PURE__ */ new Map(), variables = [];
      let address = BASE, started = false, ended = false, startTarget, startLine = 1;
      for (const [index, original] of source.split(/\r?\n/).entries()) {
        const line = index + 1, text = original.split(";")[0].trimEnd();
        if (!text.trim()) continue;
        if (ended) throw new CaslError2(line, "END\u306E\u5F8C\u306B\u306F\u547D\u4EE4\u3092\u66F8\u3051\u307E\u305B\u3093\u3002");
        const match = text.match(/^(?:(\S+)\s+)?\s*([A-Z]+)(?:\s+(.*))?$/);
        if (!match) throw new CaslError2(line, "\u300C\u30E9\u30D9\u30EB \u547D\u4EE4 \u30AA\u30DA\u30E9\u30F3\u30C9\u300D\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        const [, label, op, operands = ""] = match;
        const args = operands ? operands.split(",").map((s) => s.trim()) : [];
        if (args.some((s) => !s)) throw new CaslError2(line, "\u7A7A\u306E\u30AA\u30DA\u30E9\u30F3\u30C9\u304C\u3042\u308A\u307E\u3059\u3002");
        if (label) {
          if (!/^[A-Z][A-Z0-9]{0,7}$/.test(label) || reg(label) >= 0) throw new CaslError2(line, `\u4E0D\u6B63\u306A\u30E9\u30D9\u30EB\u3067\u3059: ${label}`);
          if (symbols.has(label)) throw new CaslError2(line, `\u30E9\u30D9\u30EB\u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${label}`);
          symbols.set(label, address);
        }
        if (op === "START") {
          if (started || nodes.length || !label || args.length > 1) throw new CaslError2(line, "START\u306F\u30E9\u30D9\u30EB\u4ED8\u304D\u3067\u5148\u982D\u306B1\u56DE\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          started = true;
          startTarget = args[0];
          startLine = line;
          continue;
        }
        if (!started) throw new CaslError2(line, "\u5148\u982D\u306BSTART\u304C\u5FC5\u8981\u3067\u3059\u3002");
        if (op === "END") {
          if (label || args.length) throw new CaslError2(line, "END\u306B\u306F\u30E9\u30D9\u30EB\u3084\u30AA\u30DA\u30E9\u30F3\u30C9\u3092\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002");
          ended = true;
          continue;
        }
        let size, form, opcode;
        const fail = () => {
          throw new CaslError2(line, `${op}\u306E\u30AA\u30DA\u30E9\u30F3\u30C9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
        };
        if (op === "DC") {
          if (!args.length) fail();
          args.forEach((a) => numeric(a, line));
          size = args.length;
          form = "data";
        } else if (op === "DS") {
          if (args.length !== 1 || !/^\d+$/.test(args[0])) fail();
          size = numeric(args[0], line, true);
          form = "reserve";
        } else if (op === "IN") {
          if (args.length !== 2 || args.some((a) => !/^[A-Z][A-Z0-9]{0,7}$/.test(a) || reg(a) >= 0)) fail();
          size = 2;
          opcode = 240;
          form = "input";
        } else if (op === "NOP" || op === "RET") {
          if (args.length) fail();
          size = 1;
          opcode = op === "NOP" ? 0 : 129;
          form = "none";
        } else if (binary[op] || op === "LAD" || op === "ST") {
          if (args.length < 2 || args.length > 3 || reg(args[0]) < 0) fail();
          if (binary[op] && args.length === 2 && reg(args[1]) >= 0) {
            form = "register";
            opcode = binary[op][1];
            size = 1;
          } else {
            form = "address";
            opcode = binary[op] ? binary[op][0] : op === "LAD" ? 18 : 17;
            size = 2;
            if (reg(args[1]) >= 0 || args.length === 3 && reg(args[2]) < 1) fail();
          }
        } else if (jumps[op]) {
          if (args.length < 1 || args.length > 2 || reg(args[0]) >= 0 || args.length === 2 && reg(args[1]) < 1) fail();
          form = "jump";
          opcode = jumps[op];
          size = 2;
        } else throw new CaslError2(line, `\u672A\u5BFE\u5FDC\u306E\u547D\u4EE4\u3067\u3059: ${op}\uFF08\u5BFE\u5FDC\u7BC4\u56F2\u306FREADME\u3092\u53C2\u7167\uFF09`);
        if (form === "address" || form === "jump") {
          const operand = args[form === "jump" ? 0 : 1];
          if (operand.startsWith("=")) {
            const value = numeric(operand.slice(1), line);
            if (!literals.has(operand)) literals.set(operand, { value, line });
          }
        }
        if (address + size > 65280) throw new CaslError2(line, "\u30D7\u30ED\u30B0\u30E9\u30E0\u9818\u57DF\u304C\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002");
        if (label && (form === "data" || form === "reserve")) variables.push({ name: label, address, size });
        nodes.push({ line, source: original, op, args, address, size, form, opcode });
        address += size;
      }
      if (!started || !ended) throw new CaslError2(startLine, "START\u3068END\u304C\u5FC5\u8981\u3067\u3059\u3002");
      for (const literal of literals.values()) {
        if (address >= 65280) throw new CaslError2(literal.line, "\u30EA\u30C6\u30E9\u30EB\u9818\u57DF\u304C\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002");
        literal.address = address;
        memory[address++] = literal.value;
      }
      const resolve = (text, line) => {
        if (literals.has(text)) return literals.get(text).address;
        if (symbols.has(text)) return symbols.get(text);
        if (/^[A-Z]/.test(text)) throw new CaslError2(line, `\u672A\u5B9A\u7FA9\u30E9\u30D9\u30EB\u3067\u3059: ${text}`);
        return numeric(text, line);
      };
      for (const node of nodes) {
        const { args, line, address: at, form, opcode } = node;
        if (form === "data") args.forEach((a, i) => {
          memory[at + i] = numeric(a, line);
        });
        else if (form !== "reserve") {
          let first = opcode << 8;
          if (form === "register") first |= reg(args[0]) << 4 | reg(args[1]);
          if (form === "address") first |= reg(args[0]) << 4 | (args[2] ? reg(args[2]) : 0);
          if (form === "jump") first |= args[1] ? reg(args[1]) : 0;
          memory[at] = first;
          if (form === "input") {
            node.buffer = resolve(args[0], line);
            node.lengthAddress = resolve(args[1], line);
            const allocated = nodes.filter((n) => n.form === "data" || n.form === "reserve");
            const contains = (address2, size) => {
              for (let offset = 0; offset < size; offset++) {
                if (!allocated.some((n) => address2 + offset >= n.address && address2 + offset < n.address + n.size)) return false;
              }
              return true;
            };
            if (!contains(node.buffer, 256) || !contains(node.lengthAddress, 1)) throw new CaslError2(line, "IN\u306B\u306F256\u8A9E\u306E\u5165\u529B\u9818\u57DF\u30681\u8A9E\u306E\u6587\u5B57\u6570\u9818\u57DF\u304C\u5FC5\u8981\u3067\u3059\u3002");
            if (node.lengthAddress >= node.buffer && node.lengthAddress < node.buffer + 256) throw new CaslError2(line, "IN\u306E\u5165\u529B\u9818\u57DF\u3068\u6587\u5B57\u6570\u9818\u57DF\u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059\u3002");
            memory[at + 1] = 65520;
          } else if (node.size === 2) memory[at + 1] = resolve(args[form === "jump" ? 0 : 1], line);
          node.words = Array.from(memory.slice(at, at + node.size));
          instructions.set(at, node);
        }
      }
      if (startTarget && !symbols.has(startTarget)) throw new CaslError2(startLine, `START\u306E\u958B\u59CB\u30E9\u30D9\u30EB\u304C\u672A\u5B9A\u7FA9\u3067\u3059: ${startTarget}`);
      const entry = startTarget ? symbols.get(startTarget) : BASE;
      if (!instructions.has(entry)) throw new CaslError2(startLine, "\u958B\u59CB\u4F4D\u7F6E\u306B\u5B9F\u884C\u547D\u4EE4\u304C\u3042\u308A\u307E\u305B\u3093\u3002");
      return { memory, instructions, symbols, entry, variables };
    }
    function encodeInput2(text) {
      if (typeof text !== "string") throw new Error("\u6587\u5B57\u5217\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return Array.from(text).slice(0, 256).map((char) => {
        const n = char.codePointAt(0);
        if (n >= 32 && n <= 126) return n;
        if (n >= 65377 && n <= 65439) return n - 65377 + 161;
        if (char === "\xA5") return 92;
        if (char === "\u203E") return 126;
        throw new Error("\u534A\u89D2\u82F1\u6570\u5B57\u30FB\u8A18\u53F7\u30FB\u534A\u89D2\u30AB\u30CA\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      });
    }
    function* execution(program, maxSteps = 2e3) {
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 2e3) throw new Error("\u5B9F\u884C\u4E0A\u9650\u306F1\uFF5E2000\u3067\u3059\u3002");
      const memory = program.memory.slice(), gr = Array(8).fill(0), flags = { OF: 0, SF: 0, ZF: 0 };
      let pr = program.entry, status = "limit", message = `${maxSteps}\u547D\u4EE4\u306E\u4E0A\u9650\u306B\u9054\u3057\u305F\u305F\u3081\u505C\u6B62\u3057\u307E\u3057\u305F\u3002`, errorLine;
      const snapshot = () => ({ gr: [...gr], flags: { ...flags }, sp: 0 });
      const initial = snapshot(), rows = [];
      for (let step = 1; step <= maxSteps; step++) {
        const node = program.instructions.get(pr);
        if (!node || node.words.some((v, i) => memory[pr + i] !== v)) {
          status = "error";
          message = `#${pr.toString(16).toUpperCase()} \u306F\u5B9F\u884C\u547D\u4EE4\u306E\u5148\u982D\u3067\u306F\u306A\u3044\u304B\u3001\u547D\u4EE4\u304C\u66F8\u304D\u63DB\u3048\u3089\u308C\u3066\u3044\u307E\u3059\u3002`;
          errorLine = node?.line;
          break;
        }
        let input;
        if (node.form === "input") {
          input = yield { line: node.line, buffer: node.args[0], length: node.args[1] };
          if (input === void 0) {
            status = "cancelled";
            message = "\u5165\u529B\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002";
            break;
          }
        }
        const instructionAddress = pr, code = memory[pr] >>> 8, r = memory[pr] >>> 4 & 15, x = memory[pr] & 15;
        const reads = /* @__PURE__ */ new Set(), writes = /* @__PURE__ */ new Set(), flagWrites = /* @__PURE__ */ new Set(), flagReads = /* @__PURE__ */ new Set(), accesses = [];
        const readReg = (i) => {
          reads.add(i);
          return gr[i];
        };
        const writeReg = (i, value) => {
          writes.add(i);
          gr[i] = word(value);
        };
        const readMemory = (at) => {
          accesses.push({ kind: "read", address: at, value: memory[at] });
          return memory[at];
        };
        const setFlags = (result, overflow) => {
          flags.OF = Number(overflow);
          flags.SF = Number((word(result) & 32768) !== 0);
          flags.ZF = Number(word(result) === 0);
          ["OF", "SF", "ZF"].forEach((f) => flagWrites.add(f));
        };
        const address = node.size === 2 ? word(memory[pr + 1] + (x ? readReg(x) : 0)) : 0;
        pr = word(pr + node.size);
        if (node.form === "input") {
          let codes;
          try {
            codes = input === null ? [] : encodeInput2(input);
          } catch (error) {
            throw new CaslError2(node.line, error.message);
          }
          const store = (at, value) => {
            accesses.push({ kind: "write", address: at, before: memory[at], value });
            memory[at] = value;
          };
          codes.forEach((value, i) => store(node.buffer + i, value));
          store(node.lengthAddress, input === null ? 65535 : codes.length);
          flags.OF = flags.SF = flags.ZF = 0;
          ["OF", "SF", "ZF"].forEach((f) => flagWrites.add(f));
        } else if (code === 18) writeReg(r, address);
        else if (code === 17) {
          const value = readReg(r);
          accesses.push({ kind: "write", address, before: memory[address], value });
          memory[address] = value;
        } else if (code === 129) {
          status = "completed";
          message = "\u6B63\u5E38\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002";
        } else if (code >= 97 && code <= 102) {
          const used = { 97: ["SF"], 98: ["ZF"], 99: ["ZF"], 100: [], 101: ["SF", "ZF"], 102: ["OF"] }[code];
          used.forEach((f) => flagReads.add(f));
          const take = { 97: flags.SF === 1, 98: flags.ZF === 0, 99: flags.ZF === 1, 100: true, 101: flags.SF === 0 && flags.ZF === 0, 102: flags.OF === 1 }[code];
          if (take) pr = address;
        } else if (code !== 0) {
          const value = node.form === "register" ? readReg(x) : readMemory(address);
          const op = node.op;
          if (op === "LD") {
            writeReg(r, value);
            setFlags(value, false);
          } else {
            const left = readReg(r);
            if (op === "CPA" || op === "CPL") {
              const a = op === "CPA" ? signed(left) : left, b = op === "CPA" ? signed(value) : value;
              flags.OF = 0;
              flags.SF = Number(a < b);
              flags.ZF = Number(a === b);
              ["OF", "SF", "ZF"].forEach((f) => flagWrites.add(f));
            } else {
              let result, overflow = false;
              if (op === "ADDA" || op === "SUBA") {
                result = signed(left) + (op === "ADDA" ? signed(value) : -signed(value));
                overflow = result < -32768 || result > 32767;
              } else if (op === "ADDL" || op === "SUBL") {
                result = left + (op === "ADDL" ? value : -value);
                overflow = result < 0 || result > 65535;
              } else result = op === "AND" ? left & value : op === "OR" ? left | value : left ^ value;
              writeReg(r, result);
              setFlags(result, overflow);
            }
          }
        }
        rows.push({ step, pr: instructionAddress, nextPr: pr, line: node.line, source: node.source, ...snapshot(), reads: [...reads], writes: [...writes], flagWrites: [...flagWrites], flagReads: [...flagReads], accesses });
        if (status === "completed") break;
      }
      const variables = program.variables.map((variable) => ({
        ...variable,
        initial: Array.from(program.memory.slice(variable.address, variable.address + variable.size)),
        final: Array.from(memory.slice(variable.address, variable.address + variable.size))
      }));
      return { initial, rows, status, message, errorLine, memory, symbols: program.symbols, variables };
    }
    function execute(program, maxSteps = 2e3, inputs = []) {
      const machine = execution(program, maxSteps);
      let state = machine.next(), index = 0;
      while (!state.done) state = machine.next(inputs[index++]);
      return state.value;
    }
    async function executeWithInput2(program, readInput2, maxSteps = 2e3) {
      const machine = execution(program, maxSteps);
      let state = machine.next();
      while (!state.done) state = machine.next(await readInput2(state.value));
      return state.value;
    }
    module2.exports = { assemble: assemble2, execute, executeWithInput: executeWithInput2, encodeInput: encodeInput2, CaslError: CaslError2, signed };
  }
});

// src/render-platform.js
var require_render_platform = __commonJS({
  "src/render-platform.js"(exports2, module2) {
    module2.exports = {
      client: "'use strict';\r\n\r\nfunction variableHistory(result, index, offset = 0) {\r\n  const variable = result.variables[index];\r\n  if (!variable || offset < 0 || offset >= variable.size) return [];\r\n  const address = variable.address + offset;\r\n  let value = variable.initial[offset];\r\n  return [{ step: 0, before: value, after: value, read: false, written: false }, ...result.rows.map(row => {\r\n    const before = value;\r\n    const accesses = row.accesses.filter(a => a.address === address);\r\n    for (const access of accesses) if (access.kind === 'write') value = access.value;\r\n    return { step: row.step, before, after: value, read: accesses.some(a => a.kind === 'read'), written: accesses.some(a => a.kind === 'write') };\r\n  })];\r\n}\r\n\r\nfunction variableAt(result, index, step) {\r\n  const variable = result.variables[index];\r\n  if (!variable) return [];\r\n  const values = [...variable.initial];\r\n  for (const row of result.rows) {\r\n    if (row.step > step) break;\r\n    for (const access of row.accesses) {\r\n      const offset = access.address - variable.address;\r\n      if (access.kind === 'write' && offset >= 0 && offset < variable.size) values[offset] = access.value;\r\n    }\r\n  }\r\n  return values;\r\n}\r\n\r\nfunction resolveWatches(variables, saved) {\r\n  const candidates = Array.isArray(saved) ? saved : variables.filter(v => v.size > 0).slice(0, 8).map(v => ({ name: v.name, offset: 0 }));\r\n  const result = [], keys = new Set();\r\n  for (const candidate of candidates) {\r\n    if (!candidate || typeof candidate.name !== 'string') continue;\r\n    const index = variables.findIndex(v => v.name === candidate.name);\r\n    const offset = candidate.offset;\r\n    if (index < 0 || !Number.isInteger(offset) || offset < 0 || offset >= variables[index].size) continue;\r\n    const key = candidate.name + ':' + offset;\r\n    if (keys.has(key)) continue;\r\n    keys.add(key); result.push({ name: candidate.name, offset, index });\r\n    if (result.length === 12) break;\r\n  }\r\n  return result;\r\n}\r\n\r\nfunction watchSteps(histories, mode) {\r\n  const count = histories[0]?.length || 0;\r\n  return Array.from({ length: count }, (_, step) => step).filter(step => step === 0 || mode === 'all' || histories.some(history =>\r\n    history[step].written || (mode === 'access' && history[step].read)));\r\n}\r\n\r\nif (typeof module !== 'undefined') module.exports = { variableHistory, variableAt, resolveWatches, watchSteps };\r\n\n'use strict';\r\n\r\nconst data = JSON.parse(document.getElementById('trace-data').textContent);\r\nconst byId = id => document.getElementById(id);\r\nconst host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;\r\nconst saved = host?.getState() || {};\r\nlet watches = resolveWatches(data.variables, saved.watches), histories = [], selected = 0, page = 0, visibleSteps = [];\r\nconst traceRows = [...document.querySelectorAll('tr[data-step]')];\r\nconst format = n => byId('base').value === 'binary' ? n.toString(2).padStart(16, '0') : byId('base').value === 'hex' ? n.toString(16).toUpperCase().padStart(4, '0') : String(n >= 32768 ? n - 65536 : n);\r\nconst hexAddress = n => n.toString(16).toUpperCase().padStart(4, '0');\r\nconst watchName = watch => watch.name + (data.variables[watch.index].size > 1 ? '[' + watch.offset + ']' : '');\r\nconst currentVariable = () => data.variables[Number(byId('variable').value)];\r\nconst persist = () => host?.setState({ watches: watches.map(({ name, offset }) => ({ name, offset })), base: byId('base').value, filter: byId('filter').value, registers: byId('registers').checked, machine: byId('machine').checked });\r\n\r\nif (['signed', 'hex', 'binary'].includes(saved.base)) byId('base').value = saved.base;\r\nif (['all', 'write', 'access'].includes(saved.filter)) byId('filter').value = saved.filter;\r\nbyId('registers').checked = saved.registers !== false;\r\nbyId('machine').checked = saved.machine === true;\r\n\r\nbyId('refresh').disabled = !host;\r\nbyId('refresh').addEventListener('click', () => {\r\n  if (!host) return;\r\n  persist();\r\n  byId('refresh').disabled = true;\r\n  byId('refresh-status').textContent = '\u66F4\u65B0\u4E2D\u2026';\r\n  host.postMessage({ type: 'refresh' });\r\n});\r\nwindow.addEventListener('message', event => {\r\n  if (event.data?.type === 'refreshError') {\r\n    byId('refresh-status').textContent = event.data.message;\r\n    byId('refresh').disabled = false;\r\n  } else if (event.data?.type === 'refreshComplete') {\r\n    byId('refresh').disabled = !host;\r\n    if (byId('refresh-status').textContent === '\u66F4\u65B0\u4E2D\u2026') byId('refresh-status').textContent = '';\r\n  }\r\n});\r\n\r\nfunction refreshOptions() {\r\n  const v = currentVariable();\r\n  const max = Math.max(0, (v?.size || 0) - 1);\r\n  byId('offset').max = String(max);\r\n  byId('offset').value = String(Math.max(0, Math.min(max, Math.floor(Number(byId('offset').value) || 0))));\r\n  byId('offset').disabled = !v || v.size <= 1;\r\n  byId('add-watch').disabled = !v || !v.size || watches.length >= 12;\r\n  byId('add-watch').title = watches.length >= 12 ? '\u540C\u6642\u8868\u793A\u306F12\u5217\u307E\u3067\u3067\u3059\u3002\u4E0D\u8981\u306A\u5217\u3092\u5916\u3057\u3066\u304F\u3060\u3055\u3044\u3002' : '\u3053\u306E\u5909\u6570\u3092\u8868\u306B\u8FFD\u52A0';\r\n}\r\n\r\nfunction addWatch(index, offset) {\r\n  const v = data.variables[index];\r\n  if (!v || !v.size || watches.length >= 12) return;\r\n  watches = resolveWatches(data.variables, [...watches, { name: v.name, offset }]);\r\n  refreshColumns();\r\n}\r\n\r\nfunction refreshColumns() {\r\n  histories = watches.map(w => variableHistory(data, w.index, w.offset));\r\n  document.querySelectorAll('.watch-column').forEach(element => element.remove());\r\n  const chips = byId('watch-list'); chips.replaceChildren();\r\n  watches.forEach((watch, index) => {\r\n    const chip = document.createElement('button');\r\n    chip.className = 'watch-chip'; chip.textContent = watchName(watch) + ' \xD7';\r\n    chip.setAttribute('aria-label', watchName(watch) + '\u3092\u8868\u304B\u3089\u5916\u3059');\r\n    chip.addEventListener('click', () => { watches.splice(index, 1); refreshColumns(); });\r\n    chips.append(chip);\r\n    const header = document.createElement('th'); header.className = 'watch-column'; header.scope = 'col';\r\n    header.textContent = watchName(watch);\r\n    header.title = '\u5B9F\u884C\u5F8C\u306E\u5024 \xB7 ' + hexAddress(data.variables[watch.index].address + watch.offset);\r\n    byId('watch-anchor').before(header);\r\n    traceRows.forEach(row => {\r\n      const entry = histories[index][Number(row.dataset.step)];\r\n      const cell = document.createElement('td');\r\n      cell.className = 'watch-column ' + (entry.written ? 'write' : entry.read ? 'read' : 'held');\r\n      cell.textContent = entry.written ? format(entry.before) + ' \u2192 ' + format(entry.after) : format(entry.after);\r\n      cell.title = watchName(watch) + ': ' + (entry.written ? '\u66F4\u65B0' : entry.read ? '\u53C2\u7167' : '\u4FDD\u6301') + ' \xB7 \u5B9F\u884C\u5F8C ' + format(entry.after);\r\n      row.querySelector('.watch-anchor').before(cell);\r\n    });\r\n  });\r\n  byId('watch-count').textContent = watches.length + '\u5217 / ' + data.variables.filter(v => v.size > 0).length + '\u5909\u6570';\r\n  byId('empty-watch').hidden = watches.length > 0 || !data.variables.length;\r\n  byId('filter').disabled = watches.length === 0;\r\n  refreshOptions(); refreshFilter(); persist();\r\n}\r\n\r\nfunction refreshFilter() {\r\n  const steps = histories.length ? watchSteps(histories, byId('filter').value) : traceRows.map(row => Number(row.dataset.step));\r\n  const visible = new Set(steps);\r\n  visibleSteps = steps;\r\n  traceRows.forEach(row => { row.hidden = !visible.has(Number(row.dataset.step)); });\r\n  if (!visible.has(selected)) selected = 0;\r\n  byId('row-count').textContent = Math.max(0, steps.length - 1) + ' / ' + data.rows.length + '\u547D\u4EE4';\r\n  refreshDetail(); persist();\r\n}\r\n\r\nfunction refreshDetail() {\r\n  const current = data.rows[selected - 1];\r\n  byId('position').textContent = selected === 0 ? '\u521D\u671F\u72B6\u614B' : '#' + selected + ' \u5B9F\u884C\u5F8C';\r\n  byId('selected-source').textContent = current?.source.trim() || '';\r\n  const changes = byId('changes'); changes.replaceChildren();\r\n  watches.forEach((watch, i) => {\r\n    const entry = histories[i][selected];\r\n    const item = document.createElement('span');\r\n    item.className = 'state-chip' + (entry.written ? ' write' : entry.read ? ' read' : '');\r\n    item.textContent = watchName(watch) + ' = ' + format(entry.after);\r\n    changes.append(item);\r\n  });\r\n  traceRows.forEach(row => {\r\n    const active = Number(row.dataset.step) === selected;\r\n    row.classList.toggle('selected', active);\r\n    row.querySelector('button').setAttribute('aria-pressed', String(active));\r\n  });\r\n  const changeSteps = histories.length ? watchSteps(histories, 'write').filter(step => step !== 0) : [];\r\n  byId('previous-change').disabled = !changeSteps.some(step => step < selected);\r\n  byId('next-change').disabled = !changeSteps.some(step => step > selected);\r\n  byId('previous').disabled = visibleSteps.indexOf(selected) <= 0;\r\n  byId('next').disabled = visibleSteps.indexOf(selected) >= visibleSteps.length - 1;\r\n  refreshArray();\r\n}\r\n\r\nfunction refreshArray() {\r\n  const v = currentVariable(), container = byId('variable-values');\r\n  container.replaceChildren();\r\n  if (!v) return;\r\n  const values = variableAt(data, Number(byId('variable').value), selected);\r\n  const pages = Math.max(1, Math.ceil(v.size / 32));\r\n  page = Math.max(0, Math.min(page, pages - 1));\r\n  byId('page-label').textContent = (page + 1) + ' / ' + pages;\r\n  byId('page-prev').disabled = page === 0; byId('page-next').disabled = page === pages - 1;\r\n  byId('variable-address').textContent = v.name + ' \xB7 ' + hexAddress(v.address) + ' \xB7 ' + v.size + '\u8A9E';\r\n  if (!v.size) { container.textContent = '\u9818\u57DF\u306A\u3057\uFF08DS 0\uFF09'; return; }\r\n  const accesses = data.rows[selected - 1]?.accesses || [];\r\n  for (let i = page * 32; i < Math.min(values.length, (page + 1) * 32); i++) {\r\n    const target = accesses.filter(a => a.address === v.address + i);\r\n    const watched = watches.some(w => w.index === Number(byId('variable').value) && w.offset === i);\r\n    const button = document.createElement('button');\r\n    button.type = 'button'; button.className = 'value-cell' + (target.some(a => a.kind === 'write') ? ' write' : target.length ? ' read' : '');\r\n    button.setAttribute('aria-pressed', String(watched));\r\n    button.title = hexAddress(v.address + i) + (watched ? ' \xB7 \u8868\u793A\u4E2D' : ' \xB7 \u30AF\u30EA\u30C3\u30AF\u3067\u8868\u306B\u8FFD\u52A0');\r\n    const label = document.createElement('small'), value = document.createElement('strong');\r\n    label.textContent = v.size === 1 ? v.name : v.name + '[' + i + ']';\r\n    value.textContent = format(values[i]); button.append(label, value);\r\n    button.addEventListener('click', () => addWatch(Number(byId('variable').value), i));\r\n    container.append(button);\r\n  }\r\n}\r\n\r\nfunction selectStep(step) {\r\n  selected = step;\r\n  refreshDetail();\r\n  traceRows[step]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });\r\n}\r\nfunction move(direction) {\r\n  selectStep(visibleSteps[Math.max(0, Math.min(visibleSteps.length - 1, visibleSteps.indexOf(selected) + direction))] || 0);\r\n}\r\nfunction moveChange(direction) {\r\n  const steps = watchSteps(histories, 'write').filter(step => step !== 0 && (direction > 0 ? step > selected : step < selected));\r\n  const target = direction > 0 ? steps[0] : steps.at(-1);\r\n  if (target !== undefined) selectStep(target);\r\n}\r\ntraceRows.forEach(row => row.addEventListener('click', event => {\r\n  if (event.target.closest('summary,details')) return;\r\n  selectStep(Number(row.dataset.step));\r\n}));\r\nbyId('previous').addEventListener('click', () => move(-1));\r\nbyId('next').addEventListener('click', () => move(1));\r\nbyId('previous-change').addEventListener('click', () => moveChange(-1));\r\nbyId('next-change').addEventListener('click', () => moveChange(1));\r\nbyId('trace-region').addEventListener('keydown', event => {\r\n  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }\r\n});\r\nbyId('variable').addEventListener('change', () => { byId('detail-variable').value = byId('variable').value; byId('offset').value = '0'; page = 0; refreshOptions(); refreshArray(); });\r\nbyId('detail-variable').addEventListener('change', () => { byId('variable').value = byId('detail-variable').value; byId('offset').value = '0'; page = 0; refreshOptions(); refreshArray(); });\r\nbyId('offset').addEventListener('change', refreshOptions);\r\nbyId('add-watch').addEventListener('click', () => { refreshOptions(); addWatch(Number(byId('variable').value), Number(byId('offset').value)); });\r\nbyId('filter').addEventListener('change', refreshFilter);\r\nbyId('page-prev').addEventListener('click', () => { page--; refreshArray(); });\r\nbyId('page-next').addEventListener('click', () => { page++; refreshArray(); });\r\nfunction refreshDisplay() {\r\n  document.body.classList.toggle('hide-registers', !byId('registers').checked);\r\n  document.body.classList.toggle('hide-machine', !byId('machine').checked);\r\n  persist();\r\n}\r\nbyId('registers').addEventListener('change', refreshDisplay);\r\nbyId('machine').addEventListener('change', refreshDisplay);\r\nbyId('base').addEventListener('change', () => {\r\n  document.querySelectorAll('[data-word]').forEach(element => { element.textContent = format(Number(element.dataset.word)); });\r\n  refreshColumns();\r\n});\r\nif (!data.variables.length) {\r\n  byId('watch-controls').hidden = true; byId('array-detail').hidden = true;\r\n}\r\ndocument.querySelectorAll('[data-word]').forEach(element => { element.textContent = format(Number(element.dataset.word)); });\r\nrefreshDisplay(); refreshColumns();\r\n",
      createNonce: () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join("")
    };
  }
});

// src/render.js
var require_render = __commonJS({
  "src/render.js"(exports2, module2) {
    "use strict";
    var { createNonce, client } = require_render_platform();
    var escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    var hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
    function renderTrace2(result, name) {
      const nonce = createNonce();
      const payload = JSON.stringify({ variables: result.variables, rows: result.rows.map(({ step, source, accesses }) => ({ step, source, accesses })) }).replace(/</g, "\\u003c");
      const used = new Set(result.rows.flatMap((row) => [...row.reads, ...row.writes]));
      const registers = Array.from({ length: 8 }, (_, i) => i).filter((i) => used.has(i));
      const number = (n) => `<span data-word="${n}">${n >= 32768 ? n - 65536 : n}</span>`;
      const cell = (value, written, read, isFlag = false, extra = "") => {
        const kind = written ? "write" : read ? "read" : "";
        const title = written && read ? "\u66F4\u65B0\u30FB\u53C2\u7167" : written ? "\u66F4\u65B0" : read ? "\u53C2\u7167" : "\u4FDD\u6301";
        return `<td class="${kind} ${extra}" title="${title}">${isFlag ? value : number(value)}</td>`;
      };
      const stateCells = (row) => registers.map((i) => cell(row.gr[i], row.writes?.includes(i), row.reads?.includes(i), false, "register")).join("") + ["OF", "SF", "ZF"].map((f) => cell(row.flags[f], row.flagWrites?.includes(f), row.flagReads?.includes(f), true, "machine")).join("") + `<td class="machine">${hex(row.sp)}</td>`;
      const memoryName = (at) => {
        const v = result.variables.find((v2) => at >= v2.address && at < v2.address + v2.size);
        return v ? escape(v.name + (v.size > 1 ? "[" + (at - v.address) + "]" : "")) : hex(at);
      };
      const accessList = (accesses) => {
        const items = accesses.map((a) => a.kind === "write" ? `<span class="write" title="${hex(a.address)} \u66F8\u8FBC\u307F">${memoryName(a.address)}: ${number(a.before)} \u2192 ${number(a.value)}</span>` : `<span class="read" title="${hex(a.address)} \u8AAD\u51FA\u3057">${memoryName(a.address)}: ${number(a.value)}</span>`);
        return items.slice(0, 2).join("<br>") + (items.length > 2 ? `<details><summary>\u307B\u304B${items.length - 2}\u4EF6</summary>${items.slice(2).join("<br>")}</details>` : "");
      };
      const rows = result.rows.map((row) => `<tr data-step="${row.step}"><td class="step"><button aria-label="\u30B9\u30C6\u30C3\u30D7${row.step}\u3092\u8868\u793A">${row.step}</button></td><td class="machine">${hex(row.pr)}</td><td>${row.line}</td><td class="source" title="${escape(row.source.trim())}">${escape(row.source.trim())}</td><td class="watch-anchor"></td>${stateCells(row)}<td class="memory machine">${accessList(row.accesses)}</td></tr>`).join("");
      const status = result.status === "completed" ? "\u6B63\u5E38\u7D42\u4E86" : result.message;
      return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>CASL II \u5B9F\u884C\u5C65\u6B74</title><style nonce="${nonce}">
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
<header class="toolbar"><span class="file" title="${escape(name)}">${escape(name)}</span><span class="status ${result.status}" role="status">${escape(status)} \xB7 ${result.rows.length}\u547D\u4EE4</span>
<button id="refresh" title="\u5143\u306E\u30D5\u30A1\u30A4\u30EB\u306E\u6700\u65B0\u5185\u5BB9\u3067\u518D\u5B9F\u884C">\u66F4\u65B0</button><span id="refresh-status" role="status"></span>
<select id="base" aria-label="\u5024\u306E\u8868\u793A\u5F62\u5F0F"><option value="signed" selected>10\u9032\u6570</option><option value="hex">16\u9032\u6570</option><option value="binary">2\u9032\u6570</option></select>
<span class="legend write" title="\u66F4\u65B0\u30FB\u53C2\u7167\u306E\u4E21\u65B9\u306E\u5834\u5408\u3082\u3053\u306E\u8868\u793A">\u66F8\u8FBC</span><span class="legend read">\u53C2\u7167</span></header>
<section class="watchbar" aria-label="\u8868\u793A\u3059\u308B\u5909\u6570"><div id="watch-list"></div><span id="watch-count"></span>
<details id="watch-controls"><summary>\u5909\u6570\u30FB\u914D\u5217\u3092\u8FFD\u52A0</summary><div class="toolbar"><label>\u5909\u6570 <select id="variable">${result.variables.map((v, i) => `<option value="${i}">${escape(v.name)}${v.size > 1 ? " [" + v.size + "\u8A9E]" : ""}</option>`).join("")}</select></label><label>\u6DFB\u5B57 <input id="offset" type="number" min="0" value="0" step="1"></label><button id="add-watch">\u5217\u306B\u8FFD\u52A0</button></div></details><span id="empty-watch" hidden>\u300C\u5909\u6570\u30FB\u914D\u5217\u3092\u8FFD\u52A0\u300D\u304B\u3089\u9078\u629E</span></section>
<nav class="toolbar" aria-label="\u5C65\u6B74\u306E\u64CD\u4F5C"><label>\u8868\u793A <select id="filter"><option value="all">\u3059\u3079\u3066\u306E\u547D\u4EE4</option><option value="write">\u5909\u6570\u3092\u66F4\u65B0\u3057\u305F\u547D\u4EE4</option><option value="access">\u5909\u6570\u3092\u53C2\u7167\u30FB\u66F4\u65B0\u3057\u305F\u547D\u4EE4</option></select></label><button id="previous" aria-label="\u524D\u306E\u30B9\u30C6\u30C3\u30D7">\u2190</button><button id="next" aria-label="\u6B21\u306E\u30B9\u30C6\u30C3\u30D7">\u2192</button><button id="previous-change">\u524D\u306E\u66F4\u65B0</button><button id="next-change">\u6B21\u306E\u66F4\u65B0</button><span id="row-count"></span><label><input id="registers" type="checkbox" checked>GR</label><label><input id="machine" type="checkbox">PR\u30FBFR\u30FBSP\u30FB\u30E1\u30E2\u30EA\u30FC</label></nav>
<main class="workspace">
<div id="trace-region" class="table-wrap trace" tabindex="0" role="region" aria-label="\u5B9F\u884C\u5C65\u6B74"><table aria-label="\u547D\u4EE4\u3054\u3068\u306E\u5B9F\u884C\u5C65\u6B74">
<thead><tr><th class="step" scope="col">#</th><th class="machine" scope="col" title="\u5B9F\u884C\u3057\u305F\u547D\u4EE4\u306E\u30A2\u30C9\u30EC\u30B9\uFF0816\u9032\u6570\uFF09">PR</th><th scope="col">\u884C</th><th class="source" scope="col">\u547D\u4EE4</th><th id="watch-anchor" class="watch-anchor"></th>${registers.map((i) => `<th class="register" scope="col" title="\u5B9F\u884C\u5F8C\u306E\u5024">GR${i}</th>`).join("")}<th class="machine" scope="col">OF</th><th class="machine" scope="col">SF</th><th class="machine" scope="col">ZF</th><th class="machine" scope="col" title="\u5B9F\u884C\u5F8C\u306E\u5024\uFF0816\u9032\u6570\uFF09">SP</th><th class="machine" scope="col">\u30E1\u30E2\u30EA\u30FC</th></tr></thead>
<tbody><tr data-step="0"><td class="step"><button aria-label="\u521D\u671F\u72B6\u614B\u3092\u8868\u793A">0</button></td><td class="machine">\u2014</td><td>\u2014</td><td class="source">\u521D\u671F\u72B6\u614B</td><td class="watch-anchor"></td>${stateCells(result.initial)}<td class="machine"></td></tr>${rows}</tbody></table></div>
<footer id="inspector" aria-label="\u9078\u629E\u3057\u305F\u6642\u70B9\u306E\u5909\u6570"><div class="toolbar"><span id="position" aria-live="polite"></span><code id="selected-source"></code><div id="changes"></div></div>
<details id="array-detail"><summary>\u914D\u5217\u30FB\u5909\u6570\u306E\u8A73\u7D30</summary><label>\u5909\u6570 <select id="detail-variable">${result.variables.map((v, i) => `<option value="${i}">${escape(v.name)}</option>`).join("")}</select></label><div id="variable-address"></div><div id="variable-values"></div><div class="pager"><button id="page-prev" aria-label="\u914D\u5217\u306E\u524D\u30DA\u30FC\u30B8">\u2190</button><span id="page-label"></span><button id="page-next" aria-label="\u914D\u5217\u306E\u6B21\u30DA\u30FC\u30B8">\u2192</button></div></details></footer></main>
<script id="trace-data" type="application/json" nonce="${nonce}">${payload}<\/script>
<script nonce="${nonce}">${client}<\/script></body></html>`;
    }
    module2.exports = { renderTrace: renderTrace2 };
  }
});

// src/formatter.js
var require_formatter = __commonJS({
  "src/formatter.js"(exports2, module2) {
    "use strict";
    var operations = new Set("START END DS DC LD ST LAD ADDA ADDL SUBA SUBL AND OR XOR CPA CPL SLA SRA SLL SRL JMI JNZ JZE JUMP JPL JOV PUSH POP CALL RET SVC NOP IN OUT RPUSH RPOP".split(" "));
    function parseLine(original) {
      let quoted = false, commentAt = original.length;
      for (let i = 0; i < original.length; i++) {
        if (original[i] === "'") {
          if (quoted && original[i + 1] === "'") {
            i++;
            continue;
          }
          quoted = !quoted;
        } else if (original[i] === ";" && !quoted) {
          commentAt = i;
          break;
        }
      }
      if (quoted) return null;
      const code = original.slice(0, commentAt).trim();
      if (!code) return null;
      const match = code.match(/^(\S+)(?:\s+(\S+))?(?:\s+(.*))?$/);
      if (!match) return null;
      const [, first, second, rest] = match;
      let label = "", op, operands;
      if (!/^\s/.test(original) && /^[A-Z][A-Z0-9]{0,7}$/i.test(first) && operations.has(second?.toUpperCase())) {
        label = first;
        op = second;
        operands = rest || "";
      } else if (operations.has(first.toUpperCase())) {
        op = first;
        operands = code.slice(first.length).trim();
      } else return null;
      return { label, op, operands, comment: original.slice(commentAt) };
    }
    function width(text) {
      let size = 0;
      for (const char of text) {
        const n = char.codePointAt(0);
        if (char === "	") size += 4 - size % 4;
        else if (/\p{Mark}/u.test(char)) continue;
        else size += n >= 4352 && (n <= 4447 || n === 9001 || n === 9002 || n >= 11904 && n <= 42191 || n >= 44032 && n <= 55203 || n >= 63744 && n <= 64255 || n >= 65040 && n <= 65135 || n >= 65281 && n <= 65376 || n >= 65504 && n <= 65510 || n >= 127744) ? 2 : 1;
      }
      return size;
    }
    function formatSource2(source) {
      const originals = source.split(/\r?\n/), lines = originals.map(parseLine);
      const valid = lines.filter(Boolean);
      const opcodeColumn = valid.reduce((column, line) => Math.max(column, width(line.label) + 1), 8);
      const operandColumn = valid.reduce((column, line) => Math.max(column, opcodeColumn + width(line.op) + 1), 16);
      const padTo = (text, column) => text + " ".repeat(Math.max(1, column - width(text)));
      const code = lines.map((line) => {
        if (!line) return null;
        let text = line.label.padEnd(opcodeColumn) + line.op;
        if (line.operands) text = padTo(text, operandColumn) + line.operands;
        return text;
      });
      const commentColumn = code.reduce((column, text, i) => lines[i]?.comment ? Math.max(column, width(text) + 1) : column, 40);
      return lines.map((line, i) => line ? code[i] + (line.comment ? " ".repeat(Math.max(1, commentColumn - width(code[i]))) + line.comment : "") : originals[i]).join("\r\n");
    }
    module2.exports = { formatSource: formatSource2 };
  }
});

// src/extension.js
var vscode = require("vscode");
var { assemble, executeWithInput, encodeInput, CaslError } = require_core();
var { renderTrace } = require_render();
var { formatSource } = require_formatter();
function readInput(request, token) {
  return new Promise((resolve) => {
    if (token?.isCancellationRequested) {
      resolve(void 0);
      return;
    }
    const box = vscode.window.createInputBox();
    const eof = { iconPath: new vscode.ThemeIcon("debug-stop"), tooltip: "EOF\uFF08\u5165\u529B\u7D42\u4E86\uFF09" };
    box.title = `IN ${request.buffer},${request.length}\uFF08${request.line}\u884C\uFF09`;
    box.prompt = "\u6587\u5B57\u5217\u3092\u5165\u529B \xB7 \u6700\u5927256\u6587\u5B57 \xB7 Esc\u3067\u4E2D\u6B62";
    box.ignoreFocusOut = true;
    box.buttons = [eof];
    let finished = false;
    const subscriptions = [];
    const finish = (value) => {
      if (finished) return;
      finished = true;
      subscriptions.forEach((item) => item.dispose());
      box.dispose();
      resolve(value);
    };
    subscriptions.push(
      box.onDidAccept(() => {
        try {
          encodeInput(box.value);
          finish(box.value);
        } catch (error) {
          box.validationMessage = error.message;
        }
      }),
      box.onDidChangeValue(() => {
        box.validationMessage = void 0;
      }),
      box.onDidTriggerButton((button) => {
        if (button === eof) finish(null);
      }),
      box.onDidHide(() => finish(void 0))
    );
    box.show();
    if (token) subscriptions.push(token.onCancellationRequested(() => finish(void 0)));
  });
}
function activate(context) {
  const formatEdits = (document) => {
    const source = document.getText(), formatted = formatSource(source);
    return source === formatted ? [] : [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(source.length)), formatted)];
  };
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider("casl2", {
    provideDocumentFormattingEdits: formatEdits
  }));
  context.subscriptions.push(vscode.commands.registerCommand("casl2.alignColumns", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "casl2") return;
    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.document.uri, formatEdits(editor.document));
    await vscode.workspace.applyEdit(edit);
  }));
  const diagnostics = vscode.languages.createDiagnosticCollection("casl2");
  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidChangeTextDocument((event) => diagnostics.delete(event.document.uri)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri))
  );
  let running = false;
  async function run(uri, state) {
    const post = (message) => {
      if (state.panel && !state.disposed) void state.panel.webview.postMessage(message);
    };
    if (running) {
      post({ type: "refreshError", message: "\u5225\u306E\u5B9F\u884C\u304C\u5B8C\u4E86\u3057\u3066\u304B\u3089\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
      return;
    }
    running = true;
    state.cancellation = new vscode.CancellationTokenSource();
    let document, version;
    try {
      document = await vscode.workspace.openTextDocument(uri);
      if (state.disposed) return;
      version = document.version;
      diagnostics.delete(uri);
      const result = await executeWithInput(assemble(document.getText()), (request) => readInput(request, state.cancellation.token));
      if (state.disposed) return;
      if (!state.panel) {
        const panel = vscode.window.createWebviewPanel("casl2.trace", "CASL II \u5B9F\u884C\u5C65\u6B74", vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
        state.panel = panel;
        const listener = panel.webview.onDidReceiveMessage((message) => {
          if (message?.type === "refresh") return run(uri, state);
        });
        panel.onDidDispose(() => {
          state.disposed = true;
          state.cancellation?.cancel();
          listener.dispose();
        });
        context.subscriptions.push(panel);
      }
      state.panel.webview.html = renderTrace(result, vscode.workspace.asRelativePath(uri));
    } catch (error) {
      if (state.disposed) return;
      if (error instanceof CaslError && document?.version === version && !document.isClosed) {
        const line = Math.max(0, Math.min(document.lineCount - 1, error.line - 1));
        diagnostics.set(document.uri, [new vscode.Diagnostic(document.lineAt(line).range, error.message, vscode.DiagnosticSeverity.Error)]);
      }
      post({ type: "refreshError", message: "\u66F4\u65B0\u5931\u6557\uFF08\u524D\u56DE\u306E\u7D50\u679C\u3092\u8868\u793A\u4E2D\uFF09: " + (error.message || String(error)) });
      vscode.window.showErrorMessage(error.message || String(error));
    } finally {
      state.cancellation.dispose();
      state.cancellation = void 0;
      running = false;
      post({ type: "refreshComplete" });
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand("casl2.runTrace", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "casl2") {
      vscode.window.showInformationMessage(".cas\u30D5\u30A1\u30A4\u30EB\u3092\u958B\u3044\u3066\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    await run(editor.document.uri, { panel: void 0, disposed: false });
  }));
}
module.exports = { activate };
