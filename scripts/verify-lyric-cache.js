const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LyricCache, TRANSLATION_RETRY_MS } = require('../lyric-cache');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lyric-cache-'));

try {
  let now = 1_000_000;
  const cache = new LyricCache({ dir: root, maxBytes: 900, now: () => now });
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
}
