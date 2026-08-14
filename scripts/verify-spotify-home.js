'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

function track(id, name) {
  return {
    id,
    name,
    uri: `spotify:track:${id}`,
    duration_ms: 180000,
    artists: [{ id: `artist-${id}`, name: `Artist ${id}` }],
    album: {
      id: `album-${id}`,
      name: `Album ${id}`,
      uri: `spotify:album:album-${id}`,
      images: [{ url: `https://example.test/${id}.jpg` }],
    },
  };
}

const calls = [];
const payloads = {
  '/me/tracks?limit=20&offset=0': { items: [{ track: track('saved', 'Saved song') }] },
  '/me/top/tracks?limit=20&offset=0&time_range=short_term': {
    items: [track('top', 'Top song'), track('saved', 'Saved song')],
  },
  '/me/player/recently-played?limit=20': {
    items: [{ track: track('recent', 'Recent song'), played_at: '2026-07-28T00:00:00Z' }],
  },
};

const context = {
  spotifyApi: async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => payloads[url],
    };
  },
  spotifyLoginStatus: { loggedIn: true },
  homeDiscoverState: {
    loading: false,
    loaded: false,
    loggedIn: false,
    mode: 'starter',
    songs: [],
    playlists: [],
    podcasts: [],
    savedSongs: [],
    topSongs: [],
    recentSongs: [],
    error: '',
    updatedAt: 0,
  },
  homeDiscoverToken: 0,
  userPlaylists: [{ id: 'playlist-1', provider: 'spotify' }],
  renderHomeDiscover() {},
  console,
  Date,
  Promise,
  Number,
  Math,
  String,
  Array,
  Object,
  Error,
};

vm.createContext(context);
vm.runInContext([
  functionSource('function mapSpotifyTrack(track, contextUri)'),
  functionSource('function dedupeSpotifyHomeTracks(tracks)'),
  functionSource('async function fetchSpotifyHomePage(path)'),
  functionSource('async function loadSpotifyHome(force)'),
  'this.loadHome = loadSpotifyHome;',
].join('\n'), context);

(async () => {
  await context.loadHome(true);
  assert.deepEqual(calls.sort(), Object.keys(payloads).sort());
  assert.deepEqual(context.homeDiscoverState.topSongs.map((song) => song.id), ['top', 'saved']);
  assert.deepEqual(context.homeDiscoverState.savedSongs.map((song) => song.id), ['saved']);
  assert.deepEqual(context.homeDiscoverState.recentSongs.map((song) => song.id), ['recent']);
  assert.deepEqual(
    context.homeDiscoverState.songs.map((song) => song.id),
    ['top', 'saved', 'recent'],
    'Home playback queue should deduplicate official Spotify sources while preserving priority'
  );
  assert.deepEqual(context.homeDiscoverState.playlists, context.userPlaylists);
  assert.equal(context.homeDiscoverState.podcasts.length, 0);
  assert.equal(context.homeDiscoverState.loggedIn, true);
  assert.equal(context.homeDiscoverState.error, '');

  const homeMarkup = html.slice(
    html.indexOf('<section id="empty-home"'),
    html.indexOf('<!-- 顶部右侧', html.indexOf('<section id="empty-home"'))
  );
  assert.doesNotMatch(
    homeMarkup,
    /天气电台|每日推荐|私人电台|网易云|QQ\s*音乐/,
    'Spotify-only Home should not expose removed providers or fabricated recommendation products'
  );
  const loadSource = functionSource('async function loadSpotifyHome(force)');
  assert.doesNotMatch(loadSource, /\/api\/discover\/home|\/api\/weather/);
  console.log('Spotify-only Home verification passed');
})().catch((error) => {
  console.error(`Spotify-only Home verification failed\n${error.stack || error.message}`);
  process.exitCode = 1;
});
