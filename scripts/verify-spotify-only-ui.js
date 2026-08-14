'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const source = readRendererSource();
const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');

for (const forbidden of [
  'login-provider-netease',
  'login-provider-qq',
  'qq-cookie-panel',
  'qq-cookie-input',
  'search-mode-netease',
  'search-mode-qq',
  'search-mode-podcast',
  'tab-podcast',
  'class="quality-option"',
]) {
  assert.ok(!html.includes(forbidden), `${forbidden} should not be rendered in Spotify-only UI`);
}

assert.ok(!preload.includes('openNeteaseMusicLogin'), 'renderer bridge must not expose NetEase login');
assert.ok(!preload.includes('openQQMusicLogin'), 'renderer bridge must not expose QQ login');
assert.match(source, /spotifyMode:\s*true/, 'Spotify mode should be the fixed default');
assert.match(source, /var startupLoginStatusPromise = refreshSpotifyLoginStatus\(\)/, 'startup should only check Spotify auth');
assert.match(source, /async function clearSpotifyAuthorization\(\)/, 'Spotify authorization must have an explicit recovery/reset action');
assert.match(source, /fetch\('\/api\/spotify\/logout', \{ method: 'DELETE' \}\)/, 'authorization reset must use the protected logout route');
assert.ok(html.includes('spotify-auth-recovery-status'), 'Spotify authorization state should be visible in settings');
assert.ok(html.includes('授权 / 重新授权'), 'Spotify authorization should expose a reconnect action');
assert.doesNotMatch(source, /startQQLoginStatusAutoRefresh\(\);/, 'startup must not poll QQ login state');
assert.ok(!html.includes('登录后显示网易云 / QQ 歌单'), 'playlist panel should describe Spotify data only');
assert.doesNotMatch(source, /audioFile\s*=\s*f/, 'Spotify-only renderer must not accept dropped local audio for playback');
assert.ok(html.includes('title="导入自定义封面"'), 'file import control should only advertise custom covers');

console.log('Spotify-only UI verification passed');
