'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AppleMusicSecureAuthStore } = require('../apple-music-secure-auth-store');
const {
  AppleMusicLyricsProvider,
  extractAppleMusicBearerToken,
} = require('../apple-music-lyrics-provider');
const { parseAppleMusicTtml } = require('../apple-music-ttml');
const { LyricCache } = require('../lyric-cache');

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
  <head><metadata><iTunesMetadata>
    <translations><translation xml:lang="zh-Hans"><text for="L1">你知道的</text></translation></translations>
  </iTunesMetadata></metadata></head>
  <body><div>
    <p begin="00:00:01.000" end="00:00:04.500" itunes:key="L1" ttm:agent="v1">
      <span begin="00:00:01.000" end="00:00:02.200">You </span><span begin="00:00:02.200" end="00:00:04.500">know</span>
    </p>
    <p begin="00:00:03.800" end="00:00:05.000" itunes:key="L2" ttm:agent="v2" ttm:role="x-bg">
      <span begin="00:00:03.800" end="00:00:05.000">(oh)</span>
    </p>
  </div></body>
</tt>`;

function response(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? contentType : '' },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
  };
}

async function main() {
  const parsed = parseAppleMusicTtml(TTML);
  assert.equal(parsed.timingSource, 'apple-ttml-word');
  assert.equal(parsed.hasTranslation, true);
  assert.equal(parsed.lines.length, 2);
  assert.deepEqual(parsed.lines[0].karaokeTimeline.map((word) => [word.text, word.start, word.duration]), [
    ['You ', 1, 1.2],
    ['know', 2.2, 2.3],
  ]);
  assert.equal(parsed.lines[0].transText, '你知道的');
  assert.equal(parsed.lines[1].isBG, true);
  assert.equal(parsed.lines[1].isDuet, true);
  const nested = parseAppleMusicTtml(`<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata><translations><translation xml:lang="zh-Hans"><text for="L1">主翻译<span ttm:role="x-bg">背景翻译</span></text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="5s" itunes:key="L1" ttm:agent="v1"><span begin="1s" end="2s">Main</span><span ttm:role="x-bg" ttm:agent="v2"><span begin="2.5s" end="4s">(back)</span></span></p><p begin="6s" end="8s" itunes:key="L2">Line only<span ttm:role="x-translation">逐行翻译</span></p></div></body></tt>`);
  assert.equal(nested.lines.length, 3);
  assert.equal(nested.lines[0].text, 'Main');
  assert.equal(nested.lines[0].transText, '主翻译');
  assert.equal(nested.lines[1].isBG, true);
  assert.equal(nested.lines[1].text, '(back)');
  assert.equal(nested.lines[1].transText, '背景翻译');
  assert.equal(nested.lines[2].source, 'apple-ttml-line');
  assert.equal(nested.lines[2].transText, '逐行翻译');
  const spaced = parseAppleMusicTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s"><span begin="1s" end="2s">Gold</span> <span begin="2s" end="3s">jewelry</span></p></div></body></tt>');
  assert.deepEqual(spaced.lines[0].karaokeTimeline.map((word) => word.text), ['Gold ', 'jewelry']);
  const partiallyBroken = parseAppleMusicTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s"><span begin="1s" end="2s">Broken </span><span begin="2s">line</span></p><p begin="4s" end="5s"><span begin="4s" end="5s">Valid</span></p></div></body></tt>');
  assert.equal(partiallyBroken.lines[0].source, 'apple-ttml-line');
  assert.equal(partiallyBroken.lines[0].karaokeTimeline.length, 0);
  assert.equal(partiallyBroken.lines[1].source, 'apple-ttml-word');
  const missingWordTime = parseAppleMusicTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s"><span begin="1s" end="2s">Timed </span><span>untimed</span></p></div></body></tt>');
  assert.equal(missingWordTime.lines[0].source, 'apple-ttml-line',
    'A lyric line with any untimed leaf word should downgrade only that line');
  assert.equal(missingWordTime.lines[0].karaokeTimeline.length, 0);
  assert.throws(() => parseAppleMusicTtml('<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///etc/passwd">]><tt>&x;</tt>'), /DOCTYPE|ENTITY/i);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-apple-source-'));
  const authFile = path.join(temp, '.apple-music-lyrics-auth.enc');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0x5a),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString('utf8'),
  };
  const authStore = new AppleMusicSecureAuthStore({ filePath: authFile, safeStorage });
  assert.equal(authStore.save({
    mediaUserToken: 'm'.repeat(96),
    storefrontOverride: 'jp',
    validatedStorefront: 'us',
    validatedAt: 123,
  }), true);
  assert.equal(fs.readFileSync(authFile, 'utf8').includes('m'.repeat(20)), false);
  assert.deepEqual(authStore.load(), {
    mediaUserToken: 'm'.repeat(96),
    storefrontOverride: 'jp',
    validatedStorefront: 'us',
    validatedAt: 123,
  });
  const failedAuthFile = path.join(temp, '.apple-music-failed.enc');
  const failingStore = new AppleMusicSecureAuthStore({
    filePath:failedAuthFile,
    safeStorage,
    fs:Object.assign({}, fs, { renameSync:() => { throw new Error('rename failed'); } }),
  });
  assert.throws(() => failingStore.save({ mediaUserToken:'m'.repeat(96), validatedStorefront:'us' }), /rename failed/);
  assert.equal(fs.readdirSync(temp).some((name) => name.startsWith('.apple-music-failed.enc.') && name.endsWith('.tmp')), false,
    'A failed encrypted credential write must not leave a temporary token file');
  const abandonedTemp = `${authFile}.999.tmp`;
  fs.writeFileSync(abandonedTemp, Buffer.from('encrypted-placeholder'));
  authStore.clear();
  assert.equal(fs.existsSync(abandonedTemp), false, 'Clearing Apple credentials must remove abandoned encrypted temp files');
  assert.equal(authStore.save({ mediaUserToken:'m'.repeat(96), storefrontOverride:'jp', validatedStorefront:'us', validatedAt:123 }), true);

  let insecureFetches = 0;
  const unavailableProvider = new AppleMusicLyricsProvider({
    store: {
      isAvailable: () => false,
      load: () => null,
      save: () => false,
      clear() {},
    },
    fetch: async () => { insecureFetches += 1; throw new Error('must not fetch'); },
  });
  await assert.rejects(
    unavailableProvider.validateAndSave({ mediaUserToken:'m'.repeat(96) }),
    (error) => error && error.code === 'APPLE_MUSIC_SECURE_STORAGE_UNAVAILABLE',
    'The provider must reject credentials when Electron safeStorage is unavailable',
  );
  assert.equal(insecureFetches, 0, 'An unsavable credential must not be sent to Apple Music');

  const jwt = `eyJ${'a'.repeat(40)}.${'b'.repeat(40)}.${'c'.repeat(40)}`;
  assert.equal(extractAppleMusicBearerToken(`window.__token="${jwt}"`), jwt);
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === 'https://music.apple.com/') return response(200, '<script src="/assets/index-test.js"></script>', 'text/html');
    if (url === 'https://music.apple.com/assets/index-test.js') return response(200, `token='${jwt}'`, 'text/javascript');
    if (String(url).includes('/v1/me/storefront')) return response(200, { data: [{ id: 'us' }] });
    if (String(url).includes('/search?')) return response(200, { results: { songs: { data: [{
      id: '42', attributes: { name: 'Song', artistName: 'Singer', albumName: 'Album', durationInMillis: 201000, isrc: 'US-AAA-01' },
    }] } } });
    if (String(url).includes('/songs/42/syllable-lyrics')) return response(200, { data: [{ attributes: { ttml: '<tt/>', ttmlLocalizations: TTML } }] });
    throw new Error(`Unexpected request ${url}`);
  };
  const provider = new AppleMusicLyricsProvider({ store: authStore, fetch: fakeFetch });
  const boundedProvider = new AppleMusicLyricsProvider({
    store:authStore,
    fetch:async () => response(200, 'x'.repeat(65)),
  });
  await assert.rejects(
    boundedProvider.fetchText('https://example.invalid/oversized', { maxBytes:64 }),
    (error) => error && error.code === 'APPLE_MUSIC_RESPONSE_TOO_LARGE',
    'Apple responses must be bounded before parsing',
  );
  const validation = await provider.validateAndSave({ mediaUserToken: 'm'.repeat(96), storefrontOverride: 'jp' });
  assert.equal(validation.storefront, 'jp');
  const candidates = await provider.search({ term: 'Song Singer', limit: 8 });
  assert.equal(candidates[0].provider, 'apple');
  assert.equal(candidates[0].isrc, 'US-AAA-01');
  const lyricPayload = await provider.lyrics({ id: '42', match: candidates[0] });
  assert.equal(lyricPayload.provider, 'apple');
  assert.equal(lyricPayload.hasTranslation, true);
  assert.equal(lyricPayload.rawTtml, TTML);
  assert.equal(lyricPayload.structuredLines[0].transText, '你知道的');
  const authorizedRequest = requests.find((item) => item.url.includes('/syllable-lyrics'));
  assert.match(authorizedRequest.options.headers.Authorization, /^Bearer eyJ/);
  assert.equal(authorizedRequest.options.headers.Cookie, `media-user-token=${'m'.repeat(96)}`);

  let bearerHomes = 0;
  let protectedAttempts = 0;
  const refreshProvider = new AppleMusicLyricsProvider({
    store:authStore,
    fetch:async (url) => {
      if (String(url) === 'https://music.apple.com/') {
        bearerHomes += 1;
        return response(200, `token='${jwt}'`, 'text/html');
      }
      if (String(url).includes('/v1/me/storefront')) {
        protectedAttempts += 1;
        return protectedAttempts === 1
          ? response(401, { errors:[{ status:'401' }] })
          : response(200, { data:[{ id:'us' }] });
      }
      throw new Error(`Unexpected refresh request ${url}`);
    },
  });
  const refreshed = await refreshProvider.validateStored();
  assert.equal(refreshed.valid, true);
  assert.equal(protectedAttempts, 2, 'A 401 should retry the protected request once');
  assert.equal(bearerHomes, 2, 'The one 401 retry should refresh the in-memory Bearer token');
  let forbiddenHomes = 0;
  let forbiddenAttempts = 0;
  const refreshForbiddenProvider = new AppleMusicLyricsProvider({
    store:authStore,
    fetch:async (url) => {
      if (String(url) === 'https://music.apple.com/') {
        forbiddenHomes += 1;
        return response(200, `token='${jwt}'`, 'text/html');
      }
      if (String(url).includes('/v1/me/storefront')) {
        forbiddenAttempts += 1;
        return forbiddenAttempts === 1
          ? response(403, { errors:[{ status:'403' }] })
          : response(200, { data:[{ id:'us' }] });
      }
      throw new Error(`Unexpected 403 refresh request ${url}`);
    },
  });
  assert.equal((await refreshForbiddenProvider.validateStored()).valid, true);
  assert.equal(forbiddenAttempts, 2, 'A 403 should also retry once with a fresh Bearer token');
  assert.equal(forbiddenHomes, 2);

  const cache = new LyricCache({ dir: path.join(temp, 'cache'), maxBytes: 1024 * 1024, now: () => 1700000000000 });
  const stored = cache.set('song:test', {
    provider: 'apple',
    structuredLines: lyricPayload.structuredLines,
    cacheSelection: { mode: 'auto', policy: 'apple-beta:translation-required:jp:zh-Hans' },
  }, { rawTtml: TTML });
  assert.equal(stored.cache.hasTtml, true);
  assert.equal(stored.cache.ttmlHash.length, 64);
  assert.ok(stored.cache.ttmlFile.includes(stored.cache.ttmlHash.slice(0, 24)),
    'The TTML sidecar filename should include the content hash without exposing track metadata');
  assert.equal(fs.readFileSync(path.join(temp, 'cache', stored.cache.ttmlFile), 'utf8'), TTML);
  assert.equal(cache.get('song:test').payload.rawTtml, undefined);
  cache.set('song:test', { provider: 'qq', qrc: '[0,1000](0,1000,0)A' }, { rawTtml: '' });
  assert.equal(fs.existsSync(path.join(temp, 'cache', stored.cache.ttmlFile)), false);

  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(app, /provider === 'apple'/);
  assert.match(app, /apple-beta:[\s\S]{0,160}translation-required/);
  assert.match(html, /Apple Music 歌词源/);
  assert.match(html, /翻译优先/);
  assert.match(server, /\/api\/apple-music\/lyrics\/auth\/status/);
  assert.doesNotMatch(app, /localStorage[^\n]*media-user-token/i);
  assert.doesNotMatch(server, /console\.(?:log|warn|error)\([^\n]*mediaUserToken/i);

  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Apple Music TTML lyric source: PASS');
}

main().catch((error) => {
  console.error(`Apple Music TTML lyric source: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
