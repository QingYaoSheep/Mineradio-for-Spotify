'use strict';

(function migrateSpotifyOnlyRendererSettings() {
  const migrationKey = 'mineradio-spotify-only-v2-settings-migrated';
  try {
    if (localStorage.getItem(migrationKey) === '1') return;
    if (!window.desktopWindow || typeof window.desktopWindow.saveMigrationSettingsSnapshot !== 'function') return;
    const values = {};
    const localRemoveKeys = [];
    const secretKeyPattern = /(?:cookie|token|secret|credential|oauth|refresh|access|login|music[_-]?u|qm[_-]?(?:key|keyst))/i;
    const deprecatedKeyPattern = /(?:weather|playback-quality|netease|qqmusic|kugou|qishui|provider-account)/i;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (secretKeyPattern.test(key) || deprecatedKeyPattern.test(key)) {
        localRemoveKeys.push(key);
        continue;
      }
      if (key === 'apex-player-volume' || key.startsWith('mineradio-')) values[key] = localStorage.getItem(key);
    }
    window.desktopWindow.saveMigrationSettingsSnapshot(values).then((result) => {
      if (!result || !result.ok) return;
      localRemoveKeys.concat(result.removeKeys || []).forEach((key) => {
        try { localStorage.removeItem(key); } catch (error) {}
      });
      Object.entries(result.replaceValues || {}).forEach(([key, value]) => {
        try { localStorage.setItem(key, value); } catch (error) {}
      });
      localStorage.setItem(migrationKey, '1');
    }).catch(() => {});
  } catch (error) {}
})();
