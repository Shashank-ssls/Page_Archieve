// Fails if any source/config file contains non-ASCII characters.
// Owner rule: all source files are pure ASCII (no emoji, smart quotes, em dashes).
// Exempt: user-facing strings may need Unicode; mark such a line with the
// comment "ascii-exempt" and keep the exemption small. Fonts/images are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.e2e', 'fonts', 'icons', 'archive-v1']);
const CHECK_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md']);
const problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name)); continue; }
    const file = path.join(dir, entry.name);
    if (!CHECK_EXT.has(path.extname(file))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/[^\x00-\x7F]/.test(line) && !line.includes('ascii-exempt')) problems.push(`${path.relative(root, file)}:${i + 1}`);
    });
  }
}
walk(root);
if (problems.length) {
  console.error(`Non-ASCII characters found in ${problems.length} line(s):`);
  for (const p of problems.slice(0, 50)) console.error('  ' + p);
  if (problems.length > 50) console.error('  ...');
  process.exit(1);
}
console.log('ASCII check passed.');
