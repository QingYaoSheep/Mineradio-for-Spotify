'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const installerName = `Mineradio-for-Spotify-${pkg.version}-Setup.exe`;
const installerPath = path.join(dist, installerName);
if (!fs.existsSync(installerPath)) throw new Error(`Missing installer: ${installerPath}`);

const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(installerPath));
const digest = hash.digest('hex');
const outputName = `Mineradio-for-Spotify-${pkg.version}-SHA256SUMS.txt`;
fs.writeFileSync(path.join(dist, outputName), `${digest}  ${installerName}\n`, 'utf8');
console.log(`${outputName}: ${digest}`);
