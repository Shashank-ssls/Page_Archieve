// Builds the two store editions from this source folder.
//   Full: everything, including the debugger-based Full render engine.
//   Lite: no debugger permission (no install warning, no debugging bar);
//         scroll-and-stitch only, engine setting hidden in the popup.
// Usage: node tools/build-editions.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist'));
const RUNTIME = ['manifest.json', 'background.js', 'cdp.js', 'content.js', 'geometry.js', 'protocol.js', 'url-policy.js',
  'popup.html', 'popup.css', 'popup.js', 'stitcher.html', 'stitcher.js', 'pdf.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'icons', 'fonts'];

function copyRuntime(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const item of RUNTIME) fs.cpSync(path.join(root, item), path.join(dest, item), { recursive: true });
}

// Build stamp: local build time plus git commit ("*" = uncommitted changes).
// Shown on chrome://extensions (version_name) and in the popup footer, so a
// tester can confirm the loaded extension is the latest build after a reload.
export function buildStamp(now = new Date(), commit = gitCommit()) {
  const p = n => String(n).padStart(2, '0');
  const time = `${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return commit ? `${time} ${commit}` : time;
}
function gitCommit() {
  try {
    const opts = { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] };
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], opts).toString().trim() !== '';
    return hash + (dirty ? '*' : '');
  } catch (_) { return ''; }
}

const base = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const stamp = buildStamp();
base.version_name = `${base.version} build ${stamp}`;

const fullDir = path.join(out, 'full');
copyRuntime(fullDir);
fs.writeFileSync(path.join(fullDir, 'manifest.json'), JSON.stringify(base, null, 2));

const liteDir = path.join(out, 'lite');
copyRuntime(liteDir);
const lite = structuredClone(base);
lite.name = 'Page Archive Lite';
lite.permissions = lite.permissions.filter(p => p !== 'debugger');
lite.description = 'Capture whole webpages and AI chat conversations as PNG, JPEG or PDF. No debugger permission. Local processing only.';
fs.writeFileSync(path.join(liteDir, 'manifest.json'), JSON.stringify(lite, null, 2));
fs.rmSync(path.join(liteDir, 'cdp.js'));
// The worker imports cdp.js; Lite ships a stub that reports the API as unavailable.
fs.writeFileSync(path.join(liteDir, 'cdp.js'), "/* Lite edition: no debugger engine. */\n(function (root) { 'use strict'; class Session { static available() { return false; } } root.PageArchiveCdp = { Session }; })(globalThis);\n");

console.log(`Built (build ${stamp}):\n  ${fullDir}\n  ${liteDir}`);
