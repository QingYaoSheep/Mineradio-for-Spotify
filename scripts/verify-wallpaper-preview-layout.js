'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const electronPath = require('electron');
  const testUserData = path.join(__dirname, `.tmp-wallpaper-preview-layout-${process.pid}`);
  const result = spawnSync(electronPath, [__filename, '--electron-child'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      MINERADIO_LAYOUT_TEST_USER_DATA: testUserData,
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch (_) {}
  process.exit(result.status == null ? 1 : result.status);
}

const { app, BrowserWindow } = require('electron');
const testUserData = process.env.MINERADIO_LAYOUT_TEST_USER_DATA
  || path.join(__dirname, `.tmp-wallpaper-preview-layout-${process.pid}`);
app.setPath('userData', testUserData);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const cardCount = Math.max(1, Number(process.env.WALLPAPER_PREVIEW_CARD_COUNT) || 79);
  const cards = Array.from({ length: cardCount }, (_, index) => [
    '<article class="wallpaper-library-card">',
    `<div class="wallpaper-library-preview" style="background-image:linear-gradient(${index}deg,#345,#89a)"></div>`,
    '<div class="wallpaper-library-meta"><strong>Wallpaper</strong><small>SCENE</small></div>',
    '<div class="wallpaper-library-card-actions"><button>启用</button><button>详情</button><button>隐藏</button></div>',
    '</article>',
  ].join('')).join('');
  const documentHtml = [
    '<!doctype html><html><body>',
    '<div class="modal-mask show">',
    '<section class="wallpaper-engine-library-modal">',
    '<header class="wallpaper-engine-library-head"><div><h2>本地壁纸资源库</h2><p>Wallpaper Engine</p></div></header>',
    '<div class="wallpaper-engine-toolbar"><input id="wallpaper-engine-search"></div>',
    `<div class="wallpaper-engine-library-status">已索引 ${cardCount} 个项目</div>`,
    `<div class="wallpaper-library-grid">${cards}</div>`,
    '</section></div></body></html>',
  ].join('');
  await window.loadURL('about:blank');
  await window.webContents.executeJavaScript(
    `document.open(); document.write(${JSON.stringify(documentHtml)}); document.close();`
  );
  await window.webContents.insertCSS(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'index.css'), 'utf8')
  );
  if (process.env.WALLPAPER_PREVIEW_PROBE_CSS) {
    await window.webContents.insertCSS(process.env.WALLPAPER_PREVIEW_PROBE_CSS);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  const dimensions = await window.webContents.executeJavaScript(`(() => {
    const preview = document.querySelector('.wallpaper-library-preview').getBoundingClientRect();
    const card = document.querySelector('.wallpaper-library-card').getBoundingClientRect();
    return { previewWidth: preview.width, previewHeight: preview.height, cardHeight: card.height };
  })()`);
  window.destroy();
  const ratio = dimensions.previewWidth / Math.max(1, dimensions.previewHeight);
  assert.ok(dimensions.previewHeight >= 80,
    `wallpaper preview is flattened: ${dimensions.previewWidth.toFixed(1)}x${dimensions.previewHeight.toFixed(1)}`);
  assert.ok(ratio >= 1.72 && ratio <= 1.84,
    `wallpaper preview must stay near 16:9, got ratio ${ratio.toFixed(3)}`);
  assert.ok(dimensions.cardHeight >= dimensions.previewHeight + 48,
    `wallpaper card clips its 16:9 preview: card ${dimensions.cardHeight.toFixed(1)}px, preview ${dimensions.previewHeight.toFixed(1)}px`);
  console.log(JSON.stringify({ ok: true, ...dimensions, ratio }));
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
