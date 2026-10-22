// Project-local Playwright browsers.
// Every script that uses Playwright imports this FIRST, so browsers are always
// read from and installed into <repo>/.local/ms-playwright (gitignored), never
// the per-user default (%LOCALAPPDATA%\ms-playwright on C: under Windows).
// No global environment variable is needed or changed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BROWSERS_DIR = path.join(REPO, '.local', 'ms-playwright');

process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
