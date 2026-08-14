'use strict';

const assert = require('assert/strict');
const http = require('http');

const port = 32681;
process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';
process.env.MINERADIO_UPDATE_MANIFEST = '';

const saved = [];
let cleared = 0;
global.__mineradioSpotifyAuthStore = {
  isAvailable: () => true,
  load: () => null,
  save: value => { saved.push(JSON.parse(JSON.stringify(value))); return true; },
  clear() { cleared += 1; },
};

const upstreamCalls = [];
global.fetch = async (url, options = {}) => {
  upstreamCalls.push({ url: String(url), options });
  if (String(url) === 'https://accounts.spotify.com/api/token') {
    const tokenBody = new URLSearchParams(options.body);
    if (tokenBody.get('grant_type') === 'refresh_token') {
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token revoked' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      access_token: 'http-access-token',
      refresh_token: 'http-refresh-token',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(url) === 'https://api.spotify.com/v1/me') {
    return new Response(JSON.stringify({ id: 'spotify-user', display_name: 'Spotify User' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (String(url) === 'https://api.spotify.com/v1/me/player/currently-playing') {
    return new Response(JSON.stringify({ error: { status: 401, message: 'The access token expired' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (/^https:\/\/api\.spotify\.com\/v1\/me\/player\/(?:play|pause|next|previous)(?:\?.*)?$/.test(String(url))
      || /^https:\/\/api\.spotify\.com\/v1\/me\/player\/seek\?position_ms=\d+$/.test(String(url))) {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected upstream request: ${url}`);
};

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

(async () => {
  const server = require('../server');
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));

    const login = await request('/api/spotify/login?clientId=public-client-id');
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.location);
    assert.equal(authorize.searchParams.get('client_id'), 'public-client-id');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authorize.searchParams.get('code_challenge'));
    assert.ok(authorize.searchParams.get('state'));
    assert.equal(authorize.searchParams.get('client_secret'), null);
    assert.equal(authorize.searchParams.get('code_verifier'), null);

    const callback = await request('/api/spotify/callback?code=auth-code&state=' + encodeURIComponent(authorize.searchParams.get('state')));
    assert.equal(callback.status, 200);
    assert.ok(!callback.body.includes('http-access-token'));
    assert.ok(!callback.body.includes('http-refresh-token'));

    const status = await request('/api/spotify/status');
    assert.equal(status.status, 200);
    const statusData = JSON.parse(status.body);
    assert.equal(statusData.authorized, true);
    assert.equal(statusData.secureStorage, true);
    assert.equal(Object.prototype.hasOwnProperty.call(statusData, 'accessToken'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(statusData, 'refreshToken'), false);
    assert.deepEqual(saved[0], {
      clientId: 'public-client-id',
      refreshToken: 'http-refresh-token',
      authorizedAt: saved[0].authorizedAt,
    });

    const me = await request('/api/spotify/web-api/me');
    assert.equal(me.status, 200);
    assert.equal(JSON.parse(me.body).id, 'spotify-user');
    assert.ok(!me.body.includes('http-access-token'));

    const playBody = JSON.stringify({ uris: ['spotify:track:1'] });
    const play = await request('/api/spotify/web-api/me/player/play', {
      method: 'PUT',
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(playBody),
      },
      body: playBody,
    });
    assert.equal(play.status, 204);
    const playUpstream = upstreamCalls.find(call => call.url.endsWith('/v1/me/player/play'));
    assert.equal(playUpstream.options.headers.Authorization, 'Bearer http-access-token');

    for (const [route, method] of [['pause', 'PUT'], ['next', 'POST'], ['previous', 'POST']]) {
      const control = await request(`/api/spotify/web-api/me/player/${route}`, {
        method,
        headers: { Origin: `http://127.0.0.1:${port}` },
      });
      assert.equal(control.status, 204, `${route} control failed`);
      const upstream = upstreamCalls.find(call => call.url.endsWith(`/v1/me/player/${route}`));
      assert.equal(upstream.options.headers.Authorization, 'Bearer http-access-token');
    }

    const seek = await request('/api/spotify/web-api/me/player/seek?position_ms=187650', {
      method: 'PUT',
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(seek.status, 204, 'Spotify seek proxy failed');
    const seekUpstream = upstreamCalls.find(call => call.url.endsWith('/v1/me/player/seek?position_ms=187650'));
    assert.ok(seekUpstream, 'Spotify seek must preserve the validated position_ms query');
    assert.equal(seekUpstream.options.headers.Authorization, 'Bearer http-access-token');

    const rejected = await request('/api/spotify/web-api/me/player/play', {
      method: 'PUT',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(rejected.status, 403);
    assert.equal(JSON.parse(rejected.body).error, 'SPOTIFY_PROXY_ORIGIN_REJECTED');

    const rejectedLogout = await request('/api/spotify/logout', {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(rejectedLogout.status, 403);
    assert.equal(cleared, 0, 'cross-origin logout must not clear secure credentials');

    const logout = await request('/api/spotify/logout', {
      method: 'DELETE',
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(logout.status, 200);
    assert.equal(cleared, 1, 'logout must clear the encrypted refresh credential');
    const loggedOutStatus = JSON.parse((await request('/api/spotify/status')).body);
    assert.equal(loggedOutStatus.authorized, false);

    const relogin = await request('/api/spotify/login?clientId=public-client-id');
    const reauthorize = new URL(relogin.headers.location);
    const recallback = await request('/api/spotify/callback?code=second-auth-code&state=' + encodeURIComponent(reauthorize.searchParams.get('state')));
    assert.equal(recallback.status, 200);
    const expired = await request('/api/spotify/web-api/me/player/currently-playing');
    assert.equal(expired.status, 401, 'revoked refresh credentials must be normalized to unauthorized');
    assert.equal(JSON.parse(expired.body).error, 'invalid_grant');
    assert.equal(cleared, 2, 'invalid_grant must clear the encrypted refresh credential');
    const expiredStatus = JSON.parse((await request('/api/spotify/status')).body);
    assert.equal(expiredStatus.authorized, false);

    console.log('Spotify PKCE HTTP routes: PASS');
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete global.__mineradioSpotifyAuthStore;
  }
})().catch(error => {
  console.error(`Spotify PKCE HTTP routes: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
