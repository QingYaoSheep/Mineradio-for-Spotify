'use strict';

const { parseAppleMusicTtml } = require('./apple-music-ttml');
const { normalizeStorefront } = require('./apple-music-secure-auth-store');

const APPLE_MUSIC_ORIGIN = 'https://music.apple.com';
const APPLE_MUSIC_API = 'https://amp-api.music.apple.com';
const APPLE_MUSIC_LANGUAGE = 'zh-Hans-CN';
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_RESPONSE_LIMIT = 8 * 1024 * 1024;

class AppleMusicLyricsError extends Error {
  constructor(code, message, status, retryable = false) {
    super(message || code);
    this.name = 'AppleMusicLyricsError';
    this.code = code;
    this.status = Number(status) || 0;
    this.retryable = retryable === true;
  }
}

function extractAppleMusicBearerToken(source) {
  const match = String(source || '').match(/eyJ[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{20,}/);
  return match ? match[0] : '';
}

function appleMusicAssetUrl(html) {
  const matches = Array.from(String(html || '').matchAll(/["']([^"']*\/assets\/index[^"']+?\.js(?:\?[^"']*)?)["']/gi));
  if (!matches.length) return '';
  try { return new URL(matches[matches.length - 1][1], `${APPLE_MUSIC_ORIGIN}/`).toString(); }
  catch (_) { return ''; }
}

function errorForStatus(status) {
  status = Number(status) || 0;
  if (status === 401) return new AppleMusicLyricsError('APPLE_MUSIC_AUTH_EXPIRED', 'Apple Music User Token 已失效', status, true);
  if (status === 403) return new AppleMusicLyricsError('APPLE_MUSIC_AUTH_EXPIRED', 'Apple Music User Token 已失效', status, true);
  if (status === 404) return new AppleMusicLyricsError('APPLE_MUSIC_LYRIC_NOT_FOUND', 'Apple Music 没有可用歌词', status, false);
  if (status === 429) return new AppleMusicLyricsError('APPLE_MUSIC_RATE_LIMITED', 'Apple Music 请求过于频繁', status, true);
  return new AppleMusicLyricsError('APPLE_MUSIC_REQUEST_FAILED', `Apple Music request failed (${status || 'network'})`, status, status >= 500);
}

function sanitizedStatus(auth, storeAvailable, lastFailure) {
  return {
    configured: Boolean(auth && auth.mediaUserToken),
    encrypted: Boolean(storeAvailable),
    valid: Boolean(auth && auth.mediaUserToken && auth.validatedAt && !lastFailure),
    storefront: normalizeStorefront(auth && (auth.storefrontOverride || auth.validatedStorefront)),
    detectedStorefront: normalizeStorefront(auth && auth.validatedStorefront),
    storefrontOverride: normalizeStorefront(auth && auth.storefrontOverride),
    validatedAt: Math.max(0, Number(auth && auth.validatedAt) || 0),
    error: lastFailure ? String(lastFailure.code || 'APPLE_MUSIC_AUTH_FAILED') : '',
  };
}

async function readResponseTextLimited(response, maxBytes, abortController) {
  maxBytes = Math.max(1, Number(maxBytes) || DEFAULT_RESPONSE_LIMIT);
  const contentLength = Number(response && response.headers && response.headers.get('content-length')) || 0;
  if (contentLength > maxBytes) {
    if (abortController) abortController.abort();
    throw new AppleMusicLyricsError('APPLE_MUSIC_RESPONSE_TOO_LARGE', 'Apple Music response exceeds size limit', 502, false);
  }
  const body = response && response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = Buffer.from(part.value || []);
        total += chunk.length;
        if (total > maxBytes) {
          if (abortController) abortController.abort();
          try { await reader.cancel(); } catch (_) {}
          throw new AppleMusicLyricsError('APPLE_MUSIC_RESPONSE_TOO_LARGE', 'Apple Music response exceeds size limit', 502, false);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, total).toString('utf8');
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    if (abortController) abortController.abort();
    throw new AppleMusicLyricsError('APPLE_MUSIC_RESPONSE_TOO_LARGE', 'Apple Music response exceeds size limit', 502, false);
  }
  return text;
}

class AppleMusicLyricsProvider {
  constructor(options = {}) {
    this.store = options.store;
    this.fetch = options.fetch || globalThis.fetch;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.bearerToken = '';
    this.bearerExpiresAt = 0;
    this.lastFailure = null;
  }

  auth() {
    return this.store && typeof this.store.load === 'function' ? this.store.load() : null;
  }

  status() {
    return sanitizedStatus(this.auth(), this.store && this.store.isAvailable && this.store.isAvailable(), this.lastFailure);
  }

  clear() {
    if (this.store && typeof this.store.clear === 'function') this.store.clear();
    this.lastFailure = null;
    return this.status();
  }

  async fetchText(url, options = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_RESPONSE_LIMIT);
    const fetchOptions = Object.assign({}, options);
    delete fetchOptions.maxBytes;
    try {
      const response = await this.fetch(url, Object.assign({}, fetchOptions, {
        signal: controller ? controller.signal : options.signal,
      }));
      const text = await readResponseTextLimited(response, maxBytes, controller);
      return { response, text };
    } catch (error) {
      if (error instanceof AppleMusicLyricsError) throw error;
      const timedOut = error && error.name === 'AbortError';
      throw new AppleMusicLyricsError(
        timedOut ? 'APPLE_MUSIC_TIMEOUT' : 'APPLE_MUSIC_NETWORK_FAILED',
        timedOut ? 'Apple Music request timed out' : 'Apple Music network request failed',
        0,
        true
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getBearerToken(force = false) {
    if (!force && this.bearerToken && this.bearerExpiresAt > this.now()) return this.bearerToken;
    const home = await this.fetchText(`${APPLE_MUSIC_ORIGIN}/`, {
      headers: { 'User-Agent':'Mozilla/5.0', Accept:'text/html' },
      maxBytes:2 * 1024 * 1024,
    });
    if (!home.response.ok) throw errorForStatus(home.response.status);
    let token = extractAppleMusicBearerToken(home.text);
    if (!token) {
      const asset = appleMusicAssetUrl(home.text);
      if (!asset) throw new AppleMusicLyricsError('APPLE_MUSIC_BEARER_UNAVAILABLE', 'Apple Music 网页令牌不可用', 502, true);
      const script = await this.fetchText(asset, {
        headers: { 'User-Agent':'Mozilla/5.0', Referer:`${APPLE_MUSIC_ORIGIN}/` },
        maxBytes:16 * 1024 * 1024,
      });
      if (!script.response.ok) throw errorForStatus(script.response.status);
      token = extractAppleMusicBearerToken(script.text);
    }
    if (!token) throw new AppleMusicLyricsError('APPLE_MUSIC_BEARER_UNAVAILABLE', 'Apple Music 网页令牌不可用', 502, true);
    this.bearerToken = token;
    this.bearerExpiresAt = this.now() + 30 * 60 * 1000;
    return token;
  }

  async requestJson(pathname, options = {}) {
    const auth = options.auth || this.auth();
    if (!auth || !auth.mediaUserToken) throw new AppleMusicLyricsError('APPLE_MUSIC_AUTH_REQUIRED', '请先配置 Apple Music User Token', 401, false);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const bearer = await this.getBearerToken(attempt > 0 && lastError && (lastError.status === 401 || lastError.status === 403));
        const result = await this.fetchText(new URL(pathname, APPLE_MUSIC_API).toString(), {
          method: options.method || 'GET',
          headers: {
            Accept: 'application/json',
            Origin: APPLE_MUSIC_ORIGIN,
            Referer: `${APPLE_MUSIC_ORIGIN}/`,
            Authorization: `Bearer ${bearer}`,
            Cookie: `media-user-token=${auth.mediaUserToken}`,
          },
        });
        if (!result.response.ok) throw errorForStatus(result.response.status);
        try { return JSON.parse(result.text || '{}'); }
        catch (_) { throw new AppleMusicLyricsError('APPLE_MUSIC_INVALID_RESPONSE', 'Apple Music returned invalid JSON', 502, true); }
      } catch (error) {
        lastError = error instanceof AppleMusicLyricsError
          ? error
          : new AppleMusicLyricsError('APPLE_MUSIC_NETWORK_FAILED', 'Apple Music network request failed', 0, true);
        if (!lastError.retryable || attempt > 0) break;
      }
    }
    if (lastError && (lastError.code === 'APPLE_MUSIC_AUTH_EXPIRED' || lastError.code === 'APPLE_MUSIC_AUTH_REQUIRED')) {
      this.lastFailure = lastError;
    }
    throw lastError;
  }

  async validateAndSave(input = {}) {
    const existing = this.auth();
    const mediaUserToken = String(input.mediaUserToken || existing && existing.mediaUserToken || '').trim();
    const storefrontOverride = normalizeStorefront(input.storefrontOverride);
    if (mediaUserToken.length < 50) throw new AppleMusicLyricsError('APPLE_MUSIC_TOKEN_INVALID', 'User Token 格式无效', 400, false);
    if (!this.store || typeof this.store.save !== 'function' ||
        typeof this.store.isAvailable !== 'function' || !this.store.isAvailable()) {
      throw new AppleMusicLyricsError('APPLE_MUSIC_SECURE_STORAGE_UNAVAILABLE', '安全本地存储不可用', 503, false);
    }
    const provisional = { mediaUserToken, storefrontOverride, validatedStorefront:'', validatedAt:0 };
    const body = await this.requestJson('/v1/me/storefront', { auth: provisional });
    const detected = normalizeStorefront(body && body.data && body.data[0] && body.data[0].id);
    if (!detected && !storefrontOverride) throw new AppleMusicLyricsError('APPLE_MUSIC_STOREFRONT_UNAVAILABLE', '无法识别 Apple Music Storefront', 502, false);
    const next = {
      mediaUserToken,
      storefrontOverride,
      validatedStorefront: detected,
      validatedAt: this.now(),
    };
    if (this.store.save(next) !== true) {
      throw new AppleMusicLyricsError('APPLE_MUSIC_SECURE_STORAGE_UNAVAILABLE', '安全本地存储不可用', 503, false);
    }
    this.lastFailure = null;
    return this.status();
  }

  async validateStored() {
    const auth = this.auth();
    if (!auth) throw new AppleMusicLyricsError('APPLE_MUSIC_AUTH_REQUIRED', '请先配置 Apple Music User Token', 401, false);
    return this.validateAndSave(auth);
  }

  storefront(auth) {
    return normalizeStorefront(auth && (auth.storefrontOverride || auth.validatedStorefront));
  }

  async search(options = {}) {
    const auth = this.auth();
    const storefront = this.storefront(auth);
    if (!storefront) throw new AppleMusicLyricsError('APPLE_MUSIC_STOREFRONT_UNAVAILABLE', '请先验证 Apple Music User Token', 400, false);
    const term = String(options.term || '').trim().slice(0, 300);
    if (!term) return [];
    const limit = Math.max(1, Math.min(20, Number(options.limit) || 12));
    const query = new URLSearchParams({ term, types:'songs', limit:String(limit), l:APPLE_MUSIC_LANGUAGE });
    const body = await this.requestJson(`/v1/catalog/${storefront}/search?${query}`, { auth });
    const data = body && body.results && body.results.songs && body.results.songs.data;
    return (Array.isArray(data) ? data : []).map((item) => {
      const attributes = item && item.attributes || {};
      return {
        provider:'apple',
        source:'apple',
        id:String(item && item.id || ''),
        name:String(attributes.name || ''),
        artist:String(attributes.artistName || ''),
        album:String(attributes.albumName || ''),
        duration:Math.max(0, Number(attributes.durationInMillis) || 0) / 1000,
        isrc:String(attributes.isrc || ''),
        storefront,
      };
    }).filter((item) => item.id && item.name);
  }

  async lyrics(options = {}) {
    const auth = this.auth();
    const storefront = normalizeStorefront(options.storefront) || this.storefront(auth);
    const id = String(options.id || '').trim();
    if (!storefront || !id) throw new AppleMusicLyricsError('APPLE_MUSIC_LYRIC_REQUEST_INVALID', 'Apple Music lyric request is incomplete', 400, false);
    const query = new URLSearchParams({ l:APPLE_MUSIC_LANGUAGE, extend:'ttmlLocalizations' });
    const body = await this.requestJson(`/v1/catalog/${storefront}/songs/${encodeURIComponent(id)}/syllable-lyrics?${query}`, { auth });
    const attributes = body && body.data && body.data[0] && body.data[0].attributes || {};
    const candidates = [attributes.ttmlLocalizations, attributes.ttml].map((item) => String(item || '').trim()).filter(Boolean);
    let parsed = null;
    let rawTtml = '';
    let parseError = null;
    for (const candidate of candidates) {
      try {
        parsed = parseAppleMusicTtml(candidate);
        rawTtml = candidate;
        break;
      } catch (error) {
        parseError = error;
      }
    }
    if (!parsed) throw new AppleMusicLyricsError('APPLE_MUSIC_TTML_INVALID', parseError && parseError.message || 'Apple Music TTML is unavailable', 502, false);
    return {
      provider:'apple',
      source:parsed.timingSource,
      id,
      storefront,
      locale:APPLE_MUSIC_LANGUAGE,
      timingSource:parsed.timingSource,
      hasTranslation:parsed.hasTranslation,
      structuredLines:parsed.lines,
      rawTtml,
      match:Object.assign({}, options.match || {}, { id, storefront }),
    };
  }
}

module.exports = {
  APPLE_MUSIC_LANGUAGE,
  AppleMusicLyricsError,
  AppleMusicLyricsProvider,
  extractAppleMusicBearerToken,
};
