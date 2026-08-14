const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const TRANSLATION_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 4;
const MIGRATABLE_CACHE_SCHEMA_VERSIONS = new Set([2, 3, CACHE_SCHEMA_VERSION]);

function usefulTranslation(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, '');
  return Boolean(normalized && !/^[\/／]{2,}$/.test(normalized));
}

function payloadHasUsefulTranslation(payload) {
  if (usefulTranslation(payload && payload.tlyric)) return true;
  return Boolean(payload && Array.isArray(payload.structuredLines)
    && payload.structuredLines.some((line) => usefulTranslation(line && line.transText)));
}

const LYRIC_VERSION_TAGS = [
  ['live', /\blive\b|现场/i],
  ['remix', /\bremix(?:ed)?\b|混音/i],
  ['acoustic', /\bacoustic\b|不插电/i],
  ['instrumental', /\binstrumental\b|伴奏|纯音乐/i],
  ['karaoke', /\bkaraoke\b|卡拉\s*ok/i],
  ['remaster', /\bremaster(?:ed)?\b|重制/i],
  ['demo', /\bdemo\b|小样/i],
  ['edit', /\b(?:radio\s+)?edit\b|剪辑版/i],
  ['sped-up', /\bsped\s*up\b|加速版/i],
  ['slowed', /\bslowed(?:\s*(?:down|reverb(?:ed)?))?\b|慢速版/i],
  ['extended', /\bextended\b|加长版|延长版/i],
  ['piano', /\bpiano(?:\s+version)?\b|钢琴版/i],
  ['rerecorded', /\bre[- ]?recorded\b|\btaylor['’]?s\s+version\b|重录版|重新录制版/i],
  ['version', /\bversion\b|版本/i],
];

function normalizeLyricSongIdentityText(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function lyricSongVersionTags(title) {
  const text = String(title || '').normalize('NFKC');
  return LYRIC_VERSION_TAGS.filter((entry) => entry[1].test(text)).map((entry) => entry[0]).sort();
}

function lyricSongBaseTitle(title) {
  let text = String(title || '').normalize('NFKC');
  text = text.replace(/[（(【\[]([^）)】\]]*)[）)】\]]/g, (full, inner) => lyricSongVersionTags(inner).length ? ' ' : full);
  text = text
    .replace(/\b(?:feat|ft)\.?\s+.+$/i, ' ')
    .replace(/(?:-|—|_)\s*(?:live|remix(?:ed)?|acoustic|instrumental|karaoke|remaster(?:ed)?|demo|(?:radio\s+)?edit|sped\s*up|slowed|extended|piano(?:\s+version)?|re[- ]?recorded|taylor['’]?s\s+version|version)\b.*$/i, ' ')
    .replace(/(?:-|—|_)\s*(?:现场|混音|不插电|伴奏|纯音乐|重制|小样|剪辑版|加速版|慢速版|加长版|延长版|钢琴版|重录版|重新录制版|版本).*$/, ' ');
  return normalizeLyricSongIdentityText(text);
}

function lyricSongPrimaryArtist(song) {
  song = song || {};
  if (Array.isArray(song.artists) && song.artists.length) {
    const first = song.artists[0];
    const name = first && typeof first === 'object' ? first.name : first;
    if (name) return normalizeLyricSongIdentityText(name);
  }
  const primary = String(song.artist || '').split(/\s*\/\s*|\s*,\s*|、|&|\bfeat\.?\b|\bft\.?\b/i)[0] || '';
  return normalizeLyricSongIdentityText(primary);
}

function lyricSongDurationBucket(duration) {
  let seconds = Number(duration) || 0;
  if (seconds > 10000) seconds /= 1000;
  return seconds > 0 ? Math.round(seconds / 3) * 3 : 0;
}

function lyricSongCacheIdentity(song) {
  song = song || {};
  return {
    title: lyricSongBaseTitle(song.name || song.title),
    artist: lyricSongPrimaryArtist(song),
    versions: lyricSongVersionTags(song.name || song.title),
    duration: lyricSongDurationBucket(song.duration || song.dt),
  };
}

function lyricSongCacheKey(song) {
  const identity = lyricSongCacheIdentity(song);
  if (!identity.title && !identity.artist) return '';
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `song:v2:${digest}`;
}

class LyricCache {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(__dirname, '.lyric-cache'));
    this.maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.migratePayload = typeof options.migratePayload === 'function' ? options.migratePayload : null;
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
      if (!parsed || !MIGRATABLE_CACHE_SCHEMA_VERSIONS.has(parsed.version)) {
        const legacyEntries = parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
        Object.values(legacyEntries).forEach((entry) => {
          if (!entry || !entry.file) return;
          try { fs.unlinkSync(path.join(this.dir, entry.file)); } catch (error) {
            if (error && error.code !== 'ENOENT') console.warn('[LyricCache] legacy cleanup failed:', error.message);
          }
        });
        this.entries = {};
        this.saveIndex();
        return;
      }
      this.entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
      if (parsed.version !== CACHE_SCHEMA_VERSION) this.saveIndex();
    } catch (error) {
      this.entries = {};
    }
    let changed = false;
    Object.keys(this.entries).forEach((key) => {
      const entry = this.entries[key];
      if (!entry || !entry.file || !fs.existsSync(path.join(this.dir, entry.file))
          || entry.ttmlFile && !fs.existsSync(path.join(this.dir, entry.ttmlFile))) {
        delete this.entries[key];
        changed = true;
      }
    });
    if (changed) this.saveIndex();
  }

  saveIndex() {
    this.ensureDir();
    const temp = `${this.indexFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: CACHE_SCHEMA_VERSION, entries: this.entries }));
      fs.renameSync(temp, this.indexFile);
      this.lastIndexSavedAt = this.now();
    } catch (error) {
      try { fs.unlinkSync(temp); } catch (cleanupError) {
        if (cleanupError && cleanupError.code !== 'ENOENT') console.warn('[LyricCache] index temp cleanup failed:', cleanupError.message);
      }
      throw error;
    }
  }

  fileForKey(key) {
    const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
    return `${digest}.${this.now()}.${crypto.randomBytes(4).toString('hex')}.json`;
  }

  ttmlFileForKey(key, contentHash) {
    const keyDigest = crypto.createHash('sha256').update(String(key)).digest('hex');
    const safeContentHash = /^[a-f0-9]{64}$/i.test(String(contentHash || ''))
      ? String(contentHash).toLowerCase()
      : crypto.createHash('sha256').update('').digest('hex');
    return `${keyDigest}.${safeContentHash.slice(0, 24)}.${this.now()}.${crypto.randomBytes(4).toString('hex')}.ttml`;
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
        revision: Number(meta.revision) || 0,
        size: meta.size,
        hasTtml: Boolean(meta.ttmlFile),
        ttmlFile: String(meta.ttmlFile || ''),
        ttmlHash: String(meta.ttmlHash || ''),
        ttmlSize: Number(meta.ttmlSize) || 0,
      },
    };
  }

  deleteEntryFiles(entry, options = {}) {
    if (!entry) return;
    [entry.file, entry.ttmlFile, entry.legacyBackup].forEach((file) => {
      if (!file) return;
      try {
        fs.unlinkSync(path.join(this.dir, file));
      } catch (error) {
        if (error && error.code === 'ENOENT') return;
        if (options.throwOnError) throw error;
        console.warn(`[LyricCache] ${options.warning || 'entry cleanup failed'}:`, error.message);
      }
    });
  }

  get(key) {
    key = String(key || '');
    const meta = this.entries[key];
    if (!meta) return null;
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(path.join(this.dir, meta.file), 'utf8'));
    } catch (error) {
      this.remove(key);
      return null;
    }
    if (this.migratePayload) {
      let migration = null;
      try {
        migration = this.migratePayload(payload, { key, meta:Object.assign({}, meta) });
      } catch (error) {
        console.warn('[LyricCache] payload migration failed:', error.message);
      }
      if (migration && migration.payload && migration.payload !== payload) {
        let createdBackup = '';
        if (migration.preserveOriginal === true && !meta.legacyBackup) {
          createdBackup = `${meta.file}.legacy-encrypted`;
          fs.copyFileSync(path.join(this.dir, meta.file), path.join(this.dir, createdBackup));
        }
        try {
          const migrated = this.set(key, migration.payload, {
            legacyBackup:meta.legacyBackup || createdBackup,
          });
          if (migrated) return migrated;
        } catch (error) {
          if (createdBackup) {
            try { fs.unlinkSync(path.join(this.dir, createdBackup)); } catch (_) {}
          }
          console.warn('[LyricCache] payload rewrite failed:', error.message);
        }
      }
    }
    meta.accessedAt = this.now();
    if (meta.accessedAt - this.lastIndexSavedAt >= 30000) {
      try { this.saveIndex(); } catch (error) { console.warn('[LyricCache] access time save failed:', error.message); }
    }
    return this.result(key, payload, meta);
  }

  set(key, payload, options = {}) {
    key = String(key || '');
    if (!key || !payload || typeof payload !== 'object') return null;
    this.ensureDir();
    const now = this.now();
    const file = this.fileForKey(key);
    const target = path.join(this.dir, file);
    const temp = `${target}.${process.pid}.tmp`;
    const serialized = JSON.stringify(payload);
    const previousEntries = this.entries;
    const previous = previousEntries[key] || {};
    const rawTtmlProvided = Object.prototype.hasOwnProperty.call(options, 'rawTtml');
    const rawTtml = rawTtmlProvided ? String(options.rawTtml || '') : '';
    const rawTtmlHash = rawTtml ? crypto.createHash('sha256').update(rawTtml).digest('hex') : '';
    const ttmlFile = rawTtml
      ? this.ttmlFileForKey(key, rawTtmlHash)
      : (!rawTtmlProvided ? String(previous.ttmlFile || '') : '');
    const ttmlTarget = rawTtml ? path.join(this.dir, ttmlFile) : '';
    const ttmlTemp = ttmlTarget ? `${ttmlTarget}.${process.pid}.tmp` : '';
    try {
      fs.writeFileSync(temp, serialized);
      if (ttmlTemp) fs.writeFileSync(ttmlTemp, rawTtml);
      fs.renameSync(temp, target);
      if (ttmlTemp) fs.renameSync(ttmlTemp, ttmlTarget);
    } catch (error) {
      [temp, target, ttmlTemp, ttmlTarget].filter(Boolean).forEach((candidate) => {
        try { fs.unlinkSync(candidate); } catch (_) {}
      });
      throw error;
    }
    const ttmlSize = rawTtml
      ? Buffer.byteLength(rawTtml)
      : (!rawTtmlProvided ? Number(previous.ttmlSize) || 0 : 0);
    const ttmlHash = rawTtml
      ? rawTtmlHash
      : (!rawTtmlProvided ? String(previous.ttmlHash || '') : '');
    const nextEntries = Object.assign({}, previousEntries);
    nextEntries[key] = {
      file,
      ttmlFile,
      ttmlSize,
      ttmlHash,
      size: Buffer.byteLength(serialized) + ttmlSize,
      createdAt: previous.createdAt || now,
      updatedAt: now,
      accessedAt: now,
      translationCheckedAt: now,
      hasTranslation: payloadHasUsefulTranslation(payload),
      revision: (Number(previous.revision) || 0) + 1,
      legacyBackup:String(options.legacyBackup || previous.legacyBackup || ''),
    };
    let total = Object.values(nextEntries).reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
    const evictedEntries = [];
    Object.keys(nextEntries)
      .sort((a, b) => (Number(nextEntries[a].accessedAt) || 0) - (Number(nextEntries[b].accessedAt) || 0))
      .forEach((entryKey) => {
        if (total <= this.maxBytes) return;
        const entry = nextEntries[entryKey];
        total -= Number(entry.size) || 0;
        evictedEntries.push(entry);
        delete nextEntries[entryKey];
      });
    this.entries = nextEntries;
    try {
      this.saveIndex();
    } catch (error) {
      this.entries = previousEntries;
      [target, rawTtml ? ttmlTarget : ''].filter(Boolean).forEach((candidate) => {
        try { fs.unlinkSync(candidate); } catch (cleanupError) {
          if (cleanupError && cleanupError.code !== 'ENOENT') console.warn('[LyricCache] payload rollback failed:', cleanupError.message);
        }
      });
      throw error;
    }
    const referencedFiles = new Set(Object.values(nextEntries).flatMap((entry) => [entry.file, entry.ttmlFile]).filter(Boolean));
    evictedEntries.forEach((entry) => {
      this.deleteEntryFiles(entry, { warning:'evicted entry cleanup failed' });
    });
    const obsoleteFiles = [];
    if (previous.file && previous.file !== file) obsoleteFiles.push(previous.file);
    if (previous.ttmlFile && previous.ttmlFile !== ttmlFile) obsoleteFiles.push(previous.ttmlFile);
    new Set(obsoleteFiles).forEach((obsoleteFile) => {
      if (!obsoleteFile || referencedFiles.has(obsoleteFile)) return;
      try { fs.unlinkSync(path.join(this.dir, obsoleteFile)); } catch (error) {
        if (error && error.code !== 'ENOENT') console.warn('[LyricCache] obsolete payload cleanup failed:', error.message);
      }
    });
    const meta = this.entries[key];
    return meta ? this.result(key, payload, meta) : null;
  }

  setIfUnchanged(key, payload, expectedRevision, options = {}) {
    key = String(key || '');
    const meta = this.entries[key];
    if (!meta || (Number(meta.revision) || 0) !== (Number(expectedRevision) || 0)) return null;
    return this.set(key, payload, options);
  }

  remove(key) {
    key = String(key || '');
    const meta = this.entries[key];
    if (!meta) return false;
    this.deleteEntryFiles(meta, { throwOnError:true });
    delete this.entries[key];
    this.saveIndex();
    return true;
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
      this.deleteEntryFiles(entry, { warning:'clear failed' });
    });
    this.entries = {};
    this.saveIndex();
    return { ok: true, ...this.status() };
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  TRANSLATION_RETRY_MS,
  CACHE_SCHEMA_VERSION,
  lyricSongCacheIdentity,
  lyricSongCacheKey,
  LyricCache,
};
