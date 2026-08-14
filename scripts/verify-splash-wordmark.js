'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'splash-wordmark-smoke.html');
const browsers = [
  process.env.MINERADIO_TEST_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const browser = browsers.find(candidate => fs.existsSync(candidate));

assert(browser, 'Chrome or Edge is required for the splash wordmark verification');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'better-radio-splash-'));
const run = childProcess.spawnSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '--window-size=813,354',
  '--virtual-time-budget=1000',
  `--user-data-dir=${profile}`,
  '--dump-dom',
  pathToFileURL(fixture).href,
], {
  cwd: root,
  encoding: 'utf8',
  timeout: 15000,
  maxBuffer: 2 * 1024 * 1024,
  windowsHide: true,
});

try {
  assert.equal(run.status, 0, run.stderr || `browser exited with ${run.status}`);
  const match = String(run.stdout || '').match(
    /<pre id="splash-wordmark-result" data-done="true">([^<]+)<\/pre>/
  );
  assert(match, 'splash wordmark smoke did not finish');
  const snapshot = JSON.parse(match[1].replace(/&quot;/g, '"'));
  assert(snapshot.gap >= 4,
    `Better and Radio must not overlap (gap=${snapshot.gap.toFixed(2)}px): ${JSON.stringify(snapshot)}`);
  assert(snapshot.gap <= 20,
    `Better and Radio must remain a single wordmark (gap=${snapshot.gap.toFixed(2)}px)`);
  console.log(`Splash wordmark gap verified: ${snapshot.gap.toFixed(2)}px`);
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
