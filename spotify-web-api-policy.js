'use strict';

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const SPOTIFY_URI_PATTERN = /^spotify:(?:track|album|episode|show|audiobook|artist|user|playlist):[A-Za-z0-9]{1,64}$/;

function integerParam(searchParams, name, fallback, min, max) {
  const raw = Number(searchParams.get(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function pagedTarget(pathname, searchParams, options = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(integerParam(
    searchParams,
    'limit',
    options.defaultLimit || 20,
    1,
    options.maxLimit || 50
  )));
  params.set('offset', String(integerParam(searchParams, 'offset', 0, 0, 100000)));
  if (options.timeRange) {
    const timeRange = String(searchParams.get('time_range') || 'medium_term');
    params.set('time_range', /^(short|medium|long)_term$/.test(timeRange) ? timeRange : 'medium_term');
  }
  return `${pathname}?${params.toString()}`;
}

function validatedUris(searchParams) {
  const uris = String(searchParams.get('uris') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!uris.length || uris.length > 40 || uris.some(uri => !SPOTIFY_URI_PATTERN.test(uri))) return '';
  return uris.join(',');
}

function spotifyWebApiProxyTarget(url, method) {
  const prefix = '/api/spotify/web-api';
  const relative = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
  const requestKey = `${String(method || 'GET').toUpperCase()} ${relative}`;
  const exactRoutes = new Map([
    ['GET /me', '/v1/me'],
    ['GET /me/player', '/v1/me/player'],
    ['GET /me/player/currently-playing', '/v1/me/player/currently-playing'],
    ['GET /me/player/devices', '/v1/me/player/devices'],
    ['PUT /me/player', '/v1/me/player'],
    ['PUT /me/player/play', '/v1/me/player/play'],
    ['PUT /me/player/pause', '/v1/me/player/pause'],
    ['POST /me/player/next', '/v1/me/player/next'],
    ['POST /me/player/previous', '/v1/me/player/previous'],
    ['POST /me/playlists', '/v1/me/playlists'],
  ]);
  const exact = exactRoutes.get(requestKey);
  if (exact) return exact;

  if (String(method || 'GET').toUpperCase() === 'PUT' && relative === '/me/player/seek') {
    const rawPosition = String(url.searchParams.get('position_ms') || '');
    if (!/^\d{1,8}$/.test(rawPosition)) return '';
    const positionMs = Number(rawPosition);
    if (!Number.isSafeInteger(positionMs) || positionMs < 0 || positionMs > 86400000) return '';
    return `/v1/me/player/seek?position_ms=${positionMs}`;
  }

  if (method === 'GET' && relative === '/search') {
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 200);
    if (!query) return '';
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(integerParam(url.searchParams, 'limit', 10, 1, 10)),
      offset: String(integerParam(url.searchParams, 'offset', 0, 0, 1000)),
    });
    return `/v1/search?${params.toString()}`;
  }

  if (method === 'GET' && relative === '/me/playlists') {
    return pagedTarget('/v1/me/playlists', url.searchParams, { defaultLimit: 50, maxLimit: 50 });
  }
  if (method === 'GET' && relative === '/me/tracks') {
    return pagedTarget('/v1/me/tracks', url.searchParams, { defaultLimit: 50, maxLimit: 50 });
  }
  if (method === 'GET' && relative === '/me/albums') {
    return pagedTarget('/v1/me/albums', url.searchParams, { defaultLimit: 50, maxLimit: 50 });
  }
  if (method === 'GET' && relative === '/me/top/tracks') {
    return pagedTarget('/v1/me/top/tracks', url.searchParams, {
      defaultLimit: 20,
      maxLimit: 50,
      timeRange: true,
    });
  }
  if (method === 'GET' && relative === '/me/player/recently-played') {
    const params = new URLSearchParams();
    params.set('limit', String(integerParam(url.searchParams, 'limit', 20, 1, 50)));
    const after = String(url.searchParams.get('after') || '');
    const before = String(url.searchParams.get('before') || '');
    if (/^\d{1,20}$/.test(after)) params.set('after', after);
    else if (/^\d{1,20}$/.test(before)) params.set('before', before);
    return `/v1/me/player/recently-played?${params.toString()}`;
  }

  if (
    (relative === '/me/library' && (method === 'PUT' || method === 'DELETE'))
    || (relative === '/me/library/contains' && method === 'GET')
  ) {
    const uris = validatedUris(url.searchParams);
    if (!uris) return '';
    const params = new URLSearchParams({ uris });
    return `/v1${relative}?${params.toString()}`;
  }

  const playlistItems = relative.match(/^\/playlists\/([A-Za-z0-9]{1,64})\/items$/);
  if (playlistItems && method === 'GET') {
    return pagedTarget(`/v1/playlists/${playlistItems[1]}/items`, url.searchParams, {
      defaultLimit: 50,
      maxLimit: 50,
    });
  }
  if (playlistItems && method === 'POST') {
    return `/v1/playlists/${playlistItems[1]}/items`;
  }

  const playlist = relative.match(/^\/playlists\/([A-Za-z0-9]{1,64})$/);
  if (playlist && method === 'GET') return `/v1/playlists/${playlist[1]}`;

  return '';
}

module.exports = {
  SPOTIFY_ID_PATTERN,
  SPOTIFY_URI_PATTERN,
  spotifyWebApiProxyTarget,
};
