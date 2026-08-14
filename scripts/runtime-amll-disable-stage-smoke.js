'use strict';

const assert = require('node:assert/strict');

const debugPortArgument = process.argv.find(value => value.startsWith('--debug-port='));
const debugPort = debugPortArgument ? Number(debugPortArgument.slice('--debug-port='.length)) : 9224;

async function connectCdp() {
  const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json());
  const page = pages.find(item => item.type === 'page') || pages[0];
  assert.ok(page && page.webSocketDebuggerUrl, `A Chrome CDP page should be available on port ${debugPort}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once:true });
    socket.addEventListener('error', reject, { once:true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return { socket, send };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise:true,
    returnByValue:true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Chrome evaluation failed');
  return result.result && result.result.value;
}

async function main() {
  const { socket, send } = await connectCdp();
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url:`http://127.0.0.1:3000/?amllDisableSmoke=${Date.now()}` });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await wait(250);
      if (await evaluate(send, `typeof fx !== 'undefined' && !!window.MineradioAppleMusicLyrics`)) break;
    }
    assert.equal(await evaluate(send, `typeof fx !== 'undefined' && !!window.MineradioAppleMusicLyrics`), true,
      'Mineradio should finish initializing');

    const snapshot = await evaluate(send, `(async function(){
      var splash = document.getElementById('splash');
      if (splash) splash.style.display = 'none';
      document.body.classList.remove('splash-active');
      window.__amllDisableSmokeErrors = [];
      window.addEventListener('error', function(event) {
        if (window.__amllDisableSmokeErrors.length >= 20) return;
        window.__amllDisableSmokeErrors.push(String(event && (event.message || (event.error && event.error.message)) || 'window error'));
      });
      window.addEventListener('unhandledrejection', function(event) {
        if (window.__amllDisableSmokeErrors.length >= 20) return;
        window.__amllDisableSmokeErrors.push(String(event && event.reason && (event.reason.message || event.reason) || 'unhandled rejection'));
      });
      window.__amllDisableSmokeRenderCount = 0;
      var originalRendererRender = renderer.render;
      renderer.render = function() {
        window.__amllDisableSmokeRenderCount += 1;
        return originalRendererRender.apply(this, arguments);
      };
      fx.spotifyMode = true;
      window.enterSpotifyIdleStage = function() {};
      window.spotifyAudioDuration = 200;
      fx.particleLyrics = true;
      lyricsLines = [{ t:0, time:0, text:'关闭后普通歌词恢复', transText:'stage restored', source:'lrc-line' }];
      lyricsBlankSegments = [];
      playing = false;
      syncSpotifyPlaybackClock(1, false, { snap:true });
      createLyricsParticles();
      clearStageLyrics();
      tickLyricsParticles();
      playing = true;
      setPlayIcon(true);
      tweenParticleAlpha(uniforms.uAlpha.value || 0, 1, 260);

      var control = document.querySelector('[data-amll-setting="enabled"]');
      control.checked = false;
      control.dispatchEvent(new Event('change', { bubbles:true }));
      var playerPrototype = window.MineradioAMLLCore.LyricPlayer.prototype;
      var originalOptimizeOptions = playerPrototype.setOptimizeOptions;
      var forcedConfigureCalls = 0;
      playerPrototype.setOptimizeOptions = function(){
        forcedConfigureCalls += 1;
        throw new Error('forced AMLL configure failure');
      };
      control.checked = true;
      control.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(function(resolve){ setTimeout(resolve, 80); });
      control.checked = false;
      control.dispatchEvent(new Event('change', { bubbles:true }));
      playerPrototype.setOptimizeOptions = originalOptimizeOptions;
      control.checked = true;
      control.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(function(resolve){ setTimeout(resolve, 80); });
      control.checked = false;
      control.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });
      stopSpotifyPolling();
      await new Promise(function(resolve){ setTimeout(resolve, 1200); });
      leaveSpotifyIdleStage();
      emptyHomeActive = false;
      document.body.classList.remove('empty-home-active');
      lyricsLines = [{ t:0, time:0, text:'关闭后普通歌词恢复', transText:'stage restored', source:'lrc-line' }];
      lyricsBlankSegments = [];
      syncSpotifyPlaybackClock(1, false, { snap:true });
      clearStageLyrics();
      tickLyricsParticles();

      var rows = [];
      for (var preset = 0; preset < presetMeta.length; preset += 1) {
        if (preset === SONIC_WORKSHOP_PRESET_INDEX) continue;
        setPreset(preset, { silent:true, noSave:true, skipTransition:true });
        await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });
        var before = uniforms.uTime.value;
        var renderedBefore = window.__amllDisableSmokeRenderCount;
        await new Promise(function(resolve){ setTimeout(resolve, 120); });
        var rect = renderer.domElement.getBoundingClientRect();
        var dragX = rect.left + rect.width / 2;
        var dragY = rect.top + rect.height / 2;
        var hit = document.elementFromPoint(dragX, dragY);
        var samples = [.12, .25, .5, .75, .88];
        for (var sy = 0; sy < samples.length && hit !== renderer.domElement; sy++) {
          for (var sx = 0; sx < samples.length; sx++) {
            var candidateX = rect.left + rect.width * samples[sx];
            var candidateY = rect.top + rect.height * samples[sy];
            var candidate = document.elementFromPoint(candidateX, candidateY);
            if (candidate === renderer.domElement) {
              dragX = candidateX;
              dragY = candidateY;
              hit = candidate;
              break;
            }
          }
        }
        var rotationBefore = { x:gestureRotation.x, y:gestureRotation.y };
        if (hit) hit.dispatchEvent(new MouseEvent('mousedown', {
          bubbles:true,
          button:0,
          clientX:dragX,
          clientY:dragY
        }));
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles:true,
          buttons:1,
          clientX:dragX + 32,
          clientY:dragY + 18
        }));
        var dragAccepted = !!(orbit.rotating && mouseDownAt.hadDrag);
        window.dispatchEvent(new MouseEvent('mouseup', {
          bubbles:true,
          button:0,
          clientX:dragX + 32,
          clientY:dragY + 18
        }));
        await new Promise(function(resolve){ requestAnimationFrame(resolve); });
        rows.push({
          preset:preset,
          name:presetMeta[preset].name,
          frameAdvanced:uniforms.uTime.value > before,
          renderAdvanced:window.__amllDisableSmokeRenderCount > renderedBefore,
          dragAccepted:dragAccepted,
          rotationChanged:Math.abs(gestureRotation.x - rotationBefore.x) > 0.001 || Math.abs(gestureRotation.y - rotationBefore.y) > 0.001,
          runtimeErrors:window.__amllDisableSmokeErrors.slice(),
          particlesVisible:particles.visible,
          particleAlpha:uniforms.uAlpha.value,
          particleDim:uniforms.uParticleDim.value,
          stageVisible:stageLyrics.group.visible,
          lyricMounted:!!stageLyrics.current,
          lyricCount:lyricsLines.length,
          lyricTime:getLyricPlaybackSeconds(),
          betaActive:document.body.classList.contains('apple-music-lyrics-beta-active'),
          betaStageActive:document.getElementById('apple-music-lyrics-beta-stage').classList.contains('active'),
          betaStageInert:document.getElementById('apple-music-lyrics-beta-stage').inert,
          betaChildren:document.getElementById('apple-music-lyrics-beta-surface').children.length,
          failedPlayerAttempts:forcedConfigureCalls,
          hitId:hit && hit.id,
          hitTag:hit && hit.tagName,
        });
      }
      return rows;
    })()`);

    console.log(JSON.stringify(snapshot, null, 2));
    snapshot.forEach(row => {
      assert.equal(row.frameAdvanced, true, `${row.name}: shared animation frame should advance`);
      assert.equal(row.renderAdvanced, true, `${row.name}: WebGL renderer should keep presenting frames`);
      assert.equal(row.runtimeErrors.length, 0, `${row.name}: stage loop must not throw (${row.runtimeErrors.join('; ')})`);
      assert.equal(row.dragAccepted, true, `${row.name}: canvas drag should enter the shared camera gesture`);
      assert.equal(row.rotationChanged, true, `${row.name}: canvas drag should update the shared camera rotation`);
      assert.ok(row.particleAlpha > 0.1, `${row.name}: product playback flow should restore visible particle alpha`);
      assert.equal(row.stageVisible, true, `${row.name}: normal lyric group should be visible`);
      assert.equal(row.lyricMounted, true, `${row.name}: normal lyric should be mounted`);
      assert.equal(row.betaActive, false, `${row.name}: beta body state should be removed`);
      assert.equal(row.betaStageActive, false, `${row.name}: beta stage should be inactive`);
      assert.equal(row.betaStageInert, true, `${row.name}: beta stage should be inert`);
      assert.equal(row.betaChildren, 0, `${row.name}: beta renderer should be removed`);
      assert.equal(row.failedPlayerAttempts, 1, `${row.name}: a failed renderer must not be recreated every frame`);
      assert.equal(row.hitTag, 'CANVAS',
        `${row.name}: the real pointer hit must be the WebGL canvas, received ${row.hitTag}#${row.hitId || ''}`);
      if (row.preset !== 6) assert.equal(row.particlesVisible, true, `${row.name}: shared particles should be visible`);
    });

    const seekSnapshot = await evaluate(send, `(async function(){
      var calls = [];
      var originalSpotifyApi = window.spotifyApi;
      window.spotifyApi = async function(path, options) {
        if (path === '/me/player/currently-playing') return { ok:false, status:204 };
        calls.push({ path:path, method:String(options && options.method || 'GET') });
        return { ok:true, status:204 };
      };
      var bar = document.getElementById('progress-bar');
      bar.style.position = 'fixed';
      bar.style.left = '40px';
      bar.style.bottom = '40px';
      bar.style.width = '400px';
      bar.style.height = '20px';
      bar.style.pointerEvents = 'auto';
      var rect = bar.getBoundingClientRect();
      var expectedSeconds = Math.max(0, Math.min(1, 300 / rect.width)) * 200;
      bar.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles:true, pointerId:41, button:0, clientX:rect.left + 80, clientY:rect.top + 10
      }));
      bar.dispatchEvent(new PointerEvent('pointermove', {
        bubbles:true, pointerId:41, buttons:1, clientX:rect.left + 300, clientY:rect.top + 10
      }));
      await pollSpotifyState();
      var callsDuringDrag = calls.length;
      var previewSeconds = getPlaybackCurrentSeconds();
      var durationDuringDrag = getPlaybackDurationSeconds();
      bar.dispatchEvent(new PointerEvent('pointerup', {
        bubbles:true, pointerId:41, button:0, clientX:rect.left + 300, clientY:rect.top + 10
      }));
      await new Promise(function(resolve){ setTimeout(resolve, 40); });
      window.spotifyApi = originalSpotifyApi;
      return {
        callsDuringDrag:callsDuringDrag,
        expectedSeconds:expectedSeconds,
        previewSeconds:previewSeconds,
        durationDuringDrag:durationDuringDrag,
        calls:calls,
        committedSeconds:getPlaybackCurrentSeconds()
      };
    })()`);
    console.log(JSON.stringify({ seekSnapshot }, null, 2));
    assert.equal(seekSnapshot.callsDuringDrag, 0, 'Spotify drag preview must not send network seeks');
    assert.ok(Math.abs(seekSnapshot.previewSeconds - seekSnapshot.expectedSeconds) < 0.5,
      'Spotify drag should preview the local target');
    assert.equal(seekSnapshot.durationDuringDrag, 200,
      'a stale 204 poll must not clear the active drag preview');
    assert.equal(seekSnapshot.calls.length, 1, 'Spotify pointerup must commit exactly one seek');
    assert.equal(seekSnapshot.calls[0].method, 'PUT');
    assert.equal(seekSnapshot.calls[0].path,
      '/me/player/seek?position_ms=' + Math.round(seekSnapshot.expectedSeconds * 1000));
    assert.ok(Math.abs(seekSnapshot.committedSeconds - seekSnapshot.expectedSeconds) < 0.75,
      'Spotify seek should keep the optimistic playback clock');
    console.log('AMLL disable stage smoke passed');
  } finally {
    socket.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
