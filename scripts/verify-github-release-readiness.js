'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

assert.equal(pkg.name, 'better-radio');
assert.equal(pkg.productName, 'Better Radio');
assert.equal(pkg.version, '2.0.0');
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);

assert.equal(pkg.build.appId, 'com.betterradio.desktop', 'Better Radio must use an independent appId');
assert.equal(pkg.build.win.executableName, 'Better Radio');
assert.equal(pkg.build.nsis.shortcutName, 'Better Radio');
assert.equal(pkg.build.nsis.artifactName, 'Better-Radio-${version}-Setup.${ext}');
assert.ok(pkg.build.files.includes('spotify-auth-session.js'));
assert.ok(pkg.build.files.includes('spotify-secure-auth-store.js'));
assert.equal(pkg.author, 'QingYaoSheep');
assert.equal(pkg.build.publish[0].owner, 'QingYaoSheep');
assert.equal(pkg.build.publish[0].repo, 'Mineradio-for-Spotify');
assert.equal(pkg.mineradio.update.owner, 'QingYaoSheep');
assert.equal(pkg.mineradio.update.repo, 'Mineradio-for-Spotify');
assert.equal(pkg.mineradio.update.preview, false);

const mainSource = read('desktop/main.js');
assert.match(mainSource, /const APP_NAME = 'Better Radio';/);
assert.match(mainSource, /const APP_USER_DATA_NAME = 'Better Radio';/);
assert.match(mainSource, /isolatedTestUserData \|\| path\.join\(app\.getPath\('appData'\), APP_USER_DATA_NAME\)/);
assert.doesNotMatch(mainSource, /LEGACY_USER_DATA_NAME|persist:mineradio-/,
  'Better Radio must not share Mineradio user data or login partitions');
assert.match(mainSource, /filePath: path\.join\(userDataPath, '\.spotify-auth\.enc'\)/);

const installerSource = read('build/installer.nsh');
const afterPackSource = read('build/after-pack.js');
assert.match(installerSource, /Better Radio/);
assert.match(installerSource, /\.better-radio-install-root/);
assert.match(installerSource, /D:\\Better Radio/);
assert.match(installerSource, /appId=com\.betterradio\.desktop/);
assert.match(installerSource, /StrCpy \$2 "\$0" 13 -13/,
  'installer path normalization must compare the complete Better Radio suffix');
assert.match(installerSource, /StrCpy \$1 "\$INSTDIR" 13 -13/,
  'installer validation must compare the complete Better Radio suffix');
assert.doesNotMatch(installerSource, /\.mineradio-install-root|D:\\Mineradio|appId=com\.mineradio\.desktop/,
  'Better Radio installer must not adopt or overwrite Mineradio');
assert.match(afterPackSource, /'ProductName', 'Better Radio'/);
assert.match(afterPackSource, /'FileDescription', 'Better Radio'/);

const readme = read('README.md');
const release = read('RELEASE.md');
assert.match(readme, /# Better Radio/);
assert.match(readme, /Spotify 专门打造的舞台粒子效果视觉歌词显示器/);
assert.match(readme, /Better-Radio-2\.0\.0-Setup\.exe/);
assert.match(release, /Better-Radio-2\.0\.0-Setup\.exe/);
assert.ok(fs.existsSync(path.join(root, 'docs', 'RELEASE_NOTES_v2.0.0.md')));

const publicShell = [
  read('public/index.html'),
  read('public/desktop-lyrics.html'),
  read('public/wallpaper.html'),
  read('public/js/app.js'),
].join('\n');
assert.match(publicShell, /Better Radio/);
assert.match(read('public/index.html'), /<span class="splash-word-mine">Better<\/span>/);
assert.match(read('public/index.html'), /<span class="splash-word-radio" aria-label="Radio">Rad/);
assert.doesNotMatch(publicShell, /Mineradio for Spotify/,
  'the shipped interface must use the Better Radio brand');
assert.doesNotMatch(publicShell, />\s*MINERADIO(?:\s|<)/,
  'the shipped interface must not expose the legacy Mineradio wordmark');
assert.match(read('public/index.html'), /id="update-modal-version" class="update-version">v2\.0\.0/);
assert.match(read('public/js/app.js'), /currentVersion: '2\.0\.0'/);
assert.match(read('public/js/app.js'), /version: '2\.0\.0'/);

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
