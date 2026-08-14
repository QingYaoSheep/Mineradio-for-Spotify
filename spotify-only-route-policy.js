'use strict';

const ALLOWED_EXACT_API_ROUTES = new Set([
  '/api/app/version',
  '/api/beatmap/cache',
  '/api/beatmap/cache/status',
  '/api/cover',
  '/api/lyric',
  '/api/lyric/cache',
  '/api/lyric/cache/song',
  '/api/lyric/cache/status',
  '/api/lyric/romanize',
  '/api/apple-music/lyrics',
  '/api/apple-music/lyrics/search',
  '/api/apple-music/lyrics/auth/status',
  '/api/apple-music/lyrics/auth/test',
  '/api/apple-music/lyrics/auth',
  '/api/qq/lyric',
  '/api/spotify/callback',
  '/api/spotify/login',
  '/api/spotify/logout',
  '/api/spotify/status',
  '/api/update/download',
  '/api/update/download/status',
  '/api/update/latest',
  '/api/update/patch',
  '/api/update/patch/status',
]);

function allowed() {
  return { allowed: true, status: 200, error: '' };
}

function removed() {
  return {
    allowed: false,
    status: 410,
    error: 'SPOTIFY_ONLY_ROUTE_REMOVED',
    message: 'Better Radio 不再提供其他音乐平台的登录、播放或资料库接口。',
  };
}

function evaluateSpotifyOnlyRoute(options = {}) {
  const pathname = String(options.pathname || '/');
  const searchParams = options.searchParams instanceof URLSearchParams
    ? options.searchParams
    : new URLSearchParams(options.searchParams || '');

  if (!pathname.startsWith('/api/')) return allowed();
  if (pathname.startsWith('/api/spotify/web-api/')) return allowed();
  if (ALLOWED_EXACT_API_ROUTES.has(pathname)) return allowed();
  if (
    (pathname === '/api/search' || pathname === '/api/qq/search')
    && searchParams.get('purpose') === 'lyrics'
  ) {
    return allowed();
  }
  return removed();
}

module.exports = {
  ALLOWED_EXACT_API_ROUTES,
  evaluateSpotifyOnlyRoute,
};
