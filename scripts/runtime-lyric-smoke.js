const assert = require('node:assert/strict');
const fs = require('node:fs');

async function connectCdp() {
  const pages = await fetch('http://127.0.0.1:9223/json/list').then((response) => response.json());
  const page = pages.find((item) => item.type === 'page' && /Mineradio/i.test(item.title || '')) || pages[0];
  assert.ok(page && page.webSocketDebuggerUrl, 'A Mineradio CDP page should be available on port 9223');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
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

async function main() {
  const { socket, send } = await connectCdp();
  const screenshotMode = process.argv.includes('--screenshot-base64');
    const screenshotArg = process.argv.find((value) => value.startsWith('--screenshot='));
    const selectionMode = process.argv.includes('--selection');
    const interludeMode = process.argv.includes('--interlude');
    const qrcMode = process.argv.includes('--qrc');
  try {
    await send('Runtime.enable');
    let ready = await send('Runtime.evaluate', { returnByValue: true, expression: "typeof fx !== 'undefined'" });
    if (!ready.result || ready.result.value !== true) {
      await send('Page.enable');
      await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        ready = await send('Runtime.evaluate', { returnByValue: true, expression: "typeof fx !== 'undefined'" });
        if (ready.result && ready.result.value === true) break;
      }
      assert.equal(ready.result && ready.result.value, true, 'Mineradio page should finish initializing');
    }
    const expression = qrcMode ? `(async function(){
        await document.fonts.ready;
        var splash = document.getElementById('splash');
        if (splash) splash.style.display = 'none';
        document.body.classList.remove('splash-active');
        fx.particleLyrics = true;
        fx.spotifyMode = true;
        playQueue = [{ id:'runtime-qrc', name:'QRC Runtime', artist:'Mineradio', provider:'spotify' }];
        currentIdx = 0;
        lyricMatchPrefs = {};
        var wrappedQrc = '<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[0,3000]A(0,2000)B(1000,2000)"/></QrcInfos>';
        var parsed = parseQrcText(wrappedQrc);
        applyLyricsState(parsed, true, 'qrc-word', []);
        createLyricsParticles();
        clearStageLyrics();
        playing = false;
        syncSpotifyPlaybackClock(1.5, false, { snap:true });
        tickLyricsParticles();
        var forward = stageLyrics.current.userData.lastLyricProgress;
        var desktopForward = currentDesktopLyricSnapshot().progress;
        var clonedTimelineLength = lyricsLines[0].karaokeTimeline.length;
        syncSpotifyPlaybackClock(0.5, false, { snap:true });
        tickLyricsParticles();
        var backward = stageLyrics.current.userData.lastLyricProgress;
        syncSpotifyPlaybackClock(3.5, false, { snap:true });
        tickLyricsParticles();
        var complete = stageLyrics.current.userData.lastLyricProgress;
        return {
          timingSource:lyricsTimingSource,
          nativeKaraoke:lyricsHasNativeKaraoke,
          clonedTimelineLength:clonedTimelineLength,
          forward:forward,
          desktopForward:desktopForward,
          backward:backward,
          complete:complete,
          shaderProgress:stageLyrics.current.userData.lyric.textMat.uniforms.uProgress.value
        };
      })()` : interludeMode ? `(async function(){
        await document.fonts.ready;
        var splash = document.getElementById('splash');
        if (splash) splash.style.display = 'none';
        document.body.classList.remove('splash-active');
        fx.particleLyrics = true;
        fx.spotifyMode = true;
        createLyricsParticles();
        clearStageLyrics();
        var segment = { start:10, end:19, duration:9, kind:'between' };
        playing = false;
        lyricsLines = [{ t:0, text:'Before', charCount:6 }, { t:19, text:'After', charCount:5 }];
        lyricsBlankSegments = [segment];
        if (typeof setCurrentLyricDelayMs === 'function') setCurrentLyricDelayMs(0, true);
        if (typeof setGlobalLyricDelayMs === 'function') setGlobalLyricDelayMs(0, true);
        syncSpotifyPlaybackClock(14.5, false, { snap:true });
        stageLyrics.currentIdx = -3;
        showStageBreathDots(segment);
        updateLyricBreathDots(stageLyrics.current, getLyricBreathDotState(segment, 14.5));
        await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });
        var data = stageLyrics.current.userData.lyric;
        var pulsesBeforePause = data.breathState.pulses.slice();
        var finalHoldPulses = getLyricBreathDotState(segment, 18.5).pulses.slice();
        playing = false;
        tickLyricsParticles();
        var pausedStillVisible = !!(stageLyrics.current && stageLyrics.current.userData.lyric.breathDots);
        return {
          dotCount:data.dots.length,
          pulses:pulsesBeforePause,
          finalHoldPulses:finalHoldPulses,
          opacities:data.dotMaterials.map(function(material){ return material.opacity; }),
          scales:data.dots.map(function(dot){ return dot.scale.x; }),
          pausedStillVisible:pausedStillVisible,
          stateFrozen:JSON.stringify(data.breathState.pulses) === JSON.stringify(pulsesBeforePause)
        };
      })()` : selectionMode ? `(async function(){
        await document.fonts.ready;
        var splash = document.getElementById('splash');
        if (splash) splash.style.display = 'none';
        document.body.classList.remove('splash-active');
        playQueue = [{ id:'runtime-song', name:'夜色中的歌', artist:'测试歌手', provider:'netease' }];
        currentIdx = 0;
        lyricMatchPrefs = {};
        lyricMatchUiState.candidates = [
          { provider:'qq', source:'qq', mid:'qq-runtime', name:'夜色中的歌', artist:'测试歌手', album:'QQ 音乐逐字版' },
          { provider:'netease', source:'netease', id:101, name:'夜色中的歌', artist:'测试歌手', album:'网易云录音室版' }
        ];
        lyricMatchUiState.loading = false;
        document.getElementById('lyric-match-track-title').textContent = '夜色中的歌';
        document.getElementById('lyric-match-track-sub').textContent = '测试歌手 · 同时搜索 QQ 音乐和网易云音乐';
        document.getElementById('lyric-match-search-input').value = '夜色中的歌 测试歌手';
        setCurrentLyricDelayMs(750, true);
        setGlobalLyricDelayMs(300, true);
        renderLyricMatchResults();
        updateLyricMatchControls();
        openGsapModal(document.getElementById('lyric-match-modal'));
        await new Promise(function(resolve){ setTimeout(resolve, 760); });
        var modal = document.querySelector('#lyric-match-modal .lyric-match-modal');
        return {
          entryPresent: !!document.getElementById('lyric-match-open-btn'),
          modalVisible: document.getElementById('lyric-match-modal').classList.contains('show'),
          candidateCount: document.querySelectorAll('.lyric-match-item').length,
          qqCount: document.querySelectorAll('.lyric-match-source.qq').length,
          neteaseCount: document.querySelectorAll('.lyric-match-source.netease').length,
          delayValue: document.getElementById('lyric-delay-value').textContent,
          sliderValue: document.getElementById('lyric-delay-slider').value,
          delayInputValue: document.getElementById('lyric-delay-input').value,
          globalDelayValue: document.getElementById('lyric-global-delay-input').value,
          effectiveDelayValue: document.getElementById('lyric-effective-delay-value').textContent,
          cacheStatusPresent: !!document.getElementById('lyric-cache-status'),
          modalWidth: modal.getBoundingClientRect().width,
          modalHeight: modal.getBoundingClientRect().height
        };
      })()` : `(async function(){
        await document.fonts.ready;
        var splash = document.getElementById('splash');
        if (splash) splash.style.display = 'none';
        document.body.classList.remove('splash-active');
        fx.particleLyrics = true;
        fx.lyricTranslation = true;
        createLyricsParticles();
        var translationSample = '城市灯火正慢慢融进黎明，而我仍然在记忆里听见你的声音，穿过空荡的街道与尚未醒来的窗，直到第一束晨光落在我们曾经并肩走过的地方';
        showStageLine({
          text: 'The city lights are fading into dawn',
          transText: translationSample
        }, true);
        updateLyricMeshProgress(stageLyrics.current, 0.56);
        var mask = stageLyrics.current.userData.lyric.mask;
        var lyricFragmentShader = stageLyrics.current.userData.lyric.textMat.fragmentShader;
        var rendererReady = !!(renderer && stageLyrics.current && stageLyrics.current.parent);
        syncSpotifyPlaybackClock(12, true, { snap:true });
        var clockStartedAt = performance.now();
        var clockA = readSpotifyPlaybackClock();
        await new Promise(function(resolve){ setTimeout(resolve, 64); });
        var clockB = readSpotifyPlaybackClock();
        var clockElapsedMs = performance.now() - clockStartedAt;
        playing = true;
        fx.spotifyMode = true;
        lyricsLines = [{ t:0, duration:120, charCount:38, text:'The city lights are fading into dawn', transText:translationSample }];
        stageLyrics.currentIdx = 0;
        await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });
        return {
          togglePresent: !!document.getElementById('t-lyricTranslation'),
          translationLines: mask.transLines,
          translationComplete: mask.transLines.join('') === translationSample,
          translationScale: mask.transFontSize / mask.fontSize,
          originalWidth: mask.textMax - mask.textMin,
          translationVisible: mask.transLines.length > 0,
          pendingGlyphOpacity: lyricPendingGlyphOpacity(),
          shaderUsesPendingOpacity:lyricFragmentShader.indexOf('mix(0.750, 1.0, clamp(filled, 0.0, 1.0))') >= 0,
          shaderKeepsTranslationFull:lyricFragmentShader.indexOf('mix(1.0, originalGlyphOpacity, original)') >= 0,
          shaderKeepsGroupOpacity:lyricFragmentShader.indexOf('mask * uOpacity * glyphOpacity') >= 0,
          originalShadowPasses: lyricReadabilityShadowPasses(mask.fontSize, 1),
          translationShadowPasses: lyricReadabilityShadowPasses(mask.fontSize, mask.transFontSize / mask.fontSize),
          clockDelta: clockB - clockA,
          clockElapsedMs: clockElapsedMs,
          rendererReady: rendererReady
        };
      })()`;
    const evaluation = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression,
    });
    assert.ok(!evaluation.exceptionDetails, evaluation.exceptionDetails && evaluation.exceptionDetails.text);
    const result = evaluation.result && evaluation.result.value;
    if (!screenshotMode && !screenshotArg) console.log(JSON.stringify(result));
    if (qrcMode) {
      assert.equal(result.timingSource, 'qrc-word');
      assert.equal(result.nativeKaraoke, true);
      assert.equal(result.clonedTimelineLength, 2, 'Applying lyric state must retain the pre-parsed QRC timeline');
      assert.ok(Math.abs(result.forward - 0.625) < 1e-6, 'Overlapping QRC nodes should use the rightmost source-timed frontier');
      assert.ok(Math.abs(result.desktopForward - result.forward) < 1e-6, 'Desktop and 3D lyrics should sample the same QRC progress');
      assert.ok(Math.abs(result.backward - 0.125) < 1e-6, 'A backward seek must immediately recompute a lower QRC progress');
      assert.equal(result.complete, 1, 'The QRC sweep should stop at completion after the source timings end');
      assert.equal(result.shaderProgress, 1, 'The rendered shader should receive the source-derived completion value');
    } else if (interludeMode) {
      assert.equal(result.dotCount, 3);
      assert.deepEqual(result.pulses, [1, 1, 0], 'Completed dots should stay highlighted while the next dot begins');
      assert.deepEqual(result.finalHoldPulses, [1, 1, 1], 'The final quarter should hold all three dots completed');
      assert.ok(Math.abs(result.opacities[1] - result.opacities[0]) < 1e-6, 'Completed dots should keep the same full group opacity');
      assert.ok(result.opacities[1] > result.opacities[2] * 2, 'Completed dots should be materially brighter than resting dots');
      assert.equal(result.scales[0], 1.5);
      assert.equal(result.scales[1], 1.5);
      assert.equal(result.pausedStillVisible, true, 'Pausing should keep the breathing dots on stage');
      assert.equal(result.stateFrozen, true, 'Pausing should preserve the source-clock pulse state');
    } else if (selectionMode) {
      assert.equal(result.entryPresent, true);
      assert.equal(result.modalVisible, true);
      assert.equal(result.candidateCount, 2);
      assert.equal(result.qqCount, 1);
      assert.equal(result.neteaseCount, 1);
      assert.equal(result.delayValue, '+0.75 s');
      assert.equal(result.sliderValue, '750');
      assert.equal(result.delayInputValue, '750');
      assert.equal(result.globalDelayValue, '300');
      assert.equal(result.effectiveDelayValue, '+1.05 s');
      assert.equal(result.cacheStatusPresent, true);
      assert.ok(result.modalWidth >= 560 && result.modalHeight >= 520, 'The lyric selection page should have usable desktop dimensions');
    } else {
      assert.equal(result.togglePresent, true);
      assert.equal(result.translationVisible, true);
      assert.ok(result.translationLines.length <= 2, 'Translated lyrics should occupy no more than two lines');
      assert.equal(result.translationComplete, true, 'Long translations should wrap without being truncated');
      assert.ok(result.translationScale >= 0.339 && result.translationScale <= 0.421, 'Translation scale should stay within the agreed range');
      assert.equal(result.pendingGlyphOpacity, 0.75, 'Pending original glyphs should render at 75% of the current line opacity');
      assert.equal(result.shaderUsesPendingOpacity, true, 'The actual material should fade pending original glyphs from 75% to full opacity');
      assert.equal(result.shaderKeepsTranslationFull, true, 'The actual material should keep translation glyphs outside karaoke opacity progression');
      assert.equal(result.shaderKeepsGroupOpacity, true, 'The actual material should preserve existing fade/detail opacity');
      assert.equal(result.originalShadowPasses.length, 4, 'Original lyrics should retain four readability shadow passes');
      assert.equal(result.translationShadowPasses.length, 4, 'Translation should use the same four-pass shadow structure');
      assert.ok(Math.abs(result.translationShadowPasses[0].blur / result.originalShadowPasses[0].blur - result.translationScale) < 0.001,
        'Translation shadow dimensions should scale with the translation font size');
      assert.ok(result.clockDelta > 0.045, 'Spotify clock should advance continuously between samples');
      assert.ok(Math.abs(result.clockDelta - result.clockElapsedMs / 1000) < 0.015, 'Spotify clock should track the high-resolution page clock');
      assert.equal(result.rendererReady, true);
    }
    if (screenshotMode || screenshotArg) {
      await send('Page.enable');
      const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      if (screenshotArg) {
        const screenshotPath = screenshotArg.slice('--screenshot='.length);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
        console.log(screenshotPath);
      } else {
        process.stdout.write(screenshot.data);
      }
    } else {
      console.log(qrcMode ? 'Runtime QRC karaoke smoke: PASS' : (interludeMode ? 'Runtime lyric interlude smoke: PASS' : (selectionMode ? 'Runtime lyric selection smoke: PASS' : 'Runtime lyric smoke: PASS')));
    }
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(`Runtime lyric smoke: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
