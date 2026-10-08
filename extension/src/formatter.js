'use strict';

const operations = new Set(('START END DS DC LD ST LAD ADDA ADDL SUBA SUBL AND OR XOR CPA CPL SLA SRA SLL SRL JMI JNZ JZE JUMP JPL JOV PUSH POP CALL RET SVC NOP IN OUT RPUSH RPOP').split(' '));

// Only whitespace between fields is changed; quoted text and comments stay intact.
function parseLine(original) {
  let quoted = false, commentAt = original.length;
  for (let i = 0; i < original.length; i++) {
    if (original[i] === "'") {
      if (quoted && original[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    } else if (original[i] === ';' && !quoted) { commentAt = i; break; }
  }
  if (quoted) return null;
  const code = original.slice(0, commentAt).trim();
  if (!code) return null;
  const match = code.match(/^(\S+)(?:\s+(\S+))?(?:\s+(.*))?$/);
  if (!match) return null;
  const [, first, second, rest] = match;
  let label = '', op, operands;
  if (!/^\s/.test(original) && /^[A-Z][A-Z0-9]{0,7}$/i.test(first) && operations.has(second?.toUpperCase())) {
    label = first; op = second; operands = rest || '';
  } else if (operations.has(first.toUpperCase())) {
    op = first; operands = code.slice(first.length).trim();
  } else return null;
  return { label, op, operands, comment: original.slice(commentAt) };
}

function width(text) {
  let size = 0;
  for (const char of text) {
    const n = char.codePointAt(0);
    if (char === '\t') size += 4 - size % 4;
    else if (/\p{Mark}/u.test(char)) continue;
    else size += n >= 0x1100 && (n <= 0x115f || n === 0x2329 || n === 0x232a ||
      (n >= 0x2e80 && n <= 0xa4cf) || (n >= 0xac00 && n <= 0xd7a3) ||
      (n >= 0xf900 && n <= 0xfaff) || (n >= 0xfe10 && n <= 0xfe6f) ||
      (n >= 0xff01 && n <= 0xff60) || (n >= 0xffe0 && n <= 0xffe6) || n >= 0x1f300) ? 2 : 1;
  }
  return size;
}

function formatSource(source) {
  const originals = source.split(/\r?\n/), lines = originals.map(parseLine);
  const valid = lines.filter(Boolean);
  const opcodeColumn = valid.reduce((column, line) => Math.max(column, width(line.label) + 1), 8);
  const operandColumn = valid.reduce((column, line) => Math.max(column, opcodeColumn + width(line.op) + 1), 16);
  const padTo = (text, column) => text + ' '.repeat(Math.max(1, column - width(text)));
  const code = lines.map(line => {
    if (!line) return null;
    let text = line.label.padEnd(opcodeColumn) + line.op;
    if (line.operands) text = padTo(text, operandColumn) + line.operands;
    return text;
  });
  const commentColumn = code.reduce((column, text, i) => lines[i]?.comment ? Math.max(column, width(text) + 1) : column, 40);
  return lines.map((line, i) => line ? code[i] + (line.comment ? ' '.repeat(Math.max(1, commentColumn - width(code[i]))) + line.comment : '') : originals[i]).join('\r\n');
}

module.exports = { formatSource };
