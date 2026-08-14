'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const source = readRendererSource();
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function functionSource(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${marker} should have a complete body`);
}

const calls = [];
const context = {
  spotifyApi: async (url, options) => {
    calls.push({ url, options });
    if (url === '/me/player/devices') {
      return {
        ok: true,
        json: async () => ({
          devices: [
            { id: 'device-1', name: 'Desktop', type: 'Computer', is_active: true, volume_percent: 65 },
            { id: 'device-2', name: 'Phone', type: 'Smartphone', is_active: false, volume_percent: 40 },
          ],
        }),
      };
    }
    return { ok: true, status: 204 };
  },
  renderSpotifyDevices() {},
  localStorage: {
    setItem() {},
  },
  showToast() {},
  JSON,
  String,
  Error,
  spotifyDevices: [],
  spotifyPreferredDeviceId: '',
};
vm.createContext(context);
vm.runInContext([
  functionSource('async function refreshSpotifyDevices()'),
  functionSource('async function selectSpotifyDevice(deviceId)'),
  'this.refresh = refreshSpotifyDevices; this.select = selectSpotifyDevice;',
].join('\n'), context);

(async () => {
  const devices = await context.refresh();
  assert.equal(devices.length, 2);
  assert.equal(calls[0].url, '/me/player/devices');
  assert.equal(calls.length, 1, 'refreshing devices must not silently transfer playback');

  await context.select('device-2');
  assert.equal(calls[1].url, '/me/player');
  assert.equal(calls[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].options.body), { device_ids: ['device-2'], play: false });

  assert.match(html, /id="spotify-device-select"/, 'Spotify device selector should be visible in Spotify settings');
  assert.match(source, /openSpotifyApp/, 'idle recovery should expose an Open Spotify action');
  console.log('Spotify device selection verification passed');
})().catch((error) => {
  console.error(`Spotify device selection verification failed\n${error.stack || error.message}`);
  process.exitCode = 1;
});
