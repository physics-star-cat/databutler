const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = (f) => path.join(__dirname, '..', 'public', f);
const read = (f) => fs.readFileSync(pub(f), 'utf8');

test('/privacy states the data practices plainly and is dated', () => {
  const html = read('privacy.html');
  for (const phrase of [
    /no accounts/i, /no cookies/i, /Measurement Protocol/, /event name/i, /User-Agent/, /client class/i,
    /no stored IP/i, /no logged request bodies/i, /rdap\.org/, /registry\.npmjs\.org/, /pypi\.org/, /gov\.uk/, /whatbreaks\.uk/,
    /github\.com\/physics-star-cat\/databutler\/issues/, /Last updated 2026-10-03/,
  ]) assert.match(html, phrase, String(phrase));
  assert.match(html, /<title>Privacy — Data Butler<\/title>/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico"/);
});

test('privacy page is linked from the index footer, llms.txt and the /api index', async () => {
  assert.match(read('index.html'), /<footer[^>]*>[\s\S]*href="\/privacy"/);
  assert.match(read('llms.txt'), /https:\/\/databutler\.dev\/privacy/);
  const { invoke } = require('./helpers');
  const r = await invoke(require('../api/index'), undefined, { method: 'GET', url: '/api' });
  assert.equal(r.body.privacy, 'https://databutler.dev/privacy');
});

test('icon.png is a 512×512 PNG and favicon.ico is a multi-size ICO', () => {
  const png = fs.readFileSync(pub('icon.png'));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.equal(png.readUInt32BE(16), 512, 'width');
  assert.equal(png.readUInt32BE(20), 512, 'height');
  const ico = fs.readFileSync(pub('favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
  assert.ok(ico.readUInt16LE(4) >= 3, 'at least 16/32/48 sizes');
  assert.match(read('index.html'), /href="\/icon\.png"/);
});
