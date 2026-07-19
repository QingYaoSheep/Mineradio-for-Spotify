'use strict';

const fs = require('fs');
const path = require('path');

function normalizePersistedAuth(value) {
  if (!value || typeof value !== 'object') return null;
  const clientId = String(value.clientId || '').trim();
  const refreshToken = String(value.refreshToken || '').trim();
  if (!clientId || !refreshToken) return null;
  return {
    clientId,
    refreshToken,
    authorizedAt: Math.max(0, Number(value.authorizedAt) || 0),
  };
}

class SpotifySecureAuthStore {
  constructor(options = {}) {
    this.filePath = path.resolve(String(options.filePath || ''));
    this.safeStorage = options.safeStorage || null;
    this.fs = options.fs || fs;
    this.legacyPaths = (options.legacyPaths || []).map(item => path.resolve(String(item || ''))).filter(Boolean);
  }

  isAvailable() {
    try {
      return Boolean(
        this.safeStorage
        && typeof this.safeStorage.isEncryptionAvailable === 'function'
        && this.safeStorage.isEncryptionAvailable()
        && typeof this.safeStorage.encryptString === 'function'
        && typeof this.safeStorage.decryptString === 'function'
      );
    } catch (_) {
      return false;
    }
  }

  load() {
    if (!this.isAvailable() || !this.fs.existsSync(this.filePath)) return null;
    try {
      const encrypted = this.fs.readFileSync(this.filePath);
      const plaintext = this.safeStorage.decryptString(encrypted);
      return normalizePersistedAuth(JSON.parse(plaintext));
    } catch (_) {
      return null;
    }
  }

  save(value) {
    const normalized = normalizePersistedAuth(value);
    if (!normalized || !this.isAvailable()) return false;
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    this.fs.mkdirSync(directory, { recursive: true });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(normalized));
    this.fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
    this.fs.renameSync(temporaryPath, this.filePath);
    return true;
  }

  clear() {
    try { this.fs.rmSync(this.filePath, { force: true }); } catch (_) {}
  }

  clearLegacyPlaintext() {
    for (const legacyPath of this.legacyPaths) {
      if (!legacyPath || legacyPath === this.filePath) continue;
      try { this.fs.rmSync(legacyPath, { force: true }); } catch (_) {}
    }
  }
}

function createMemorySpotifyAuthStore() {
  let value = null;
  return {
    isAvailable: () => false,
    load: () => value,
    save: next => { value = normalizePersistedAuth(next); return false; },
    clear: () => { value = null; },
    clearLegacyPlaintext: () => {},
  };
}

module.exports = {
  SpotifySecureAuthStore,
  createMemorySpotifyAuthStore,
  normalizePersistedAuth,
};
