const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRendererSource } = require('./renderer-source');

const html = readRendererSource();

function functionSource(marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  let depth = 0;
  let end = -1;
  for (let index = html.indexOf('{', start); index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${marker} should have a complete body`);
  return html.slice(start, end);
}

const playlistCalls = [];
const detailContext = {
  playlistPanelDetailState: { key: '', loading: false, playlist: null, tracks: [], token: 0, renderLimit: 20 },
  userPlaylists: [{ id: 'spotify:playlist-1', provider: 'spotify', name: 'Spotify playlist' }],
  PLAYLIST_DETAIL_INITIAL_RENDER: 20,
  apiJson: async (url) => {
    playlistCalls.push({ kind: 'backend', url });
    return { tracks: [] };
  },
  fetchSpotifyPlaylistTracks: async (id) => {
    playlistCalls.push({ kind: 'spotify', id });
    return { tracks: [{ id: 'track-1', provider: 'spotify' }] };
  },
  cloneSong: (song) => song,
  renderPlaylistPanelDetailState() {},
  scrollPlaylistPanelDetailIntoView() {},
  showToast() {},
  console,
  String,
};
vm.createContext(detailContext);
vm.runInContext([
  functionSource('function playlistPanelKey(provider, id)'),
  functionSource('function playlistPanelProviderId(provider, id)'),
  functionSource('async function openPlaylistPanelDetail(provider, pid, title)'),
  'this.openSpotifyDetail = openPlaylistPanelDetail;',
].join('\n'), detailContext);

async function verifyPlaylistDetailRouting() {
  playlistCalls.length = 0;
  await detailContext.openSpotifyDetail('spotify', 'playlist-1', 'Spotify playlist');
  assert.deepEqual(JSON.parse(JSON.stringify(playlistCalls)), [{ kind: 'spotify', id: 'playlist-1' }],
    'Opening a Spotify playlist must use the Spotify API, never the NetEase playlist endpoint');
  assert.equal(detailContext.playlistPanelDetailState.key, 'spotify:playlist-1',
    'Spotify playlist detail state must retain its provider identity');
}

async function verifySpotifyPlaylistMetadata() {
  const playlistElement = { innerHTML: '' };
  const context = {
    fx: { spotifyMode: true },
    userPlaylists: [],
    myPodcastCollections: [],
    emptyHomeActive: false,
    refreshSpotifyLoginStatus: async () => ({ loggedIn: true }),
    spotifyApi: async (url) => {
      playlistCalls.push({ kind: 'proxy', url });
      const offset = Number(new URL(url, 'https://example.test').searchParams.get('offset') || 0);
      return {
      ok: true,
      json: async () => offset === 0 ? ({
        items: [{
          id: 'playlist-1',
          name: 'Spotify playlist 1',
          images: [{ url: 'https://example.test/playlist.jpg' }],
          items: { total: 42 },
          owner: { display_name: 'Spotify owner' },
        }],
        next: 'https://api.spotify.com/v1/me/playlists?offset=50',
      }) : ({
        items: [{
          id: 'playlist-2',
          name: 'Spotify playlist 2',
          images: [],
          items: { total: 7 },
          owner: { display_name: 'Spotify owner' },
        }],
        next: null,
      }),
    };
    },
    document: {
      getElementById(id) { return id === 'pl-list' ? playlistElement : null; },
    },
    resetPlaylistPanelRenderLimit() {},
    miniQueueSkeleton: () => '',
    window: {},
    isPlaylistPanelVisibleForRender: () => false,
    renderUserPlaylistsList() {},
    renderMyPodcastCollections() {},
    renderHomeDiscover() {},
    scheduleShelfRebuild() {},
    console,
    Number,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function refreshUserPlaylists(force)')}; this.refresh = refreshUserPlaylists;`, context);
  await context.refresh(true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.userPlaylists)), [{
    id: 'playlist-1',
    name: 'Spotify playlist 1',
    cover: 'https://example.test/playlist.jpg',
    playCount: 0,
    trackCount: 42,
    creator: 'Spotify owner',
    ownerId: '',
    canEdit: false,
    provider: 'spotify',
    source: 'spotify',
  }, {
    id: 'playlist-2',
    name: 'Spotify playlist 2',
    cover: '',
    playCount: 0,
    trackCount: 7,
    creator: 'Spotify owner',
    ownerId: '',
    canEdit: false,
    provider: 'spotify',
    source: 'spotify',
  }], 'Spotify playlist metadata must preserve its provider and real track count for the shelf');
  assert.deepEqual(playlistCalls.filter(call => call.kind === 'proxy').map(call => call.url), [
    '/me/playlists?limit=50&offset=0',
    '/me/playlists?limit=50&offset=50',
  ]);
  assert.match(html, /sourceLabel\s*=\s*provider === 'qq' \? 'QQ' : \(provider === 'spotify' \? 'SPOTIFY'/,
    'The 3D shelf must label Spotify playlists as Spotify');
}

