'use strict';

const assert = require('assert/strict');
const { app, safeStorage } = require('electron');

app.whenReady().then(() => {
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true, 'Electron safeStorage encryption is unavailable');
    const encrypted = safeStorage.encryptString('spotify-safe-storage-smoke');
    assert.ok(Buffer.isBuffer(encrypted));
    assert.ok(!encrypted.toString('utf8').includes('spotify-safe-storage-smoke'));
    assert.equal(safeStorage.decryptString(encrypted), 'spotify-safe-storage-smoke');
    console.log('Electron Spotify safeStorage runtime: PASS');
  } finally {
    app.quit();
  }
}).catch(error => {
  console.error(`Electron Spotify safeStorage runtime: FAIL\n${error.stack || error.message}`);
  app.exit(1);
});
