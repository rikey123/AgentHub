import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const output = resolve("dist", "main.cjs");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `'use strict';
const { appendFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');

function log(message) {
  try {
    appendFileSync(resolve(tmpdir(), 'agenthub-desktop-main.log'), new Date().toISOString() + ' bootstrap ' + message + '\\n', 'utf8');
  } catch {}
}

log('loading esm main');
import('./main.js').catch((error) => {
  log(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
`, "utf8");
