const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LyricCache, TRANSLATION_RETRY_MS, lyricSongCacheKey } = require('../lyric-cache');
const { sanitizeCachedLyricPayload } = require('../public/js/lyric-credit-filter');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lyric-cache-'));
const migratedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lyric-cache-v2-'));

try {
  let now = 1_000_000;

  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ lyric: '[00:00]Legacy line lyric' }));
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({
    version: 1,
    entries: {
      'qq:mid:legacy': { file: 'legacy.json', size: 42, createdAt: 1, updatedAt: 1, accessedAt: 1 },
    },
  }));
  const cache = new LyricCache({ dir: root, maxBytes: 900, now: () => now });
  assert.equal(cache.status().entries, 0, 'Legacy provider-candidate caches should be invalidated on schema upgrade');
  assert.equal(fs.existsSync(path.join(root, 'legacy.json')), false, 'Invalidated legacy payload files should be removed');

  fs.writeFileSync(path.join(migratedRoot, 'v2-payload.json'), JSON.stringify({
    provider:'qq',
    qrcEncrypted:'D6A2BE95D6447372A06696AD9B6EB9F910D4CA186FC7B8B1CB2D8FDCFC5BCB8B1856D8490F9C3EC0',
    romanization:{ engineVersion:'old', lines:[] },
  }));
  fs.writeFileSync(path.join(migratedRoot, 'index.json'), JSON.stringify({
    version:2,
    entries:{
      'song:v2:migrate':{
        file:'v2-payload.json',
        size:200,
        createdAt:1,
        updatedAt:1,
        accessedAt:1,
        revision:1,
      },
    },
  }));
  const { decryptQQMusicQrc } = require('../qq-lyric-codec');
  const migratedCache = new LyricCache({
    dir:migratedRoot,
    now:() => now,
    migratePayload(payload) {
      if (!payload.qrcEncrypted) return null;
      const next = Object.assign({}, payload, { qrc:decryptQQMusicQrc(payload.qrcEncrypted) });
      delete next.qrcEncrypted;
      return { payload:next, preserveOriginal:true };
    },
  });
  const migrated = migratedCache.get('song:v2:migrate');
  assert.match(migrated.payload.qrc, /Love\(1000,1000\)/,
    'A v2 encrypted QRC cache should be lazily rewritten as plaintext');
  assert.equal(migratedCache.status().entries, 1, 'A v2 cache upgrade must preserve the song entry');
  assert.equal(JSON.parse(fs.readFileSync(path.join(migratedRoot, 'index.json'), 'utf8')).version, 3);
  const migratedMeta = migratedCache.entries['song:v2:migrate'];
  assert.ok(migratedMeta.legacyBackup, 'Encrypted cache migration should retain a legacy backup');
  assert.equal(fs.existsSync(path.join(migratedRoot, migratedMeta.legacyBackup)), true);
  migratedCache.clear();
  assert.equal(fs.existsSync(path.join(migratedRoot, migratedMeta.legacyBackup)), false,
    'Clearing the cache should also remove encrypted legacy backups');
  const spotifyKey = lyricSongCacheKey({ name: 'Test Song (Live)', artist: 'Main Artist / Guest', duration: 240000, provider: 'spotify' });
  const qqKey = lyricSongCacheKey({ name: 'Test Song - Live', artist: 'Main Artist', duration: 241, provider: 'qq' });
  assert.equal(spotifyKey, qqKey, 'Equivalent songs from different providers should share one canonical cache key');
  assert.notEqual(spotifyKey, lyricSongCacheKey({ name: 'Test Song', artist: 'Main Artist', duration: 241 }),
    'A live version must not collide with the studio recording');
  assert.notEqual(spotifyKey, lyricSongCacheKey({ name: 'Test Song (Live)', artist: 'Cover Artist', duration: 241 }),
    'A cover by another primary artist must not collide with the original');
  assert.notEqual(
    lyricSongCacheKey({ name:'Test Song (Karaoke)', artist:'Main Artist', duration:241 }),
    lyricSongCacheKey({ name:'Test Song (Instrumental)', artist:'Main Artist', duration:241 }),
    'Distinct version tags must not collide in the canonical cache',
  );
  const sanitizedXmlQrc = sanitizeCachedLyricPayload({
    provider:'qq',
    qrc:'<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[0,800]韩文标题(0,800)&#10;[1000,1000]正文(1000,1000)"/></QrcInfos>',
    tlyric:'[00:00]歌词翻译QQ音乐版权所有\n[00:01]正文翻译',
  });
  assert.doesNotMatch(sanitizedXmlQrc.qrc, /韩文标题/,
    'Cached XML-wrapped QRC must apply the same first-line rule as plaintext QRC');
  assert.match(sanitizedXmlQrc.qrc, /正文\(1000,1000\)/);
  assert.equal(sanitizedXmlQrc.tlyric, '[00:00]\n[00:01]正文翻译');
  cache.set('qq:original', {
    provider: 'qq',
    qrc: '[0,1000]A(0,1000)',
    lyric: '',
    tlyric: '[00:00]翻译',
  });

  const restarted = new LyricCache({ dir: root, maxBytes: 900, now: () => now });
  const hit = restarted.get('qq:original');
  assert.equal(hit.payload.qrc, '[0,1000]A(0,1000)', 'Cached QRC should survive an application restart');
  assert.equal(hit.cache.key, 'qq:original');
  assert.equal(hit.cache.hasTranslation, true);
  assert.equal(restarted.shouldRefreshTranslation(hit), false, 'Complete cached lyrics should not be refreshed');

  restarted.set('song:v2:atomic', { provider:'qq', qrc:'[0,1000]Old(0,1000)', tlyric:'' });
  const saveIndex = restarted.saveIndex.bind(restarted);
  restarted.saveIndex = () => { throw new Error('simulated index failure'); };
  assert.throws(() => restarted.set('song:v2:atomic', { provider:'qq', qrc:'[0,1000]New(0,1000)', tlyric:'' }), /simulated index failure/);
  restarted.saveIndex = saveIndex;
  const afterFailedReplace = new LyricCache({ dir: root, maxBytes: 900, now: () => now });
  assert.match(afterFailedReplace.get('song:v2:atomic').payload.qrc, /Old/,
    'A failed index commit must leave the previous cache payload intact');

  const beforeManual = afterFailedReplace.get('song:v2:atomic');
  afterFailedReplace.set('song:v2:atomic', { provider:'netease', lyric:'[00:00]Manual', tlyric:'' });
  assert.equal(afterFailedReplace.setIfUnchanged('song:v2:atomic', { provider:'qq', qrc:'[0,1000]Late(0,1000)' }, beforeManual.cache.revision), null,
    'A stale background translation refresh must not overwrite a newer manual cache');
  assert.match(afterFailedReplace.get('song:v2:atomic').payload.lyric, /Manual/);

  restarted.set('qq:no-translation', { provider: 'qq', qrc: '[0,1000]B(0,1000)', tlyric: '' });
  const missingTranslation = restarted.get('qq:no-translation');
  assert.equal(restarted.shouldRefreshTranslation(missingTranslation), false, 'A missing translation should not retry immediately');
  now += TRANSLATION_RETRY_MS;
  assert.equal(restarted.shouldRefreshTranslation(restarted.get('qq:no-translation')), true,
    'A missing translation should be eligible for a background refresh after seven days');

  restarted.set('qq:large-a', { qrc: 'A'.repeat(520), tlyric: '' });
  now += 1;
  restarted.set('qq:large-b', { qrc: 'B'.repeat(520), tlyric: '' });
  const status = restarted.status();
  assert.ok(status.bytes <= 900, 'LRU eviction should enforce the configured cache size');
  assert.equal(restarted.get('qq:large-a'), null, 'The least recently used oversized entry should be evicted');
  assert.ok(restarted.get('qq:large-b'), 'The newest entry should remain cached');

  const cleared = restarted.clear();
  assert.equal(cleared.ok, true);
  assert.equal(restarted.status().entries, 0);
  console.log('Lyric cache: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(migratedRoot, { recursive: true, force: true });
}
