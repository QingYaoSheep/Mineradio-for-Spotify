'use strict';

const fs = require('fs');
const path = require('path');

const V2_MIGRATION_ID = 'spotify-only-v2';
const MIGRATION_STATE_FILE = 'migration-state.json';
const BACKUP_DIRECTORY = 'migration-backups';

const SAFE_BACKUP_ENTRIES = Object.freeze([
  'lyric-cache',
  'romanization-overrides.json',
  'visual-presets.json',
  'user-presets.json',
  'settings.json',
  'window-state.json',
]);

const LEGACY_CREDENTIAL_FILES = Object.freeze([
  '.cookie',
  '.qq-cookie',
  '.netease-cookie',
  '.kugou-cookie',
  '.qishui-token',
  '.spotify-auth',
  '.spotify-token.json',
]);

const SETTINGS_SECRET_KEY_PATTERN = /(?:cookie|token|secret|credential|oauth|refresh|access|login|music[_-]?u|qm[_-]?(?:key|keyst))/i;
const SETTINGS_DEPRECATED_KEY_PATTERN = /(?:weather|playback-quality|netease|qqmusic|kugou|qishui|provider-account)/i;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function copyEntry(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) return false;
  const stat = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  } else if (stat.isFile()) {
    fs.copyFileSync(sourcePath, destinationPath);
  } else {
    return false;
  }
  return true;
}

function removeFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch (_) {
    return false;
  }
}

function sanitizeVersion(value) {
  return String(value || '2.0.0-preview')
    .trim()
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .slice(0, 80) || '2.0.0-preview';
}

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function migrationStatePath(userDataPath) {
  return path.join(userDataPath, MIGRATION_STATE_FILE);
}

function hasCompletedMigration(userDataPath) {
  const state = readJson(migrationStatePath(userDataPath));
  return Boolean(state && state.completed && state.migrationId === V2_MIGRATION_ID);
}

function createSafeBackup({ userDataPath, targetVersion, now }) {
  const createdAt = now();
  const backupRoot = path.join(
    userDataPath,
    BACKUP_DIRECTORY,
    sanitizeVersion(targetVersion),
    timestampForPath(createdAt)
  );
  const temporaryPath = `${backupRoot}.partial`;
  fs.mkdirSync(temporaryPath, { recursive: true });

  const copiedEntries = [];
  try {
    for (const relativePath of SAFE_BACKUP_ENTRIES) {
      if (copyEntry(
        path.join(userDataPath, relativePath),
        path.join(temporaryPath, relativePath)
      )) {
        copiedEntries.push(relativePath);
      }
    }
    writeJsonAtomic(path.join(temporaryPath, 'backup-manifest.json'), {
      schemaVersion: 1,
      migrationId: V2_MIGRATION_ID,
      targetVersion: String(targetVersion || ''),
      createdAt: createdAt.toISOString(),
      copiedEntries,
      excludedCredentialTypes: [
        'legacy provider cookies',
        'legacy provider tokens',
        'Spotify OAuth credentials',
      ],
    });
    fs.mkdirSync(path.dirname(backupRoot), { recursive: true });
    fs.renameSync(temporaryPath, backupRoot);
    return { backupPath: backupRoot, copiedEntries, createdAt };
  } catch (error) {
    try { fs.rmSync(temporaryPath, { recursive: true, force: true }); } catch (_) {}
    throw error;
  }
}

function purgeLegacyCredentialFiles({ userDataPath, appRoot }) {
  const removedCredentialTypes = new Set();
  const roots = [userDataPath, appRoot].filter(Boolean);
  for (const root of roots) {
    for (const fileName of LEGACY_CREDENTIAL_FILES) {
      const filePath = path.join(root, fileName);
      if (!fs.existsSync(filePath)) continue;
      if (removeFile(filePath)) {
        if (fileName.startsWith('.spotify')) removedCredentialTypes.add('plaintext Spotify auth');
        else removedCredentialTypes.add('legacy music provider auth');
      }
    }
  }
  return Array.from(removedCredentialTypes);
}

function runV2UserDataMigration(options = {}) {
  const userDataPath = path.resolve(String(options.userDataPath || ''));
  const appRoot = options.appRoot ? path.resolve(String(options.appRoot)) : '';
  const targetVersion = String(options.targetVersion || '2.0.0-preview');
  const now = typeof options.now === 'function' ? options.now : () => new Date();

  if (!userDataPath) {
    return { ok: false, changed: false, migrationId: V2_MIGRATION_ID, error: 'USER_DATA_PATH_REQUIRED' };
  }
  fs.mkdirSync(userDataPath, { recursive: true });
  if (hasCompletedMigration(userDataPath)) {
    return { ok: true, changed: false, migrationId: V2_MIGRATION_ID };
  }

  let backup = null;
  try {
    backup = createSafeBackup({ userDataPath, targetVersion, now });
    const removedCredentialTypes = purgeLegacyCredentialFiles({ userDataPath, appRoot });
    const state = {
      schemaVersion: 1,
      migrationId: V2_MIGRATION_ID,
      targetVersion,
      completed: true,
      completedAt: backup.createdAt.toISOString(),
      backupPath: backup.backupPath,
      copiedEntries: backup.copiedEntries,
      removedCredentialTypes,
    };
    writeJsonAtomic(migrationStatePath(userDataPath), state);
    return {
      ok: true,
      changed: true,
      migrationId: V2_MIGRATION_ID,
      backupPath: backup.backupPath,
      copiedEntries: backup.copiedEntries,
      removedCredentialTypes,
    };
  } catch (error) {
    return {
      ok: false,
      changed: false,
      migrationId: V2_MIGRATION_ID,
      backupPath: backup && backup.backupPath,
      error: String(error && error.message || error),
    };
  }
}

