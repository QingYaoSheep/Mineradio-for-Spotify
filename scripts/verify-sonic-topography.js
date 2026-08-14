'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const sonic = fs.readFileSync(path.join(root, 'public', 'sonic-topography-preset.js'), 'utf8');
const source = readRendererSource();

assert.match(sonic, /global\.MineradioSonicTopography\s*=/);
assert.match(sonic, /var INDEX = 7/);
assert.match(sonic, /function update\(dt, ctx\)/);
const sonicScriptIndex = html.indexOf('<script src="sonic-topography-preset.js"></script>');
const appScriptIndex = html.indexOf('<script src="js/app.js"></script>');
assert.ok(sonicScriptIndex >= 0, 'Sonic Topography script must be loaded');
assert.ok(appScriptIndex > sonicScriptIndex, 'Sonic Topography must load before the renderer');
assert.match(source, /var SONIC_PRESET_INDEX = 7/);
assert.match(source, /\{\s*name:\s*'音域回响'/);
assert.match(source, /var SONIC_WORKSHOP_PRESET_INDEX = 8/);
assert.match(source, /\{\s*name:\s*'音域回响·WE'/);
assert.match(source, /MineradioSonicTopography\.onPresetChange\(prev,\s*p/);
assert.match(source, /MineradioSonicTopography\.update\(dt,\s*\{/);
assert.match(source, /preset:\s*7|data-preset="7"|presetDisplayOrder\s*=\s*\[[^\]]*7/);
assert.match(source, /clampRange\(Number\(raw\.preset\) \|\| 0,\s*0,\s*8\)/);

console.log('Sonic Topography preset integration verification passed');
