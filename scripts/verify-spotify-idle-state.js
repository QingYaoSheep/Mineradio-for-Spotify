'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const source = readRendererSource();
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function functionSource(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${marker} should have a complete body`);
}

let lyricClears = 0;
const idleStage = { classList: { add() {}, remove() {} } };
const idleMessage = { textContent: '' };
const context = {
  spotifyCurrentTrackId: 'old-track',
  spotifyCurrentTrackToken: 10,
  trackSwitchToken: 10,
  spotifyPollFailureCount: 0,
  lyricTrackLoading: false,
  lyricsTimingSource: 'qrc-word',
  playing: true,
  window: { spotifyAudioProgress: 42, spotifyAudioDuration: 180 },
  document: {
    getElementById(id) {
      return id === 'spotify-idle-stage' ? idleStage
        : id === 'spotify-idle-message' ? idleMessage
          : null;
    },
  },
  beginLyricTrackSwitch() { lyricClears += 1; },
  setPlayIcon() {},
  syncSpotifyPlaybackClock() {},
  updateControlTrackInfo() {},
  setControlCoverSrc() {},
  applyCustomBackgroundMedia() {},
  updatePlaybackProgressUi() {},
  Date,
  Number,
};
vm.createContext(context);
vm.runInContext([
  functionSource('function enterSpotifyIdleStage(reason)'),
  functionSource('function leaveSpotifyIdleStage()'),
  'this.enter = enterSpotifyIdleStage; this.leave = leaveSpotifyIdleStage;',
].join('\n'), context);

context.enter('no-playback');
assert.equal(context.spotifyCurrentTrackId, null, 'idle state should forget the previous track');
assert.equal(context.playing, false);
assert.equal(context.window.spotifyAudioProgress, 0);
assert.equal(context.window.spotifyAudioDuration, 0);
assert.equal(lyricClears, 1, 'idle state should immediately clear previous lyrics');
assert.match(idleMessage.textContent, /Spotify/);
assert.match(html, /id="spotify-idle-stage"/, 'idle stage should be rendered in the app shell');
assert.match(html, /openSpotifyApp\(\)/, 'idle stage should offer an Open Spotify action');

console.log('Spotify idle state verification passed');
