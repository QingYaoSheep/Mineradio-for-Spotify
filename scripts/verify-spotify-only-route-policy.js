'use strict';

const assert = require('assert/strict');
const { evaluateSpotifyOnlyRoute } = require('../spotify-only-route-policy');

function evaluate(url, method = 'GET') {
  const parsed = new URL(url, 'http://127.0.0.1:3000');
  return evaluateSpotifyOnlyRoute({
    pathname: parsed.pathname,
    searchParams: parsed.searchParams,
    method,
  });
}

for (const route of [
  '/api/spotify/status',
  '/api/spotify/web-api/me/player',
  '/api/lyric/cache/song',
  '/api/lyric/romanize',
  '/api/qq/lyric?mid=abc',
  '/api/search?purpose=lyrics&keywords=test',
  '/api/qq/search?purpose=lyrics&keywords=test',
  '/api/update/latest',
  '/api/beatmap/cache/status',
  '/api/cover?url=https%3A%2F%2Fexample.test%2Fcover.jpg',
]) {
  assert.equal(evaluate(route).allowed, true, `${route} should remain available`);
}

for (const route of [
  '/api/login/status',
  '/api/login/cookie',
  '/api/qq/login/status',
  '/api/qq/login/cookie',
  '/api/song/url?id=1',
  '/api/qq/song/url?mid=1',
  '/api/audio?url=https%3A%2F%2Fexample.test%2Fa.mp3',
  '/api/user/playlists',
  '/api/qq/user/playlists',
  '/api/discover/home',
  '/api/weather/radio',
  '/api/podcast/search',
  '/api/search?keywords=general-playback-search',
  '/api/qq/search?keywords=general-playback-search',
]) {
  const result = evaluate(route);
  assert.equal(result.allowed, false, `${route} should be removed in Spotify-only mode`);
  assert.equal(result.status, 410);
  assert.equal(result.error, 'SPOTIFY_ONLY_ROUTE_REMOVED');
}

assert.equal(evaluate('/').allowed, true, 'static app shell should remain available');
assert.equal(evaluate('/public/index.html').allowed, true, 'static assets should remain available');

console.log('Spotify-only route policy verification passed');
