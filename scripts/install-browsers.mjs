// Installs Playwright's Chromium into <repo>/.local/ms-playwright, or reports
// that it is already there. Also reports (never deletes) any old per-user copy.
// Usage: npm run browsers
import { BROWSERS_DIR } from './pw-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const hasChromium = dir => fs.existsSync(dir) && fs.readdirSync(dir).some(name => /^chromium/i.test(name));

console.log(`Project browser folder: ${BROWSERS_DIR}`);
const userDefault = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')
  : path.join(os.homedir(), '.cache', 'ms-playwright');
if (hasChromium(userDefault)) {
  console.log(`Note: an older per-user Playwright browser exists at ${userDefault}.`);
  console.log('This project does not use it. Delete it yourself if you want the space back.');
}

if (hasChromium(BROWSERS_DIR)) {
  console.log('Chromium is already installed for this project. Nothing to do.');
  process.exit(0);
}

fs.mkdirSync(BROWSERS_DIR, { recursive: true });
let cli;
try {
  // cli.js is not an exported path, so find it next to package.json.
  cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('missing cli.js');
} catch (_) {
  console.error('Playwright is not installed in node_modules. Run "npm install" first.');
  process.exit(1);
}
console.log('Installing Chromium into the project folder...');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', env: process.env });
if (result.status !== 0) process.exit(result.status || 1);
if (!hasChromium(BROWSERS_DIR)) {
  console.error(`Install finished but no Chromium folder was found in ${BROWSERS_DIR}. Stop and check.`);
  process.exit(1);
}
console.log('Done. Chromium is installed inside the project.');
