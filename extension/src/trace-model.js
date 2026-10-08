'use strict';

function variableHistory(result, index, offset = 0) {
  const variable = result.variables[index];
  if (!variable || offset < 0 || offset >= variable.size) return [];
  const address = variable.address + offset;
  let value = variable.initial[offset];
  return [{ step: 0, before: value, after: value, read: false, written: false }, ...result.rows.map(row => {
    const before = value;
    const accesses = row.accesses.filter(a => a.address === address);
    for (const access of accesses) if (access.kind === 'write') value = access.value;
    return { step: row.step, before, after: value, read: accesses.some(a => a.kind === 'read'), written: accesses.some(a => a.kind === 'write') };
  })];
}

function variableAt(result, index, step) {
  const variable = result.variables[index];
  if (!variable) return [];
  const values = [...variable.initial];
  for (const row of result.rows) {
    if (row.step > step) break;
    for (const access of row.accesses) {
      const offset = access.address - variable.address;
      if (access.kind === 'write' && offset >= 0 && offset < variable.size) values[offset] = access.value;
    }
  }
  return values;
}

function resolveWatches(variables, saved) {
  const candidates = Array.isArray(saved) ? saved : variables.filter(v => v.size > 0).slice(0, 8).map(v => ({ name: v.name, offset: 0 }));
  const result = [], keys = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.name !== 'string') continue;
    const index = variables.findIndex(v => v.name === candidate.name);
    const offset = candidate.offset;
    if (index < 0 || !Number.isInteger(offset) || offset < 0 || offset >= variables[index].size) continue;
    const key = candidate.name + ':' + offset;
    if (keys.has(key)) continue;
    keys.add(key); result.push({ name: candidate.name, offset, index });
    if (result.length === 12) break;
  }
  return result;
}

function watchSteps(histories, mode) {
  const count = histories[0]?.length || 0;
  return Array.from({ length: count }, (_, step) => step).filter(step => step === 0 || mode === 'all' || histories.some(history =>
    history[step].written || (mode === 'access' && history[step].read)));
}

if (typeof module !== 'undefined') module.exports = { variableHistory, variableAt, resolveWatches, watchSteps };
