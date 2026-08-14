'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRendererSource } = require('./renderer-source');

const source = readRendererSource();

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
  fx: { spotifyMode: true },
  spotifyLoginStatus: { loggedIn: true },
  likedSongMap: {},
  likeBusyMap: {},
  miniQueueOpen: false,
  spotifyApi: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  },
  ensureLoggedInForAction: () => true,
  updateLikeButtons() {},
  safeRenderQueuePanel() {},
  refreshSearchResultActionStates() {},
  showToast() {},
  songProviderKey: () => 'spotify',
  console,
  String,
  encodeURIComponent,
  Error,
};
vm.createContext(context);
vm.runInContext([
  functionSource('function spotifySongUri(song)'),
  functionSource('function isSpotifySong(song)'),
  functionSource('function isCloudSong(song)'),
  functionSource('async function toggleLikeSong(song)'),
  'this.toggle = toggleLikeSong;',
].join('\n'), context);

(async () => {
  const song = { id: 'track-1', provider: 'spotify', spotifyUri: 'spotify:track:track-1' };
  await context.toggle(song);
  assert.equal(context.likedSongMap['track-1'], true);
  assert.equal(calls[0].url, '/me/library?uris=spotify%3Atrack%3Atrack-1');
  assert.equal(calls[0].options.method, 'PUT');

  await context.toggle(song);
  assert.equal(context.likedSongMap['track-1'], false);
  assert.equal(calls[1].options.method, 'DELETE');

  assert.match(source, /spotifyApi\('\/me\/playlists',\s*\{[\s\S]*?method:\s*'POST'/, 'playlist creation must use the current Spotify endpoint');
  assert.match(source, /spotifyApi\('\/playlists\/'[\s\S]*?'\/items',\s*\{[\s\S]*?method:\s*'POST'/, 'collecting a track must use Spotify playlist items');
  assert.doesNotMatch(source, /apiJson\('\/api\/playlist\/create/, 'NetEase playlist creation must be removed from renderer actions');
  assert.doesNotMatch(source, /apiJson\('\/api\/playlist\/add-song/, 'NetEase playlist writes must be removed from renderer actions');
  console.log('Spotify library actions verification passed');
})().catch((error) => {
  console.error(`Spotify library actions verification failed\n${error.stack || error.message}`);
  process.exitCode = 1;
});
