'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CRITICAL_SOURCE_FILES, bumpPatch, updateVersion } = require('../scripts/update-version');

function fixture(version = '1.2.3') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-version-'));
  CRITICAL_SOURCE_FILES.forEach((file) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `${file}\n`);
  });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
  updateVersion(root, () => {});
  return root;
}

test('increments semantic patch versions', () => assert.equal(bumpPatch('1.2.9'), '1.2.10'));

test('bumps once when a critical source changes', () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, 'media', 'main.js'), '// changed\n');
  assert.deepEqual(updateVersion(root, () => {}), { changed: true, version: '1.2.4', sourceHash: JSON.parse(fs.readFileSync(path.join(root, '.version-source.json'))).sourceHash });
  assert.equal(updateVersion(root, () => {}).changed, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.2.4');
});

test('respects a manual version increase while refreshing the fingerprint', () => {
  const root = fixture();
  const packagePath = path.join(root, 'package.json');
  fs.writeFileSync(packagePath, `${JSON.stringify({ name: 'fixture', version: '1.3.0' }, null, 2)}\n`);
  fs.appendFileSync(path.join(root, 'src', 'extension.js'), '// changed\n');
  const result = updateVersion(root, () => {});
  assert.equal(result.changed, false);
  assert.equal(result.version, '1.3.0');
});
