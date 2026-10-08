'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(web = false) {
  const commands = new Map(), panels = [], errors = [], disposable = () => ({ dispose() {} });
  const document = { uri: 'file:///original.cas', languageId: 'casl2', version: 1, lineCount: 4, isClosed: false,
    source: 'TEST START\n LAD GR1,3\n RET\n END', getText() { return this.source; }, lineAt() { return { range: {} }; } };
  const vscode = {
    languages: { registerDocumentFormattingEditProvider: disposable, createDiagnosticCollection: () => ({ ...disposable(), delete() {}, set() {} }) },
    commands: { registerCommand(name, handler) { commands.set(name, handler); return disposable(); } },
    workspace: { onDidChangeTextDocument: disposable, onDidCloseTextDocument: disposable,
      async openTextDocument(uri) { assert.equal(uri, document.uri); if (document.missing) throw new Error('File missing'); return document; }, asRelativePath: uri => uri },
    window: { activeTextEditor: { document }, showInformationMessage() {}, showErrorMessage(message) { errors.push(message); },
      createWebviewPanel() {
        const panel = { ...disposable(), messages: [], webview: { html: '', onDidReceiveMessage(handler) { panel.receive = handler; return disposable(); }, postMessage(message) { panel.messages.push(message); } }, onDidDispose(handler) { panel.close = handler; } };
        panels.push(panel); return panel;
      } },
    CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false }; } cancel() { this.token.isCancellationRequested = true; } dispose() {} },
    ViewColumn: { Beside: 2 }, Diagnostic: class {}, DiagnosticSeverity: { Error: 0 },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, web ? '../dist/web/extension.js' : '../src/extension.js'), 'utf8'), {
    module, exports: module.exports, crypto: require('node:crypto').webcrypto,
    require: name => {
      if (name === 'vscode') return vscode;
      assert.equal(web, false, 'Web bundle must not require Node.js or other modules');
      return require(path.join(__dirname, '../src', name));
    },
  });
  module.exports.activate({ subscriptions: [] });
  return { commands, panels, document, vscode, errors };
}

test('更新は元のURIの未保存内容を読み、同じパネルを置き換える', async () => {
  const app = setup();
  await app.commands.get('casl2.runTrace')();
  const panel = app.panels[0];
  assert.ok(panel.webview.html.includes('data-word="3"'));
  app.document.source = 'TEST START\n LAD GR1,-3\n RET\n END';
  app.document.version++;
  app.vscode.window.activeTextEditor = { document: { uri: 'file:///other.cas' } };
  await panel.receive({ type: 'refresh' });
  assert.equal(app.panels.length, 1);
  assert.ok(panel.webview.html.includes('data-word="65533">-3'));
  app.vscode.window.activeTextEditor = undefined;
  await panel.receive({ type: 'refresh' });
  assert.equal(app.errors.length, 0);
});

test('更新失敗では前回結果を保ち、エラーを示して再試行できる', async () => {
  const app = setup();
  await app.commands.get('casl2.runTrace')();
  const panel = app.panels[0], previous = panel.webview.html;
  app.document.source = 'TEST START\n BROKEN\n END';
  app.document.version++;
  await panel.receive({ type: 'refresh' });
  assert.equal(panel.webview.html, previous);
  assert.ok(panel.messages.some(m => m.type === 'refreshError' && m.message.includes('前回の結果')));
  app.document.source = 'TEST START\n RET\n END';
  await panel.receive({ type: 'refresh' });
  assert.notEqual(panel.webview.html, previous);
  app.document.missing = true;
  await panel.receive({ type: 'refresh' });
  assert.ok(panel.messages.some(m => m.type === 'refreshError' && m.message.includes('File missing')));
});

for (const web of [false, true]) {
  test(`デスクトップ/Webバンドルで実行・更新・整形とCSPが動作 (${web})`, async () => {
    const app = setup(web);
    await app.commands.get('casl2.runTrace')();
    assert.deepEqual(app.errors, []);
    const panel = app.panels[0];
    assert.match(panel.webview.html, /data-word="3"/);
    assert.match(panel.webview.html, /script-src 'nonce-[a-f0-9]{32}'/);
    assert.match(panel.webview.html, /function variableHistory/);
    const oldHtml = panel.webview.html;
    app.document.source = 'TEST START\n LAD GR1,5\n RET\n END';
    app.document.version++;
    await panel.receive({ type: 'refresh' });
    assert.match(panel.webview.html, /data-word="5"/);
    assert.notEqual(panel.webview.html, oldHtml);
    assert.equal(typeof app.commands.get('casl2.alignColumns'), 'function');
    assert.deepEqual(app.errors, []);
  });
}
