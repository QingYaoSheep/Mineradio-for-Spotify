const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRendererSource } = require('./renderer-source');

const html = readRendererSource();
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
    const offset = Number(new URL(url, 'https://example.test').searchParams.get('offset') || 0);
    return {
      ok: true,
      json: async () => offset === 0 ? ({
        items: [{
          item: {
            id: 'track-1',
            name: 'Playlist track 1',
            artists: [{ name: 'Artist' }],
            album: { name: 'Album', images: [{ url: 'https://example.test/cover.jpg' }] },
            duration_ms: 180000,
            uri: 'spotify:track:track-1',
          },
        }],
        next: 'https://api.spotify.com/v1/playlists/playlist-1/items?offset=50',
      }) : ({
        items: [{
          item: {
            id: 'track-2',
            name: 'Playlist track 2',
            artists: [{ name: 'Artist 2' }],
            album: { name: 'Album 2', images: [] },
            duration_ms: 200000,
            uri: 'spotify:track:track-2',
          },
        }],
        next: null,
      }),
    };
  },
  encodeURIComponent,
  URL,
  Error,
};
vm.createContext(context);
vm.runInContext(`${html.slice(start, end)}; this.loadSpotifyPlaylist = fetchSpotifyPlaylistTracks;`, context);

(async () => {
  const result = await context.loadSpotifyPlaylist('playlist-1');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    tracks: [{
      id: 'track-1',
      name: 'Playlist track 1',
      artist: 'Artist',
      album: 'Album',
      cover: 'https://example.test/cover.jpg',
      duration: 180,
      provider: 'spotify',
      spotifyUri: 'spotify:track:track-1',
      spotifyPlaylistUri: 'spotify:playlist:playlist-1',
    }, {
      id: 'track-2',
      name: 'Playlist track 2',
      artist: 'Artist 2',
      album: 'Album 2',
      cover: '',
      duration: 200,
      provider: 'spotify',
      spotifyUri: 'spotify:track:track-2',
      spotifyPlaylistUri: 'spotify:playlist:playlist-1',
    }],
  });
  assert.equal(calls.length, 2, 'The Spotify playlist API should load every page');
  assert.equal(calls[0].url, '/playlists/playlist-1/items?limit=50&offset=0');
  assert.equal(calls[1].url, '/playlists/playlist-1/items?limit=50&offset=50');
  assert.equal(calls[0].options, undefined);
  console.log('Spotify playlist loader: PASS');
})().catch((error) => {
  console.error(`Spotify playlist loader: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
