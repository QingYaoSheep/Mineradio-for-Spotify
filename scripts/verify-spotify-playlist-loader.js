const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const marker = 'async function fetchSpotifyPlaylistTracks(playlistId)';
const start = html.indexOf(marker);
assert.notEqual(start, -1, 'Spotify playlist loader should exist');

let depth = 0;
let end = -1;
for (let index = html.indexOf('{', start); index < html.length; index += 1) {
  if (html[index] === '{') depth += 1;
  if (html[index] === '}') depth -= 1;
  if (depth === 0) {
    end = index + 1;
    break;
  }
}
assert.notEqual(end, -1, 'Spotify playlist loader should have a complete body');

const calls = [];
const context = {
  apiJson: async (url) => {
    throw new Error(`Unexpected backend route: ${url}`);
  },
  spotifyApi: async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        items: [{
          track: {
            id: 'track-1',
            name: 'Playlist track',
            artists: [{ name: 'Artist' }],
            album: { name: 'Album', images: [{ url: 'https://example.test/cover.jpg' }] },
            duration_ms: 180000,
          },
        }],
      }),
    };
  },
  encodeURIComponent,
  Error,
};
vm.createContext(context);
vm.runInContext(`${html.slice(start, end)}; this.loadSpotifyPlaylist = fetchSpotifyPlaylistTracks;`, context);

(async () => {
  const result = await context.loadSpotifyPlaylist('playlist-1');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    tracks: [{
      id: 'track-1',
      name: 'Playlist track',
      artist: 'Artist',
      album: 'Album',
      cover: 'https://example.test/cover.jpg',
      duration: 180,
      provider: 'spotify',
      spotifyUri: 'spotify:track:track-1',
      spotifyPlaylistUri: 'spotify:playlist:playlist-1',
    }],
  });
  assert.equal(calls.length, 1, 'The Spotify playlist API should be called once');
  assert.equal(calls[0].url, '/playlists/playlist-1/tracks?limit=100');
  assert.equal(calls[0].options, undefined);
  console.log('Spotify playlist loader: PASS');
})().catch((error) => {
  console.error(`Spotify playlist loader: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
