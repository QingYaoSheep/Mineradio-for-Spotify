const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { LyricCache } = require('../lyric-cache');

function openPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForResponse(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited with ${child.exitCode}`);
    try { return await fetch(url); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('Server did not start');
}

(async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lyric-http-'));
  const port = await openPort();
  const cache = new LyricCache({ dir: cacheDir });
  cache.set('qq:mid:cached-mid', {
    provider: 'qq',
    mid: 'cached-mid',
    lyric: '',
    qrc: '[0,1000]Cached(0,1000)',
    tlyric: '[00:00]缓存翻译',
    source: 'fixture',
  });
  const child = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MINERADIO_LYRIC_CACHE_DIR: cacheDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const statusResponse = await waitForResponse(`http://127.0.0.1:${port}/api/lyric/cache/status`, child);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.entries, 1);
    assert.equal(status.maxBytes, 100 * 1024 * 1024);

    const lyricResponse = await fetch(`http://127.0.0.1:${port}/api/qq/lyric?mid=cached-mid`);
    const lyric = await lyricResponse.json();
    assert.equal(lyric.qrc, '[0,1000]Cached(0,1000)');
    assert.equal(lyric.cache.hit, true, 'The public lyric endpoint should serve a persistent cache hit');

    const clearResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache`, { method: 'DELETE' });
    assert.equal(clearResponse.status, 200);
    const cleared = await clearResponse.json();
    assert.equal(cleared.entries, 0);
    console.log('Lyric cache HTTP: PASS');
  } finally {
    child.kill();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    if (stderr && child.exitCode != null && child.exitCode !== 0) process.stderr.write(stderr);
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
