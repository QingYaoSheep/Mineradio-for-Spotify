'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'index.css'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const runtimeFile = path.join(root, 'desktop', 'wallpaper-engine-runtime.js');
const renderer = readRendererSource();

assert.ok(fs.existsSync(runtimeFile), 'native Wallpaper Engine runtime must be present');
const runtime = fs.readFileSync(runtimeFile, 'utf8');
const { sanitizeRealtimeProperties } = require('../desktop/wallpaper-engine-runtime');
assert.match(runtime, /class WallpaperEngineRuntime/);
assert.match(runtime, /async start\(id,\s*options/);
assert.match(runtime, /async applyProperties\(/);
assert.match(runtime, /sanitizeRealtimeProperties/);
assert.match(runtime, /Skutta Software/i);
assert.match(runtime, /WALLPAPER_SCENE_PACKAGE_INVALID/);
assert.match(runtime, /WM_LBUTTONDOWN/);
assert.match(runtime, /WM_MOUSEWHEEL/);
assert.doesNotMatch(runtime, /\.mineradio-scene-stage/);
assert.doesNotMatch(runtime, /path\.parse\(scenePackage\)\.root,\s*'MineradioCache'/);
assert.deepStrictEqual(sanitizeRealtimeProperties({
  inputGain: -1,
  audioIntensity: 1.5,
  responseRange: 99,
  peakIntensity: 0.25,
  volume: 1,
  __proto__: 2,
}), {
  inputGain: 0,
  audioIntensity: 1.5,
  responseRange: 4,
  peakIntensity: 0.25,
});

for (const channel of [
  'mineradio-wallpaper-engine-runtime-status',
  'mineradio-wallpaper-engine-start',
  'mineradio-wallpaper-engine-stop',
  'mineradio-wallpaper-engine-apply-properties',
]) {
  assert.match(main, new RegExp(channel));
}
assert.match(main, /isTrustedMainWindowEvent/);
assert.match(main, /WallpaperEngineRuntime/);

for (const api of [
  'getWallpaperEngineRuntimeStatus',
  'startWallpaperEngineScene',
  'stopWallpaperEngineScene',
  'applyWallpaperEngineProperties',
  'openWallpaperEngineProjectDetails',
]) {
  assert.match(preload, new RegExp(api));
}

assert.match(html, /id="wallpaper-engine-layer"/);
assert.match(html, /id="wallpaper-engine-modal"/);
assert.match(html, /id="wallpaper-engine-search"/);
assert.match(html, /导入项目 \/ Scene 包/);
assert.match(html, /壁纸交互/);
assert.match(css, /\.wallpaper-engine-library-modal/);
assert.match(renderer, /WALLPAPER_ENGINE_SELECTION_STORE_KEY/);
assert.match(renderer, /projectType === 'web'/);
assert.match(renderer, /projectType === 'application'/);
assert.match(renderer, /enginePlayable/);
assert.match(renderer, /liveBackgroundKeep/);
assert.match(renderer, /function isWallpaperEngineBlankStageEvent/);
assert.match(renderer, /reportWallpaperEnginePointerEvent\(event, 'down'\)/);
assert.match(renderer, /reportWallpaperEnginePointerEvent\(event, 'wheel'\)/);
assert.match(renderer, /wallpaperEngineForwardedPointers/);
assert.match(renderer, /reportWallpaperEnginePointerEvent\(event, 'up', true\)/);
assert.match(renderer, /pointercancel/);
assert.match(renderer, /pointerCardHit\(raycaster, event, 18\)/);

assert.match(html, /data-lyric-texture-clarity="1"/);
assert.match(html, /data-lyric-texture-clarity="4"/);
assert.match(renderer, /lyricTextureClarity:\s*2/);
assert.match(renderer, /function setLyricTextureClarity/);
assert.match(renderer, /function lyricTextureMemoryBudgetBytes/);
assert.match(renderer, /estimatedConcurrentLayers\s*=\s*14/);
assert.match(renderer, /targetRenderScale\s*=\s*1/);
assert.match(renderer, /硬件限制/);

assert.match(renderer, /SONIC_WORKSHOP_PRESET_INDEX\s*=\s*8/);
assert.match(renderer, /name:\s*'音域回响·WE'/);
assert.match(renderer, /sonicWorkshopProjectId/);
assert.match(renderer, /fallbackToInternalSonicPreset/);
assert.match(renderer, /applyWallpaperEngineProperties/);
assert.match(html, /id="fx-sonicweinput"/);
assert.match(html, /id="fx-sonicwepeak"/);

console.log('Wallpaper Engine 2.0, lyric clarity, and Sonic WE integration verification passed');
