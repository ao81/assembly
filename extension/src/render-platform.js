'use strict';
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const client = ['trace-model.js', 'trace-view.js'].map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
module.exports = { client, createNonce: () => randomBytes(16).toString('hex') };
