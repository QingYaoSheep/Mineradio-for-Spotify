'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeStorefront(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : '';
}

function normalizeAppleMusicAuth(value) {
  if (!value || typeof value !== 'object') return null;
  const mediaUserToken = String(value.mediaUserToken || '').trim();
  if (mediaUserToken.length < 50 || mediaUserToken.length > 8192) return null;
  return {
    mediaUserToken,
    storefrontOverride: normalizeStorefront(value.storefrontOverride),
    validatedStorefront: normalizeStorefront(value.validatedStorefront),
    validatedAt: Math.max(0, Number(value.validatedAt) || 0),
  };
}

class AppleMusicSecureAuthStore {
  constructor(options = {}) {
    this.filePath = path.resolve(String(options.filePath || ''));
    this.safeStorage = options.safeStorage || null;
    this.fs = options.fs || fs;
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
      return normalizeAppleMusicAuth(JSON.parse(this.safeStorage.decryptString(encrypted)));
    } catch (_) {
      return null;
    }
  }

  save(value) {
    const normalized = normalizeAppleMusicAuth(value);
    if (!normalized || !this.isAvailable()) return false;
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    this.fs.mkdirSync(directory, { recursive: true });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(normalized));
    try {
      this.fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      this.fs.renameSync(temporaryPath, this.filePath);
      return true;
    } finally {
      try { this.fs.rmSync(temporaryPath, { force:true }); } catch (_) {}
    }
  }

  clear() {
    try { this.fs.rmSync(this.filePath, { force: true }); } catch (_) {}
    try {
      const directory = path.dirname(this.filePath);
      const prefix = `${path.basename(this.filePath)}.`;
      this.fs.readdirSync(directory).forEach((name) => {
        if (name.startsWith(prefix) && name.endsWith('.tmp')) {
          try { this.fs.rmSync(path.join(directory, name), { force:true }); } catch (_) {}
        }
      });
    } catch (_) {}
  }
}

function createMemoryAppleMusicAuthStore() {
  let value = null;
  return {
    isAvailable: () => false,
    load: () => value,
    save: (next) => { value = normalizeAppleMusicAuth(next); return false; },
    clear: () => { value = null; },
  };
}

module.exports = {
  AppleMusicSecureAuthStore,
  createMemoryAppleMusicAuthStore,
  normalizeAppleMusicAuth,
  normalizeStorefront,
};
