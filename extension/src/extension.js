'use strict';

const vscode = require('vscode');
const { assemble, executeWithInput, encodeInput, CaslError } = require('./core');
const { renderTrace } = require('./render');
const { formatSource } = require('./formatter');

function readInput(request, token) {
  return new Promise(resolve => {
    if (token?.isCancellationRequested) { resolve(undefined); return; }
    const box = vscode.window.createInputBox();
    const eof = { iconPath: new vscode.ThemeIcon('debug-stop'), tooltip: 'EOF（入力終了）' };
    box.title = `IN ${request.buffer},${request.length}（${request.line}行）`;
    box.prompt = '文字列を入力 · 最大256文字 · Escで中止';
    box.ignoreFocusOut = true;
    box.buttons = [eof];
    let finished = false;
    const subscriptions = [];
    const finish = value => {
      if (finished) return;
      finished = true;
      subscriptions.forEach(item => item.dispose());
      box.dispose(); resolve(value);
    };
    subscriptions.push(box.onDidAccept(() => {
      try { encodeInput(box.value); finish(box.value); }
      catch (error) { box.validationMessage = error.message; }
    }), box.onDidChangeValue(() => { box.validationMessage = undefined; }),
    box.onDidTriggerButton(button => { if (button === eof) finish(null); }),
    box.onDidHide(() => finish(undefined)));
    box.show();
    if (token) subscriptions.push(token.onCancellationRequested(() => finish(undefined)));
  });
}

function activate(context) {
  const formatEdits = document => {
    const source = document.getText(), formatted = formatSource(source);
    return source === formatted ? [] : [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(source.length)), formatted)];
  };
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('casl2', {
    provideDocumentFormattingEdits: formatEdits,
  }));
  context.subscriptions.push(vscode.commands.registerCommand('casl2.alignColumns', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'casl2') return;
    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.document.uri, formatEdits(editor.document));
    await vscode.workspace.applyEdit(edit);
  }));
  const diagnostics = vscode.languages.createDiagnosticCollection('casl2');
  context.subscriptions.push(diagnostics, vscode.workspace.onDidChangeTextDocument(event => diagnostics.delete(event.document.uri)),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)));
  let running = false;
  async function run(uri, state) {
    const post = message => { if (state.panel && !state.disposed) void state.panel.webview.postMessage(message); };
    if (running) {
      post({ type: 'refreshError', message: '別の実行が完了してから更新してください。' });
      return;
    }
    running = true;
    state.cancellation = new vscode.CancellationTokenSource();
    let document, version;
    try {
      // Reopen the bound URI, never the currently active editor. Open dirty documents are reused.
      document = await vscode.workspace.openTextDocument(uri);
      if (state.disposed) return;
      version = document.version;
      diagnostics.delete(uri);
      const result = await executeWithInput(assemble(document.getText()), request => readInput(request, state.cancellation.token));
      if (state.disposed) return;
      if (!state.panel) {
        const panel = vscode.window.createWebviewPanel('casl2.trace', 'CASL II 実行履歴', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
        state.panel = panel;
        const listener = panel.webview.onDidReceiveMessage(message => {
          if (message?.type === 'refresh') return run(uri, state);
        });
        panel.onDidDispose(() => { state.disposed = true; state.cancellation?.cancel(); listener.dispose(); });
        context.subscriptions.push(panel);
      }
      state.panel.webview.html = renderTrace(result, vscode.workspace.asRelativePath(uri));
    } catch (error) {
      if (state.disposed) return;
      if (error instanceof CaslError && document?.version === version && !document.isClosed) {
        const line = Math.max(0, Math.min(document.lineCount - 1, error.line - 1));
        diagnostics.set(document.uri, [new vscode.Diagnostic(document.lineAt(line).range, error.message, vscode.DiagnosticSeverity.Error)]);
      }
      post({ type: 'refreshError', message: '更新失敗（前回の結果を表示中）: ' + (error.message || String(error)) });
      vscode.window.showErrorMessage(error.message || String(error));
    } finally {
      state.cancellation.dispose();
      state.cancellation = undefined;
      running = false;
      post({ type: 'refreshComplete' });
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand('casl2.runTrace', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'casl2') {
      vscode.window.showInformationMessage('.casファイルを開いて実行してください。'); return;
    }
    await run(editor.document.uri, { panel: undefined, disposed: false });
  }));
}
module.exports = { activate };
