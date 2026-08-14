'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeWallpaperFrameRate,
  normalizeWallpaperState,
  workerWAttachScript,
} = require('../desktop/wallpaper-mode-runtime');
const { readRendererSource } = require('./renderer-source');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');
const library = fs.readFileSync(path.join(root, 'desktop', 'wallpaper-engine-library.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const renderer = readRendererSource();

assert.strictEqual(normalizeWallpaperFrameRate(23), 24);
assert.strictEqual(normalizeWallpaperFrameRate(38), 30);
assert.strictEqual(normalizeWallpaperFrameRate(59), 60);
assert.deepStrictEqual(
  normalizeWallpaperState(null, { enabled: true, opacity: 0.1, frameRate: 58 }, true),
  {
    enabled: true,
    title: 'Better Radio',
    artist: '',
    cover: '',
    playing: false,
    preset: 0,
    opacity: 0.35,
    frameRate: 60,
    colors: {
      primary: '#d6f8ff',
      secondary: '#9cffdf',
      highlight: '#fff0b8',
      glow: '#9cffdf',
    },
  }
);
const attachScript = workerWAttachScript({ hwnd: '1234', x: 0, y: 0, width: 1920, height: 1080 });
assert.match(attachScript, /WALLPAPER_WORKERW_ATTACH_FAILED/);
assert.match(attachScript, /ConvertTo-Json -Compress/);
assert.throws(() => workerWAttachScript({ hwnd: 'not-a-window' }), /WALLPAPER_NATIVE_HANDLE_INVALID/);
assert.match(main, /new DesktopWallpaperRuntime\(/);
assert.match(main, /return await createWallpaperWindow/);
assert.match(main, /desktopWallpaperRuntime\.reconcileDisplay/);
assert.match(preload, /listWallpaperEngineProjects/);
assert.match(library, /enginePlayable|native-engine|getNativeSceneTarget|deriveSceneMuteProperties/);
assert.match(library, /SCENE_PACKAGE_EXTENSIONS|validateScenePackage/);
assert.match(renderer, /projectType === 'web' \|\| project\.projectType === 'application'/);
assert.match(html, /id="t-wallpaperMode"/);
assert.doesNotMatch(html, /id="t-wallpaperMode"[^>]*dev-locked/);
assert.match(renderer, /wallpaperMode:\s*raw\.wallpaperMode === true/);
assert.doesNotMatch(renderer, /fx\.wallpaperMode = false/);

console.log('Safe Windows wallpaper mode verification passed');
