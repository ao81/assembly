'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble, execute } = require('../src/core');
const { variableAt, variableHistory, resolveWatches, watchSteps } = require('../src/trace-model');

test('変数の時系列を復元し、同値書込み・参照・保持を区別する', () => {
  const result = execute(assemble('TEST START\n LAD GR1,3\n ST GR1,A\n ST GR1,A\n LD GR2,A\n RET\nA DC 1\n END'));
  const history = variableHistory(result, 0);
  assert.deepEqual(history.map(h => h.after), [1, 1, 3, 3, 3, 3]);
  assert.equal(history[2].before, 1);
  assert.equal(history[3].written, true);
  assert.equal(history[4].read, true);
  assert.equal(history[5].written, false);
  assert.deepEqual(variableAt(result, 0, 3), [3]);
  assert.deepEqual(variableAt(result, 0, 0), [1]);
  assert.deepEqual(result.variables[0].initial, [1]);
});

test('複数の変数・配列要素を復元し、削除済みや範囲外の監視を除外する', () => {
  const variables = [{ name: 'A', size: 1 }, { name: 'BUF', size: 10 }, { name: 'EMPTY', size: 0 }];
  assert.deepEqual(resolveWatches(variables).map(w => w.name), ['A', 'BUF']);
  assert.deepEqual(resolveWatches(variables, [{ name: 'A', offset: 0 }, { name: 'A', offset: 0 }, { name: 'BUF', offset: 2 }, { name: 'BUF', offset: 10 }, { name: 'OLD', offset: 0 }, null]), [
    { name: 'A', offset: 0, index: 0 }, { name: 'BUF', offset: 2, index: 1 },
  ]);
  assert.deepEqual(resolveWatches(variables, []), []);
});

test('表示中の複数変数の更新・参照をまとめて絞り込む', () => {
  const result = execute(assemble('TEST START\n LD GR1,A\n ST GR1,B\n LAD GR1,3\n ST GR1,A\n RET\nA DC 1\nB DS 1\n END'));
  const histories = [variableHistory(result, 0), variableHistory(result, 1)];
  assert.deepEqual(watchSteps(histories, 'write'), [0, 2, 4]);
  assert.deepEqual(watchSteps(histories, 'access'), [0, 1, 2, 4]);
  assert.deepEqual(watchSteps(histories, 'all'), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(watchSteps([], 'write'), []);
});

test('INの配列要素を選んで初期状態から終了まで追跡する', () => {
  const result = execute(assemble('TEST START\n IN BUF,LEN\n IN BUF,LEN\n RET\nBUF DS 256\nLEN DS 1\n END'), 2000, ['AB', 'X']);
  assert.deepEqual(variableHistory(result, 0, 0).map(h => h.after), [0, 65, 88, 88]);
  assert.deepEqual(variableHistory(result, 0, 1).map(h => h.after), [0, 66, 66, 66]);
  assert.deepEqual(variableAt(result, 0, 1).slice(0, 3), [65, 66, 0]);
  assert.deepEqual(variableAt(result, 0, 2).slice(0, 3), [88, 66, 0]);
  assert.deepEqual(variableHistory(result, 0, 256), []);
  assert.deepEqual(variableAt(result, 99, 1), []);
});
