'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

assert.equal(pkg.name, 'mineradio-for-spotify');
assert.equal(pkg.productName, 'Mineradio for Spotify');
assert.equal(pkg.version, '1.1.2');
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);

assert.equal(pkg.build.appId, 'com.mineradio.desktop', 'legacy appId must remain stable');
assert.equal(pkg.build.win.executableName, 'Mineradio', 'legacy executable name must remain stable');
assert.equal(pkg.build.nsis.shortcutName, 'Mineradio for Spotify');
assert.equal(pkg.build.nsis.artifactName, 'Mineradio-for-Spotify-${version}-Setup.${ext}');
assert.ok(pkg.build.files.includes('spotify-auth-session.js'));
assert.ok(pkg.build.files.includes('spotify-secure-auth-store.js'));
assert.equal(pkg.build.publish[0].owner, 'XxHuberrr');
assert.equal(pkg.build.publish[0].repo, 'Mineradio');

const mainSource = read('desktop/main.js');
assert.match(mainSource, /const APP_NAME = 'Mineradio for Spotify';/);
assert.match(mainSource, /const LEGACY_USER_DATA_NAME = 'Mineradio';/);
assert.match(mainSource, /app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), LEGACY_USER_DATA_NAME\)\);/);
assert.match(mainSource, /filePath: path\.join\(userDataPath, '\.spotify-auth\.enc'\)/);

const installerSource = read('build/installer.nsh');
const afterPackSource = read('build/after-pack.js');
assert.match(installerSource, /Mineradio for Spotify/);
assert.match(installerSource, /D:\\Mineradio/);
assert.match(afterPackSource, /'ProductName', 'Mineradio for Spotify'/);
assert.match(afterPackSource, /'FileDescription', 'Mineradio for Spotify'/);

const readme = read('README.md');
const release = read('RELEASE.md');
assert.match(readme, /# Mineradio for Spotify/);
assert.match(readme, /Mineradio-for-Spotify-1\.1\.2-Setup\.exe/);
assert.match(release, /Mineradio-for-Spotify-1\.1\.2-Setup\.exe/);
assert.ok(fs.existsSync(path.join(root, 'docs', 'RELEASE_NOTES_v1.1.2.md')));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbiddenNames = new Set(['.cookie', '.qq-cookie', '.spotify-auth', '.spotify-auth.enc', '.env']);
const forbiddenExtensions = /\.(?:exe|dll|scr|vbs|jse|wsf|hta|xlsm)$/i;
for (const file of tracked) {
  assert.ok(!forbiddenNames.has(path.basename(file)), `sensitive local file is tracked: ${file}`);
  assert.ok(!forbiddenExtensions.test(file), `forbidden binary/script is tracked: ${file}`);
}

const ignored = execFileSync('git', ['check-ignore', '.spotify-auth', '.spotify-auth.enc', '.cookie', '.qq-cookie'], {
  cwd: root,
  encoding: 'utf8',
}).trim().split(/\r?\n/);
for (const file of ['.spotify-auth', '.spotify-auth.enc', '.cookie', '.qq-cookie']) {
  assert.ok(ignored.includes(file), `${file} must be ignored`);
}

console.log('GitHub release readiness: PASS');
