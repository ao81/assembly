'use strict';

const vscode = require('vscode');
const { assemble, executeWithInput, encodeInput, CaslError } = require('./core');
const { renderTrace } = require('./render');
const { formatSource } = require('./formatter');

function readInput(request) {
  return new Promise(resolve => {
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
  context.subscriptions.push(vscode.commands.registerCommand('casl2.runTrace', async () => {
    if (running) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'casl2') {
      vscode.window.showInformationMessage('.casファイルを開いて実行してください。'); return;
    }
    const document = editor.document;
    diagnostics.delete(document.uri);
    const version = document.version;
    running = true;
    try {
      const result = await executeWithInput(assemble(document.getText()), readInput);
      const panel = vscode.window.createWebviewPanel('casl2.trace', 'CASL II 実行履歴', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
      panel.webview.html = renderTrace(result, vscode.workspace.asRelativePath(document.uri));
      context.subscriptions.push(panel);
    } catch (error) {
      if (error instanceof CaslError && document.version === version && !document.isClosed) {
        const line = Math.max(0, Math.min(document.lineCount - 1, error.line - 1));
        diagnostics.set(document.uri, [new vscode.Diagnostic(document.lineAt(line).range, error.message, vscode.DiagnosticSeverity.Error)]);
      }
      vscode.window.showErrorMessage(error.message || String(error));
    } finally {
      running = false;
    }
  }));
}
module.exports = { activate };
