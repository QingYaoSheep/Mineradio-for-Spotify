'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeApp = process.env.MINERADIO_RUNTIME_APP
  ? path.resolve(process.env.MINERADIO_RUNTIME_APP)
  : path.join(root, 'dist', 'win-unpacked', 'resources', 'app');
const runtimeFiles = [
  'romanization-engine.js',
  'spotify-web-api-policy.js',
  path.join('public', 'index.html'),
  path.join('public', 'css', 'apple-music-lyrics-beta.css'),
  path.join('public', 'vendor', 'amll-core.bundle.js'),
  path.join('public', 'js', 'app.js'),
  path.join('public', 'js', 'apple-music-lyrics-beta-model.js'),
  path.join('public', 'js', 'apple-music-lyrics-beta.js'),
];

assert(fs.existsSync(runtimeApp),
  `Mineradio runtime app directory does not exist: ${runtimeApp}`);
assert.notEqual(runtimeApp.toLowerCase(), root.toLowerCase(),
  'Refusing to synchronize AMLL files into the source repository root');
const runtimePackagePath = path.join(runtimeApp, 'package.json');
const runtimeMainPath = path.join(runtimeApp, 'desktop', 'main.js');
assert(fs.existsSync(runtimePackagePath),
  `Target is not a Mineradio runtime app (package.json missing): ${runtimeApp}`);
assert(fs.existsSync(runtimeMainPath),
  `Target is not a Mineradio runtime app (desktop/main.js missing): ${runtimeApp}`);
const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, 'utf8'));
assert.equal(runtimePackage.name, 'better-radio',
  `Target package is not Better Radio: ${runtimePackage.name || '(unnamed)'}`);

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

for (const relativePath of runtimeFiles) {
  const source = path.join(root, relativePath);
  const destination = path.join(runtimeApp, relativePath);
  assert(fs.existsSync(source), `AMLL runtime source file is missing: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive:true });
  fs.copyFileSync(source, destination);
  assert.equal(fileHash(destination), fileHash(source),
    `AMLL runtime file failed hash verification: ${relativePath}`);
}

console.log(`AMLL runtime synchronized: ${runtimeApp}`);
