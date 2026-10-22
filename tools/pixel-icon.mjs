// Turns ASCII pixel art into an SVG path for the popup's pixel icons.
// '#' = filled pixel, anything else = empty. One subpath per horizontal run.
// Usage: node tools/pixel-icon.mjs path/to/icon.txt
// Paste the printed <svg> into popup.html. Keep icons on a 12x12 grid
// (the logo is the exception: it is vector, see DESIGN.md).
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/pixel-icon.mjs icon.txt');
  process.exit(1);
}
const rows = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n').filter(r => r.length);
const parts = [];
rows.forEach((row, y) => {
  for (let x = 0; x < row.length;) {
    if (row[x] !== '#') { x++; continue; }
    const start = x;
    while (x < row.length && row[x] === '#') x++;
    const w = x - start;
    parts.push(`M${start} ${y}h${w}v1h-${w}z`);
  }
});
const size = Math.max(rows.length, ...rows.map(r => r.length));
console.log(`<svg class="px" viewBox="0 0 ${size} ${size}" aria-hidden="true"><path d="${parts.join('')}"/></svg>`);
