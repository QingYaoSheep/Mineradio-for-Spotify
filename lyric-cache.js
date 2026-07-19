const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const TRANSLATION_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

function usefulTranslation(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, '');
  return Boolean(normalized && !/^[\/／]{2,}$/.test(normalized));
}

class LyricCache {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(__dirname, '.lyric-cache'));
    this.maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.indexFile = path.join(this.dir, 'index.json');
    this.entries = {};
    this.lastIndexSavedAt = 0;
    this.ensureDir();
    this.loadIndex();
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  loadIndex() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      this.entries = parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    } catch (error) {
      this.entries = {};
    }
    let changed = false;
    Object.keys(this.entries).forEach((key) => {
      const entry = this.entries[key];
      if (!entry || !entry.file || !fs.existsSync(path.join(this.dir, entry.file))) {
        delete this.entries[key];
        changed = true;
      }
    });
    if (changed) this.saveIndex();
  }

  saveIndex() {
    this.ensureDir();
    const temp = `${this.indexFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, entries: this.entries }));
    fs.renameSync(temp, this.indexFile);
    this.lastIndexSavedAt = this.now();
  }

  fileForKey(key) {
    return `${crypto.createHash('sha256').update(String(key)).digest('hex')}.json`;
  }

  result(key, payload, meta) {
    return {
      payload,
      cache: {
        key,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        accessedAt: meta.accessedAt,
        translationCheckedAt: meta.translationCheckedAt,
        hasTranslation: Boolean(meta.hasTranslation),
        size: meta.size,
      },
    };
  }

  get(key) {
    key = String(key || '');
    const meta = this.entries[key];
    if (!meta) return null;
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(this.dir, meta.file), 'utf8'));
      meta.accessedAt = this.now();
      if (meta.accessedAt - this.lastIndexSavedAt >= 30000) this.saveIndex();
      return this.result(key, payload, meta);
    } catch (error) {
      this.remove(key);
      return null;
    }
  }

  set(key, payload) {
    key = String(key || '');
    if (!key || !payload || typeof payload !== 'object') return null;
    this.ensureDir();
    const now = this.now();
    const file = this.fileForKey(key);
    const target = path.join(this.dir, file);
    const temp = `${target}.${process.pid}.tmp`;
    const serialized = JSON.stringify(payload);
    fs.writeFileSync(temp, serialized);
    fs.renameSync(temp, target);
    const previous = this.entries[key] || {};
    this.entries[key] = {
      file,
      size: Buffer.byteLength(serialized),
      createdAt: previous.createdAt || now,
      updatedAt: now,
      accessedAt: now,
      translationCheckedAt: now,
      hasTranslation: usefulTranslation(payload.tlyric),
    };
    this.evict();
    this.saveIndex();
    const meta = this.entries[key];
    return meta ? this.result(key, payload, meta) : null;
  }

  remove(key) {
    key = String(key || '');
    const meta = this.entries[key];
    if (!meta) return false;
    try { fs.unlinkSync(path.join(this.dir, meta.file)); } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
    delete this.entries[key];
    this.saveIndex();
    return true;
  }

  evict() {
    let total = Object.values(this.entries).reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
    if (total <= this.maxBytes) return;
    Object.keys(this.entries)
      .sort((a, b) => (Number(this.entries[a].accessedAt) || 0) - (Number(this.entries[b].accessedAt) || 0))
      .forEach((key) => {
        if (total <= this.maxBytes) return;
        const entry = this.entries[key];
        total -= Number(entry.size) || 0;
        try { fs.unlinkSync(path.join(this.dir, entry.file)); } catch (error) {
          if (error && error.code !== 'ENOENT') console.warn('[LyricCache] eviction failed:', error.message);
        }
        delete this.entries[key];
      });
  }

  shouldRefreshTranslation(entry) {
    if (!entry || !entry.cache || entry.cache.hasTranslation) return false;
    return this.now() - (Number(entry.cache.translationCheckedAt) || 0) >= TRANSLATION_RETRY_MS;
  }

  status() {
    const values = Object.values(this.entries);
    return {
      entries: values.length,
      bytes: values.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
      maxBytes: this.maxBytes,
      dir: this.dir,
    };
  }

  clear() {
    Object.values(this.entries).forEach((entry) => {
      try { fs.unlinkSync(path.join(this.dir, entry.file)); } catch (error) {
        if (error && error.code !== 'ENOENT') console.warn('[LyricCache] clear failed:', error.message);
      }
    });
    this.entries = {};
    this.saveIndex();
    return { ok: true, ...this.status() };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  TRANSLATION_RETRY_MS,
  LyricCache,
};
