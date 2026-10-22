const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'tools', 'package.mjs')).href);

test('crc32 matches the standard check value', async () => {
  const { crc32 } = await load();
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('makeZip writes entries a reader can inflate back', async () => {
  const { makeZip } = await load();
  const files = [{ name: 'a.txt', data: Buffer.from('hello hello hello') }, { name: 'dir/b.js', data: Buffer.from('x = 1;\n') }];
  const zip = makeZip(files);
  // End of central directory: entry count and central directory offset.
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  let at = 0;
  for (const f of files) {
    assert.equal(zip.readUInt32LE(at), 0x04034b50);
    const packedLen = zip.readUInt32LE(at + 18);
    const nameLen = zip.readUInt16LE(at + 26);
    assert.equal(zip.toString('utf8', at + 30, at + 30 + nameLen), f.name);
    const data = zlib.inflateRawSync(zip.subarray(at + 30 + nameLen, at + 30 + nameLen + packedLen));
    assert.deepEqual(data, f.data);
    at += 30 + nameLen + packedLen;
  }
  assert.equal(zip.readUInt32LE(end + 16), at, 'central directory starts after the last entry');
});

test('store zips leave out the testing build stamp', async () => {
  const { packageEdition } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pac-pkg-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '2.3.0', version_name: '2.3.0 build 1022-1200 abc1234' }));
    const zip = packageEdition(dir);
    const nameLen = zip.readUInt16LE(26);
    const manifest = JSON.parse(zlib.inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + zip.readUInt32LE(18))).toString('utf8'));
    assert.equal(manifest.version, '2.3.0');
    assert.equal(manifest.version_name, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
