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
  spotifyApi: async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({
        tracks: {
          items: [{
            id: 'track-1',
            name: 'Long Tone',
            uri: 'spotify:track:track-1',
            duration_ms: 185000,
            artists: [{ id: 'artist-1', name: 'Singer' }],
            album: {
              id: 'album-1',
              name: 'Album',
              uri: 'spotify:album:album-1',
              images: [{ url: 'https://example.test/cover.jpg' }],
            },
          }],
          total: 21,
          next: 'https://api.spotify.com/v1/search?offset=10',
        },
      }),
    };
  },
  encodeURIComponent,
  Error,
  Number,
  Math,
  String,
};
vm.createContext(context);
vm.runInContext([
  functionSource('function mapSpotifyTrack(track, contextUri)'),
  functionSource('async function fetchSpotifySearchPage(query, offset)'),
  'this.fetchPage = fetchSpotifySearchPage;',
].join('\n'), context);

(async () => {
  const result = await context.fetchPage('Long Tone', 0);
  assert.deepEqual(calls, ['/search?q=Long%20Tone&type=track&limit=10&offset=0']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    songs: [{
      id: 'track-1',
      name: 'Long Tone',
      artist: 'Singer',
      artists: [{ id: 'artist-1', name: 'Singer' }],
      album: 'Album',
      albumId: 'album-1',
      albumUri: 'spotify:album:album-1',
      cover: 'https://example.test/cover.jpg',
      duration: 185,
      provider: 'spotify',
      source: 'spotify',
      spotifyUri: 'spotify:track:track-1',
      spotifyPlaylistUri: '',
    }],
    total: 21,
    nextOffset: 10,
    done: false,
  });
  assert.doesNotMatch(html, /id="search-mode-(?:netease|qq|podcast)"/, 'provider search tabs must be removed');
  assert.match(source, /search-virtual-spacer/, 'Spotify search results should use a virtualized DOM window');
  console.log('Spotify-only search verification passed');
})().catch((error) => {
  console.error(`Spotify-only search verification failed\n${error.stack || error.message}`);
  process.exitCode = 1;
});
