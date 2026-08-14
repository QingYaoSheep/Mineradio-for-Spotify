'use strict';

const crypto = require('crypto');

const SPOTIFY_ACCOUNTS_AUTHORIZE = 'https://accounts.spotify.com/authorize';
const SPOTIFY_ACCOUNTS_TOKEN = 'https://accounts.spotify.com/api/token';
const SPOTIFY_WEB_API = 'https://api.spotify.com';
const DEFAULT_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-read-private',
  'user-read-recently-played',
  'user-top-read',
];

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createPkcePair(randomBytes = crypto.randomBytes) {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function authError(message, status = 401, code = 'SPOTIFY_AUTH_REQUIRED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

class SpotifyAuthSession {
  constructor(options = {}) {
    this.store = options.store;
    this.fetch = options.fetch || global.fetch;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.redirectUri = String(options.redirectUri || '');
    this.scopes = Array.isArray(options.scopes) && options.scopes.length ? options.scopes : DEFAULT_SCOPES;
    this.pending = null;
    this.accessToken = '';
    this.expiresAt = 0;
    this.refreshPromise = null;
    const persisted = this.store && this.store.load ? this.store.load() : null;
    this.clientId = persisted ? persisted.clientId : '';
    this.refreshToken = persisted ? persisted.refreshToken : '';
    this.authorizedAt = persisted ? persisted.authorizedAt : 0;
  }

  setRedirectUri(value) {
    this.redirectUri = String(value || '');
  }

  beginAuthorization(clientId) {
    clientId = String(clientId || '').trim();
    if (!clientId) throw authError('Missing Spotify Client ID', 400, 'SPOTIFY_CLIENT_ID_REQUIRED');
    if (!this.redirectUri) throw authError('Missing Spotify redirect URI', 500, 'SPOTIFY_REDIRECT_URI_REQUIRED');
    const { verifier, challenge } = createPkcePair(this.randomBytes);
    const state = base64Url(this.randomBytes(32));
    this.pending = {
      clientId,
      verifier,
      state,
      expiresAt: this.now() + 10 * 60 * 1000,
    };
    const authUrl = new URL(SPOTIFY_ACCOUNTS_AUTHORIZE);
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: this.scopes.join(' '),
      redirect_uri: this.redirectUri,
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();
    return authUrl.toString();
  }

  async completeAuthorization({ code, state }) {
    const pending = this.pending;
    this.pending = null;
    if (!pending || pending.expiresAt < this.now()) {
      throw authError('Spotify authorization session expired', 400, 'SPOTIFY_AUTH_SESSION_EXPIRED');
    }
    const receivedState = Buffer.from(String(state || ''));
    const expectedState = Buffer.from(pending.state);
    if (receivedState.length !== expectedState.length || !crypto.timingSafeEqual(receivedState, expectedState)) {
      throw authError('Spotify authorization state mismatch', 400, 'SPOTIFY_AUTH_STATE_MISMATCH');
    }
    if (!code) throw authError('Spotify authorization code missing', 400, 'SPOTIFY_AUTH_CODE_MISSING');
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: this.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    });
    this.clientId = pending.clientId;
    this.accessToken = String(token.access_token || '');
    this.refreshToken = String(token.refresh_token || '');
    this.expiresAt = this.now() + Math.max(0, Number(token.expires_in) || 0) * 1000;
    this.authorizedAt = this.now();
    if (!this.accessToken || !this.refreshToken) {
      this.clear();
      throw authError('Spotify token response is incomplete', 502, 'SPOTIFY_TOKEN_INVALID');
    }
    this.persistRefreshToken();
    return this.status();
  }

  async requestToken(fields) {
    const response = await this.fetch(SPOTIFY_ACCOUNTS_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const error = authError(data.error_description || data.error || 'Spotify token request failed', response.status || 502, data.error || 'SPOTIFY_TOKEN_FAILED');
      throw error;
    }
    return data;
  }

  persistRefreshToken() {
    if (!this.store || !this.store.save || !this.refreshToken || !this.clientId) return false;
    return this.store.save({
      clientId: this.clientId,
      refreshToken: this.refreshToken,
      authorizedAt: this.authorizedAt,
    });
  }

  async refreshAccessToken() {
    if (!this.clientId || !this.refreshToken) throw authError('Spotify is not authorized');
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const token = await this.requestToken({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.clientId,
        });
        this.accessToken = String(token.access_token || '');
        if (token.refresh_token) this.refreshToken = String(token.refresh_token);
        this.expiresAt = this.now() + Math.max(0, Number(token.expires_in) || 0) * 1000;
        if (!this.accessToken) throw authError('Spotify refresh response is incomplete', 502, 'SPOTIFY_TOKEN_INVALID');
        this.persistRefreshToken();
        return this.accessToken;
      } catch (error) {
        if (error && error.code === 'invalid_grant') this.clear();
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async getAccessToken(options = {}) {
    if (!options.forceRefresh && this.accessToken && this.now() + 60_000 < this.expiresAt) return this.accessToken;
    return this.refreshAccessToken();
  }

  async requestWebApi(apiPath, options = {}) {
    const normalizedPath = String(apiPath || '');
    if (!normalizedPath.startsWith('/v1/')) throw authError('Invalid Spotify API path', 400, 'SPOTIFY_API_PATH_INVALID');
    const request = async forceRefresh => {
      const accessToken = await this.getAccessToken({ forceRefresh });
      const headers = Object.assign({}, options.headers || {}, { Authorization: `Bearer ${accessToken}` });
      return this.fetch(SPOTIFY_WEB_API + normalizedPath, Object.assign({}, options, { headers }));
    };
    let response = await request(false);
    if (response.status === 401 && this.refreshToken) response = await request(true);
    return response;
  }

  status() {
    return {
      authorized: Boolean(this.refreshToken || (this.accessToken && this.now() < this.expiresAt)),
      expiresAt: this.expiresAt,
      authorizedAt: this.authorizedAt,
      secureStorage: Boolean(this.store && this.store.isAvailable && this.store.isAvailable()),
    };
  }

  clear() {
    this.pending = null;
    this.clientId = '';
    this.accessToken = '';
    this.refreshToken = '';
    this.expiresAt = 0;
    this.authorizedAt = 0;
    if (this.store && this.store.clear) this.store.clear();
  }
}

module.exports = {
  SpotifyAuthSession,
  createPkcePair,
  DEFAULT_SCOPES,
  SPOTIFY_ACCOUNTS_TOKEN,
  SPOTIFY_WEB_API,
};
