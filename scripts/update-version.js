'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CRITICAL_SOURCE_FILES = [
  'assets/activity.svg',
  'media/dashboard.html',
  'media/main.js',
  'assets/Teloverge-lum-logo.svg',
  'media/pivot.js',
  'media/styles.css',
  'media/timeframe.js',
  'src/browserLauncher.js',
  'src/codexImporter.js',
  'src/dashboardServer.js',
  'src/extension.js',
  'src/pricing.js',
  'src/report.js',
  'src/storage.js'
];

function fingerprint(readFile) {
  const hash = crypto.createHash('sha256');
  CRITICAL_SOURCE_FILES.forEach((file) => {
    const contents = readFile(file);
    hash.update(file); hash.update('\0'); hash.update(contents); hash.update('\0');
  });
  return hash.digest('hex');
}

function workspaceFingerprint(root) {
  return fingerprint((file) => fs.readFileSync(path.join(root, file)));
}

function committedFingerprint(root) {
  try {
    const head = spawnSync('git.exe', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: null, windowsHide: true });
    if (head.status !== 0) return null;
    return fingerprint((file) => {
      const result = spawnSync('git.exe', ['show', `HEAD:${file}`], { cwd: root, encoding: null, windowsHide: true });
      return result.status === 0 ? result.stdout : Buffer.from('[not present in committed baseline]');
    });
  } catch {
    return null;
  }
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value || '');
  if (!match) throw new Error(`Expected a semantic version in major.minor.patch form, received "${value}".`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function bumpPatch(value) {
  const [major, minor, patch] = parseVersion(value);
  return `${major}.${minor}.${patch + 1}`;
}

function updateVersion(root = path.join(__dirname, '..'), log = console.log) {
  const packagePath = path.join(root, 'package.json');
  const statePath = path.join(root, '.version-source.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentHash = workspaceFingerprint(root);
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
  let changed = false;

  if (state && currentHash !== state.sourceHash) {
    if (compareVersions(packageJson.version, state.version) <= 0) {
      packageJson.version = bumpPatch(packageJson.version);
      changed = true;
    }
  } else if (!state) {
    const baselineHash = committedFingerprint(root);
    if (baselineHash && baselineHash !== currentHash) {
      packageJson.version = bumpPatch(packageJson.version);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(statePath, `${JSON.stringify({ version: packageJson.version, sourceHash: currentHash }, null, 2)}\n`);
  log(changed ? `Version bumped to ${packageJson.version} after critical source changes.` : `Version ${packageJson.version} already matches the critical sources.`);
  return { changed, version: packageJson.version, sourceHash: currentHash };
}

if (require.main === module) {
  try { updateVersion(); } catch (error) { console.error(`Version update failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { CRITICAL_SOURCE_FILES, bumpPatch, compareVersions, fingerprint, updateVersion };
