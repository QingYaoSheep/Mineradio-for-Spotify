'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  V2_MIGRATION_ID,
  runV2UserDataMigration,
  rollbackV2UserDataMigration,
  saveV2SettingsSnapshot,
} = require('../user-data-migration');

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-v2-migration-'));
const userDataPath = path.join(root, 'Mineradio');
const appRoot = path.join(root, 'app');
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(appRoot, { recursive: true });

try {
  write(userDataPath, '.cookie', 'MUSIC_U=secret-netease');
  write(userDataPath, '.qq-cookie', 'qm_keyst=secret-qq');
  write(userDataPath, '.spotify-auth.enc', 'encrypted-spotify-token');
  write(userDataPath, 'lyric-cache/song.json', '{"lyric":"kept"}');
  write(userDataPath, 'romanization-overrides.json', '{"韓":"han"}');
  write(userDataPath, 'visual-presets.json', '{"name":"黄金视觉"}');
  write(appRoot, '.cookie', 'repo-netease-secret');
  write(appRoot, '.qq-cookie', 'repo-qq-secret');
  write(appRoot, '.spotify-auth', '{"refreshToken":"plaintext-secret"}');

  const result = runV2UserDataMigration({
    userDataPath,
    appRoot,
    targetVersion: '2.0.0-preview.1',
    now: () => new Date('2026-07-28T08:00:00.000Z'),
  });

  assert.strictEqual(result.ok, true, 'migration should complete');
  assert.strictEqual(result.changed, true, 'first migration should change user data');
  assert.strictEqual(result.migrationId, V2_MIGRATION_ID);
  assert.ok(result.backupPath, 'migration should create a versioned backup');

  assert.strictEqual(exists(userDataPath, '.cookie'), false, 'NetEase cookie must be removed');
  assert.strictEqual(exists(userDataPath, '.qq-cookie'), false, 'QQ cookie must be removed');
  assert.strictEqual(exists(appRoot, '.cookie'), false, 'repo NetEase cookie must be removed');
  assert.strictEqual(exists(appRoot, '.qq-cookie'), false, 'repo QQ cookie must be removed');
  assert.strictEqual(exists(appRoot, '.spotify-auth'), false, 'plaintext Spotify auth must be removed');

  assert.strictEqual(read(userDataPath, '.spotify-auth.enc'), 'encrypted-spotify-token');
  assert.strictEqual(read(userDataPath, 'lyric-cache/song.json'), '{"lyric":"kept"}');
  assert.strictEqual(read(userDataPath, 'romanization-overrides.json'), '{"韓":"han"}');

  assert.strictEqual(
    read(result.backupPath, 'lyric-cache/song.json'),
    '{"lyric":"kept"}',
    'lyric cache should be backed up'
  );
  assert.strictEqual(
    read(result.backupPath, 'romanization-overrides.json'),
    '{"韓":"han"}',
    'romanization overrides should be backed up'
  );
  assert.strictEqual(
    read(result.backupPath, 'visual-presets.json'),
    '{"name":"黄金视觉"}',
    'visual presets should be backed up'
  );
  assert.strictEqual(
    exists(result.backupPath, '.spotify-auth.enc'),
    false,
    'Spotify encrypted auth is preserved in place but never copied into migration backups'
  );
  assert.strictEqual(exists(result.backupPath, '.cookie'), false, 'legacy credentials must not enter backups');
  assert.strictEqual(exists(result.backupPath, '.qq-cookie'), false, 'legacy credentials must not enter backups');

  const snapshot = saveV2SettingsSnapshot({
    userDataPath,
    values: {
      'mineradio-lyric-layout-v1': '{"preset":2}',
      'mineradio-user-fx-archives-v1': '[{"name":"黄金视觉"}]',
      'mineradio-old-layout-v1': '{"preset":3,"spotifyAccessToken":"embedded-access","nested":{"refreshToken":"embedded-refresh","theme":"dark"},"spotifyClientId":"public-client-id"}',
      'mineradio-weather-city': '上海',
      'mineradio-playback-quality-v1': 'hires',
      spotifyAccessToken: 'plain-access-token',
      'mineradio-qq-login-token': 'plain-provider-token',
      'apex-player-volume': '0.75',
    },
  });
  assert.strictEqual(snapshot.ok, true, 'renderer settings snapshot should be accepted after migration');
  assert.deepEqual(snapshot.removeKeys.sort(), [
    'mineradio-playback-quality-v1',
    'mineradio-qq-login-token',
    'mineradio-weather-city',
    'spotifyAccessToken',
  ]);
  assert.equal(
    snapshot.replaceValues['mineradio-old-layout-v1'],
    '{"preset":3,"nested":{"theme":"dark"},"spotifyClientId":"public-client-id"}',
    'sanitized nested settings should replace the renderer copy'
  );
  const savedSettings = JSON.parse(read(result.backupPath, 'renderer-settings.json'));
  assert.deepEqual(savedSettings.values, {
    'apex-player-volume': '0.75',
    'mineradio-lyric-layout-v1': '{"preset":2}',
    'mineradio-old-layout-v1': '{"preset":3,"nested":{"theme":"dark"},"spotifyClientId":"public-client-id"}',
    'mineradio-user-fx-archives-v1': '[{"name":"黄金视觉"}]',
  });
  assert.doesNotMatch(JSON.stringify(savedSettings), /plain-access-token|plain-provider-token|embedded-access|embedded-refresh/);

  write(userDataPath, 'visual-presets.json', '{"name":"changed-after-migration"}');
  const rollback = rollbackV2UserDataMigration({
    userDataPath,
    backupPath: result.backupPath,
  });
  assert.strictEqual(rollback.ok, true, 'rollback should restore safe user files');
  assert.strictEqual(read(userDataPath, 'visual-presets.json'), '{"name":"黄金视觉"}');
  assert.strictEqual(read(userDataPath, '.spotify-auth.enc'), 'encrypted-spotify-token');

  const repeated = runV2UserDataMigration({
    userDataPath,
    appRoot,
    targetVersion: '2.0.0-preview.1',
  });
  assert.strictEqual(repeated.ok, true);
  assert.strictEqual(repeated.changed, false, 'completed migration must be idempotent');

  console.log('v2 user-data migration verification passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