function rollbackV2UserDataMigration(options = {}) {
  const userDataPath = path.resolve(String(options.userDataPath || ''));
  const backupPath = path.resolve(String(options.backupPath || ''));
  if (!userDataPath || !backupPath || !fs.existsSync(backupPath)) {
    return { ok: false, error: 'VALID_BACKUP_REQUIRED' };
  }

  const manifest = readJson(path.join(backupPath, 'backup-manifest.json'));
  if (!manifest || manifest.migrationId !== V2_MIGRATION_ID || !Array.isArray(manifest.copiedEntries)) {
    return { ok: false, error: 'INVALID_BACKUP_MANIFEST' };
  }

  try {
    for (const relativePath of manifest.copiedEntries) {
      if (!SAFE_BACKUP_ENTRIES.includes(relativePath)) continue;
      copyEntry(path.join(backupPath, relativePath), path.join(userDataPath, relativePath));
    }
    return { ok: true, restoredEntries: manifest.copiedEntries.slice() };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function classifyRendererSettingKey(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return 'ignore';
  if (SETTINGS_SECRET_KEY_PATTERN.test(normalized)) return 'remove';
  if (SETTINGS_DEPRECATED_KEY_PATTERN.test(normalized)) return 'remove';
  if (normalized === 'apex-player-volume' || normalized.startsWith('mineradio-')) return 'preserve';
  return 'ignore';
}

function sanitizeRendererSettingValue(value) {
  if (typeof value !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_) {
    return /["']?(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|spotify[_-]?token)["']?\s*[:=]/i.test(value)
      ? null
      : value;
  }

  const scrub = input => {
    if (Array.isArray(input)) return input.map(scrub);
    if (!input || typeof input !== 'object') return input;
    const output = {};
    for (const [key, nestedValue] of Object.entries(input)) {
      if (SETTINGS_SECRET_KEY_PATTERN.test(key) || SETTINGS_DEPRECATED_KEY_PATTERN.test(key)) continue;
      output[key] = scrub(nestedValue);
    }
    return output;
  };
  return JSON.stringify(scrub(parsed));
}

function saveV2SettingsSnapshot(options = {}) {
  const userDataPath = path.resolve(String(options.userDataPath || ''));
  const values = options.values && typeof options.values === 'object' ? options.values : {};
  const state = readJson(migrationStatePath(userDataPath));
  const backupPath = state && state.migrationId === V2_MIGRATION_ID
    ? path.resolve(String(state.backupPath || ''))
    : '';
  if (!backupPath || !isPathInside(path.join(userDataPath, BACKUP_DIRECTORY), backupPath) || !fs.existsSync(backupPath)) {
    return { ok: false, error: 'MIGRATION_BACKUP_NOT_AVAILABLE', removeKeys: [] };
  }

  const safeValues = {};
  const removeKeys = [];
  const replaceValues = {};
  for (const [key, value] of Object.entries(values)) {
    const classification = classifyRendererSettingKey(key);
    if (classification === 'remove') {
      removeKeys.push(key);
      continue;
    }
    if (classification !== 'preserve') continue;
    const safeValue = sanitizeRendererSettingValue(value);
    if (safeValue == null) {
      removeKeys.push(key);
      continue;
    }
    safeValues[key] = safeValue;
    if (safeValue !== value) replaceValues[key] = safeValue;
  }

  try {
    writeJsonAtomic(path.join(backupPath, 'renderer-settings.json'), {
      schemaVersion: 1,
      migrationId: V2_MIGRATION_ID,
      values: safeValues,
    });
    return {
      ok: true,
      backupPath,
      preservedKeys: Object.keys(safeValues),
      removeKeys,
      replaceValues,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error && error.message || error),
      removeKeys: [],
      replaceValues: {},
    };
  }
}

module.exports = {
  V2_MIGRATION_ID,
  SAFE_BACKUP_ENTRIES,
  LEGACY_CREDENTIAL_FILES,
  runV2UserDataMigration,
  rollbackV2UserDataMigration,
  saveV2SettingsSnapshot,
};
