'use strict';
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/extension.js'],
  outfile: 'dist/web/extension.js',
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022',
  external: ['vscode'],
  plugins: [{
    name: 'web-render-platform',
    setup(build) {
      build.onLoad({ filter: /[/\\]render-platform\.js$/ }, () => {
        const client = ['trace-model.js', 'trace-view.js'].map(name => fs.readFileSync(path.join(root, 'src', name), 'utf8')).join('\n');
        return { contents: `module.exports = {
          client: ${JSON.stringify(client)},
          createNonce: () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
        };`, loader: 'js' };
      });
    }
  }]
}).catch(error => { console.error(error); process.exitCode = 1; });
