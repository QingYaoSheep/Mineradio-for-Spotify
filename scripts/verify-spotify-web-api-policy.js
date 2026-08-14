'use strict';

const assert = require('assert/strict');
const { spotifyWebApiProxyTarget } = require('../spotify-web-api-policy');

function target(relative, method = 'GET') {
  const url = new URL(`/api/spotify/web-api${relative}`, 'http://127.0.0.1:3000');
  return spotifyWebApiProxyTarget(url, method);
}

assert.equal(target('/me'), '/v1/me');
assert.equal(target('/me/player'), '/v1/me/player');
assert.equal(target('/me/player/devices'), '/v1/me/player/devices');
assert.equal(target('/me/player', 'PUT'), '/v1/me/player');
assert.equal(target('/me/player/seek?position_ms=0', 'PUT'), '/v1/me/player/seek?position_ms=0');
assert.equal(target('/me/player/seek?position_ms=187650', 'PUT'), '/v1/me/player/seek?position_ms=187650');
assert.equal(target('/me/player/seek', 'PUT'), '', 'seek requires an integer position');
assert.equal(target('/me/player/seek?position_ms=-1', 'PUT'), '', 'negative seek positions must stay blocked');
assert.equal(target('/me/player/seek?position_ms=1.5', 'PUT'), '', 'fractional seek positions must stay blocked');
assert.equal(target('/me/player/seek?position_ms=187650', 'GET'), '', 'seek is write-only');

assert.equal(
  target('/search?q=long%20tone&type=track&limit=50&offset=20'),
  '/v1/search?q=long+tone&type=track&limit=10&offset=20',
  'Spotify February 2026 search limit must be clamped to 10'
);
assert.equal(
  target('/me/playlists?limit=50&offset=50'),
  '/v1/me/playlists?limit=50&offset=50'
);
assert.equal(
  target('/playlists/abc123/items?limit=50&offset=100'),
  '/v1/playlists/abc123/items?limit=50&offset=100'
);
assert.equal(
  target('/playlists/abc123/tracks?limit=100'),
  '',
  'deprecated playlist tracks route must stay blocked'
);

assert.equal(
  target('/me/library/contains?uris=spotify%3Atrack%3Aabc123'),
  '/v1/me/library/contains?uris=spotify%3Atrack%3Aabc123'
);
assert.equal(
  target('/me/library?uris=spotify%3Atrack%3Aabc123', 'PUT'),
  '/v1/me/library?uris=spotify%3Atrack%3Aabc123'
);
assert.equal(
  target('/me/library?uris=spotify%3Atrack%3Aabc123', 'DELETE'),
  '/v1/me/library?uris=spotify%3Atrack%3Aabc123'
);
assert.equal(target('/me/playlists', 'POST'), '/v1/me/playlists');
assert.equal(target('/playlists/abc123/items', 'POST'), '/v1/playlists/abc123/items');
assert.equal(target('/me/tracks?limit=50&offset=100'), '/v1/me/tracks?limit=50&offset=100');
assert.equal(target('/me/albums?limit=50&offset=100'), '/v1/me/albums?limit=50&offset=100');
assert.equal(target('/me/top/tracks?limit=20&time_range=short_term'), '/v1/me/top/tracks?limit=20&offset=0&time_range=short_term');
assert.equal(
  target('/me/player/recently-played?limit=20'),
  '/v1/me/player/recently-played?limit=20',
  'Spotify Home should use the official recently played endpoint without inventing an offset cursor'
);

assert.equal(target('/me/following?type=artist'), '', 'unapproved Spotify endpoints must remain blocked');
assert.equal(target('/playlists/not-valid!/items'), '', 'invalid Spotify IDs must remain blocked');
assert.equal(target('/me/library?uris=https%3A%2F%2Fevil.example', 'PUT'), '', 'library writes only accept Spotify URIs');

console.log('Spotify Web API proxy policy verification passed');
