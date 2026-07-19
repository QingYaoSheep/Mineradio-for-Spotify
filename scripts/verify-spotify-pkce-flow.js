'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SpotifyAuthSession } = require('../spotify-auth-session');
const { SpotifySecureAuthStore } = require('../spotify-secure-auth-store');

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

async function verifyPkceAuthRefreshAndControl() {
  let now = 1_000_000;
  const persisted = [];
  let persistedValue = null;
  const store = {
    isAvailable: () => true,
    load: () => persistedValue && JSON.parse(JSON.stringify(persistedValue)),
    save: value => {
      persistedValue = JSON.parse(JSON.stringify(value));
      persisted.push(persistedValue);
      return true;
    },
    clear() { persistedValue = null; },
  };
  const calls = [];
  let tokenExchangeCount = 0;
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://accounts.spotify.com/api/token') {
      const body = new URLSearchParams(options.body);
      if (body.get('grant_type') === 'authorization_code') {
        tokenExchangeCount += 1;
        return jsonResponse(200, { access_token: 'access-one', refresh_token: 'refresh-one', expires_in: 3600 });
      }
      if (body.get('grant_type') === 'refresh_token') {
        return jsonResponse(200, { access_token: 'access-two', expires_in: 3600 });
      }
    }
    if (/^https:\/\/api\.spotify\.com\/v1\/me\/player\/(?:play|pause|next|previous)$/.test(url)) {
      return jsonResponse(204, {});
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = new SpotifyAuthSession({
    store,
    fetch,
    now: () => now,
    randomBytes: size => Buffer.alloc(size, size),
    redirectUri: 'http://127.0.0.1:3144/api/spotify/callback',
  });

  const authorizationUrl = new URL(session.beginAuthorization('public-client-id'));
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));
  assert.ok(authorizationUrl.searchParams.get('state'));
  assert.equal(authorizationUrl.searchParams.get('client_secret'), null);
  assert.equal(authorizationUrl.searchParams.get('code_verifier'), null);

  await assert.rejects(
    session.completeAuthorization({ code: 'code-one', state: 'wrong-state' }),
    error => error.code === 'SPOTIFY_AUTH_STATE_MISMATCH'
  );
  assert.equal(tokenExchangeCount, 0, 'state mismatch must stop before token exchange');

  const secondAuthorizationUrl = new URL(session.beginAuthorization('public-client-id'));
  await session.completeAuthorization({
    code: 'code-two',
    state: secondAuthorizationUrl.searchParams.get('state'),
  });
  const exchange = calls.find(call => call.url === 'https://accounts.spotify.com/api/token');
  const exchangeBody = new URLSearchParams(exchange.options.body);
  assert.equal(exchange.options.headers.Authorization, undefined);
  assert.equal(exchangeBody.get('client_id'), 'public-client-id');
  assert.equal(exchangeBody.get('grant_type'), 'authorization_code');
  assert.ok(exchangeBody.get('code_verifier'));
  assert.deepEqual(persisted[0], {
    clientId: 'public-client-id',
    refreshToken: 'refresh-one',
    authorizedAt: now,
  }, 'only the refresh credential should be persisted');
  assert.ok(!JSON.stringify(persisted).includes('access-one'));

  await session.requestWebApi('/v1/me/player/play', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: ['spotify:track:1'] }),
  });
  const playCall = calls.find(call => call.url === 'https://api.spotify.com/v1/me/player/play');
  assert.equal(playCall.options.headers.Authorization, 'Bearer access-one');

  const restartedSession = new SpotifyAuthSession({
    store,
    fetch,
    now: () => now,
    redirectUri: 'http://127.0.0.1:3144/api/spotify/callback',
  });
  assert.equal(restartedSession.status().authorized, true, 'encrypted refresh credential must restore authorization after restart');
  await restartedSession.requestWebApi('/v1/me/player/pause', { method: 'PUT' });
  const refreshCall = calls.filter(call => call.url === 'https://accounts.spotify.com/api/token').at(-1);
  const refreshBody = new URLSearchParams(refreshCall.options.body);
  assert.equal(refreshBody.get('grant_type'), 'refresh_token');
  assert.equal(refreshBody.get('refresh_token'), 'refresh-one');
  assert.equal(refreshBody.get('client_id'), 'public-client-id');
  assert.equal(refreshCall.options.headers.Authorization, undefined);
  assert.equal(persisted.at(-1).refreshToken, 'refresh-one', 'refresh token must be retained when Spotify omits a replacement');
  assert.ok(!JSON.stringify(persisted).includes('access-two'), 'refreshed access token must remain memory-only');

  await restartedSession.requestWebApi('/v1/me/player/next', { method: 'POST' });
  await restartedSession.requestWebApi('/v1/me/player/previous', { method: 'POST' });
  for (const route of ['pause', 'next', 'previous']) {
    const control = calls.find(call => call.url === `https://api.spotify.com/v1/me/player/${route}`);
    assert.ok(control, `${route} control was not forwarded`);
    assert.equal(control.options.headers.Authorization, 'Bearer access-two');
  }
}

function verifyEncryptedStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-spotify-store-'));
  try {
    const filePath = path.join(directory, '.spotify-auth.enc');
    const legacyPath = path.join(directory, '.spotify-auth');
    fs.writeFileSync(legacyPath, '{"clientSecret":"must-be-removed"}');
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(String(value).slice('encrypted:'.length), 'base64').toString('utf8'),
    };
    const store = new SpotifySecureAuthStore({ filePath, safeStorage, legacyPaths: [legacyPath] });
    store.clearLegacyPlaintext();
    assert.equal(fs.existsSync(legacyPath), false);
    assert.equal(store.save({ clientId: 'public-id', refreshToken: 'refresh-secret', authorizedAt: 123 }), true);
    const disk = fs.readFileSync(filePath, 'utf8');
    assert.ok(!disk.includes('refresh-secret'), 'encrypted file must not contain plaintext refresh token');
    assert.deepEqual(store.load(), { clientId: 'public-id', refreshToken: 'refresh-secret', authorizedAt: 123 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async () => {
  verifyEncryptedStore();
  await verifyPkceAuthRefreshAndControl();
  console.log('Spotify PKCE auth, refresh and control: PASS');
})().catch(error => {
  console.error(`Spotify PKCE auth, refresh and control: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