const qualityLabel = { textContent: '' };
const qualityButton = { title: '' };
const spotifyQualityHint = { style: {} };
const qualityOptions = [{
  dataset: { quality: 'jymaster', svip: '1' },
  classList: { toggle() {} },
  style: {},
}];
const qualityContext = {
  fx: { spotifyMode: true },
  playbackQuality: 'hires',
  hasProviderSvip: () => false,
  playbackQualityShortLabel: () => '臻音',
  playbackQualityLabel: () => '高清臻音',
  normalizePlaybackQuality: (value) => value,
  document: {
    getElementById(id) {
      return id === 'quality-btn-label' ? qualityLabel
        : id === 'quality-btn' ? qualityButton
          : id === 'spotify-quality-hint' ? spotifyQualityHint
            : null;
    },
    querySelectorAll() { return qualityOptions; },
  },
};
vm.createContext(qualityContext);
vm.runInContext(`${functionSource('function updatePlaybackQualityUi()')}; this.update = updatePlaybackQualityUi;`, qualityContext);

function verifyQualityUi() {
  qualityContext.update();
  assert.equal(qualityLabel.textContent, 'Spotify', 'Spotify mode must not label audio quality as NetEase quality');
  assert.match(qualityButton.title, /Spotify App/, 'Spotify mode should direct quality settings to Spotify');
  assert.equal(spotifyQualityHint.style.display, 'flex', 'Spotify quality hint should be shown');
  assert.equal(qualityOptions[0].style.display, 'none', 'NetEase quality options should be hidden in Spotify mode');
}

async function verifyRemoteSpotifyPlayback() {
  assert.match(html, /if \(providerKey === 'spotify'\) \{[\s\S]*?await playSpotifyTrack\(song\);/,
    'The queue playback path must route Spotify songs to Spotify remote playback');
  const calls = [];
  const playbackContext = {
    spotifyApi: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204 };
    },
    setPlayIcon() {},
    startSpotifyPolling() {},
    playing: false,
    Error,
    JSON,
  };
  vm.createContext(playbackContext);
  vm.runInContext(`${functionSource('async function playSpotifyTrack(song)')}; this.play = playSpotifyTrack;`, playbackContext);
  await playbackContext.play({ id: 'track-1', spotifyUri: 'spotify:track:track-1', spotifyPlaylistUri: 'spotify:playlist:playlist-1' });
  assert.equal(calls.length, 1, 'Spotify track play should issue one Spotify remote-play request');
  assert.equal(calls[0].url, '/me/player/play');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers.Authorization, undefined, 'renderer must never receive or attach a Spotify token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    context_uri: 'spotify:playlist:playlist-1',
    offset: { uri: 'spotify:track:track-1' },
  });
}

(async () => {
  await verifySpotifyPlaylistMetadata();
  await verifyPlaylistDetailRouting();
  verifyQualityUi();
  await verifyRemoteSpotifyPlayback();
  console.log('Spotify mode routing: PASS');
})().catch((error) => {
  console.error(`Spotify mode routing: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
