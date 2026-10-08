'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assemble, execute } = require('../src/core');
const { renderTrace } = require('../src/render');
const source = fs.readFileSync(path.join(__dirname, '../examples/variables.cas'), 'utf8');
const html = renderTrace(execute(assemble(source)), 'variables.cas').replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(__dirname, '../preview.html'), html, 'utf8');
console.log('extension/preview.html を生成しました。');
