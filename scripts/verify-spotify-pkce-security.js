'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const frontend = read('public/index.html');
const server = read('server.js');
const main = read('desktop/main.js');
const authSession = read('spotify-auth-session.js');

assert.ok(!frontend.includes('spotify-client-secret-login'), 'renderer still renders a Client Secret input');
assert.ok(!frontend.includes('fx.spotifyClientSecret'), 'renderer still holds Spotify Client Secret in runtime settings');
assert.ok(!/spotifyClientSecret\s*:/.test(frontend), 'renderer still serializes Spotify Client Secret');
assert.match(frontend, /legacySpotifyCredentialKeys\s*=\s*\['spotifyClientSecret', 'spotifyAccessToken', 'spotifyRefreshToken'\]/, 'legacy renderer credentials are not covered by startup migration');
assert.match(frontend, /localStorage\.removeItem\(key\)/, 'legacy renderer credentials are not removed from direct localStorage keys');
assert.match(frontend, /delete raw\[key\]/, 'legacy renderer credentials are not removed from saved settings');
const savedLayoutReader = frontend.slice(frontend.indexOf('function readSavedLyricLayout()'), frontend.indexOf('function readSavedLyricLayout()') + 1800);
assert.ok(savedLayoutReader.indexOf('localStorage.removeItem(key)') < savedLayoutReader.indexOf('JSON.parse(savedLayoutRaw)'), 'direct legacy credentials must be removed before parsing potentially corrupt saved settings');
assert.equal((frontend.match(/spotifyAccessToken/g) || []).length, 1, 'Spotify access token appears outside the one-way legacy cleanup list');
assert.equal((frontend.match(/spotifyRefreshToken/g) || []).length, 1, 'Spotify refresh token appears outside the one-way legacy cleanup list');
assert.ok(!frontend.includes('/api/spotify/token'), 'renderer can still request a raw access token');
assert.ok(!frontend.includes('https://api.spotify.com/'), 'renderer still calls Spotify Web API directly');
assert.match(frontend, /if \(meRes\.status === 401\) \{\s*spotifyLoginStatus = \{ loggedIn: false \}/, 'Spotify profile 401 can be overwritten as logged in');

assert.ok(!server.includes('clientSecret'), 'server still accepts or persists a Client Secret');
assert.ok(!server.includes("'Authorization': authHeader"), 'server still uses confidential-client Basic authentication');
assert.ok(!/sendJSON\([^\n]+accessToken/.test(server), 'server still returns a raw access token to the renderer');
assert.match(server, /const HOST = process\.env\.HOST \|\| '127\.0\.0\.1'/, 'local credential proxy is not loopback-only by default');
assert.match(server, /SPOTIFY_PROXY_ORIGIN_REJECTED/, 'state-changing Spotify controls lack same-origin protection');
assert.match(authSession, /code_challenge_method:\s*'S256'/, 'authorization request is missing PKCE S256');
assert.match(authSession, /code_verifier/, 'token exchange is missing the PKCE verifier');
assert.match(server, /spotifyAuthState/, 'authorization flow is missing CSRF state validation');

assert.match(main, /safeStorage/, 'Electron safeStorage is not used for persisted Spotify credentials');
assert.match(main, /SpotifySecureAuthStore/, 'main process does not initialize the encrypted Spotify auth store');

console.log('Spotify PKCE credential security: PASS');
