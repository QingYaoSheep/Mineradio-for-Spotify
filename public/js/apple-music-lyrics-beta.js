(function() {
  'use strict';

  var STORE_KEY = 'mineradio-apple-music-lyrics-beta-v1';
  var Model = window.MineradioAppleMusicLyricsModel;
  var Core = window.MineradioAMLLCore;
  var settings = readSettings();
  var appleMusicAuthStatus = null;
  var appleMusicAuthBusy = false;
  var player = null;
  var stage = null;
  var surface = null;
  var emptyState = null;
  var playerCreationFailed = false;
  var convertedLines = [];
  var convertedPresentationGroups = [];
  var lastRawLines = null;
  var lastTimingSource = '';
  var lastLoading = null;
  var lastParticleLyrics = null;
  var lastFrameAt = performance.now();
  var lastPlaybackTimeMs = 0;
  var lastPresentationKey = '';
  var lastPresentationUpdateAt = 0;
  var lastPlaying = null;
  var lastVisibility = document.hidden;
  var explicitSnapPending = false;
  var autoReturnTimer = 0;
  var failureToastShown = false;
  var running = true;
  var stageActiveState = null;
  var desktopWindowSuspended = false;
  var removeDesktopStateListener = null;
  var romanWrapLayoutCache = new WeakMap();
  var lyricDecorationCache = new WeakMap();
  var wordAdvanceMaskCache = new WeakMap();
  var overlapCompletionMaskCache = new WeakSet();
  var backgroundVocalClockCache = new WeakMap();
  var earlyCurrentLine = null;
  var systemReducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function readSettings() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (error) {
      raw = null;
    }
    return Model ? Model.normalizeSettings(raw) : (raw || {});
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('[AppleMusicLyricsBeta] settings save failed:', error && error.message || error);
    }
  }

  function sourcePolicy() {
    return {
      betaEnabled:settings.enabled === true,
      sourceEnabled:settings.appleMusicSourceEnabled === true,
      translationPriority:settings.appleMusicTranslationPriority === true,
      active:settings.enabled === true && settings.appleMusicSourceEnabled === true,
      auth:appleMusicAuthStatus ? Object.assign({}, appleMusicAuthStatus) : null
    };
  }

  function effectiveSourcePolicyKey(value) {
    value = value || settings || {};
    if (value.enabled !== true || value.appleMusicSourceEnabled !== true) return 'qq-netease-default';
    return 'apple-beta:' + (value.appleMusicTranslationPriority === true
      ? 'translation-required'
      : 'translation-optional');
  }

  async function appleMusicAuthRequest(path, options) {
    var response = await fetch(path, Object.assign({
      headers:{ 'Content-Type':'application/json' }
    }, options || {}));
    var payload = null;
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (!response.ok) {
      var requestError = new Error(payload.message || payload.error || ('Apple Music HTTP ' + response.status));
      requestError.code = payload.error || '';
      throw requestError;
    }
    return payload || {};
  }

  function syncAppleMusicAuthControls() {
    var status = document.getElementById('amll-apple-auth-status');
    var storefront = document.getElementById('amll-apple-storefront');
    var testButton = document.getElementById('amll-apple-auth-test');
    var clearButton = document.getElementById('amll-apple-auth-clear');
    var saveButton = document.getElementById('amll-apple-auth-save');
    var translationRow = document.getElementById('amll-apple-translation-priority-row');
    var translationControl = document.querySelector('[data-amll-setting="appleMusicTranslationPriority"]');
    if (translationControl) translationControl.disabled = !settings.appleMusicSourceEnabled;
    if (translationRow) translationRow.classList.toggle('is-disabled', !settings.appleMusicSourceEnabled);
    [testButton, clearButton, saveButton].forEach(function(button){ if (button) button.disabled = appleMusicAuthBusy; });
    if (testButton) testButton.disabled = appleMusicAuthBusy || !(appleMusicAuthStatus && appleMusicAuthStatus.configured);
    if (clearButton) clearButton.disabled = appleMusicAuthBusy || !(appleMusicAuthStatus && appleMusicAuthStatus.configured);
    if (storefront && document.activeElement !== storefront && appleMusicAuthStatus) {
      storefront.value = appleMusicAuthStatus.storefrontOverride || '';
    }
    if (!status) return;
    status.classList.remove('good', 'fail');
    if (appleMusicAuthBusy) {
      status.textContent = '正在安全验证 Apple Music 凭据…';
      return;
    }
    if (!appleMusicAuthStatus || !appleMusicAuthStatus.configured) {
      status.textContent = '未配置 User Token · 歌词源开启后仍会回退 QQ / 网易';
      return;
    }
    var storefrontLabel = (appleMusicAuthStatus.storefront || '').toUpperCase() || '未知地区';
    if (appleMusicAuthStatus.valid) {
      status.textContent = '凭据有效 · Storefront ' + storefrontLabel + ' · 简体中文翻译';
      status.classList.add('good');
    } else {
      status.textContent = appleMusicAuthStatus.error === 'APPLE_MUSIC_AUTH_EXPIRED'
        ? '凭据已过期 · 请更新 User Token'
        : '凭据验证失败 · 请重新验证或更新 User Token';
      status.classList.add('fail');
    }
  }

  async function loadAppleMusicAuthStatus() {
    try {
      appleMusicAuthStatus = await appleMusicAuthRequest('/api/apple-music/lyrics/auth/status');
    } catch (error) {
      appleMusicAuthStatus = { configured:false, valid:false, error:error.code || 'STATUS_FAILED' };
    }
    syncAppleMusicAuthControls();
    return appleMusicAuthStatus;
  }

  function reloadCurrentLyricsForSourcePolicy() {
    if (typeof window.reloadCurrentLyricForSourcePolicy === 'function') {
      window.reloadCurrentLyricForSourcePolicy();
    }
  }

  function bindAppleMusicSourceControls() {
    var token = document.getElementById('amll-apple-user-token');
    var storefront = document.getElementById('amll-apple-storefront');
    var saveButton = document.getElementById('amll-apple-auth-save');
    var testButton = document.getElementById('amll-apple-auth-test');
    var clearButton = document.getElementById('amll-apple-auth-clear');
    if (saveButton) saveButton.addEventListener('click', async function() {
      appleMusicAuthBusy = true;
      syncAppleMusicAuthControls();
      try {
        appleMusicAuthStatus = await appleMusicAuthRequest('/api/apple-music/lyrics/auth', {
          method:'PUT',
          body:JSON.stringify({
            mediaUserToken:String(token && token.value || '').trim(),
            storefrontOverride:String(storefront && storefront.value || '').trim().toLowerCase()
          })
        });
        if (token) token.value = '';
        if (typeof window.showToast === 'function') window.showToast('Apple Music 歌词凭据已加密保存');
        if (settings.enabled === true && settings.appleMusicSourceEnabled === true) {
          reloadCurrentLyricsForSourcePolicy();
        }
      } catch (error) {
        appleMusicAuthStatus = Object.assign({}, appleMusicAuthStatus || {}, { configured:!!(appleMusicAuthStatus && appleMusicAuthStatus.configured), valid:false, error:error.code || 'VALIDATION_FAILED' });
        if (typeof window.showToast === 'function') window.showToast(error.message || 'Apple Music 凭据验证失败');
      } finally {
        appleMusicAuthBusy = false;
        syncAppleMusicAuthControls();
      }
    });
    if (testButton) testButton.addEventListener('click', async function() {
      appleMusicAuthBusy = true;
      syncAppleMusicAuthControls();
      try {
        appleMusicAuthStatus = await appleMusicAuthRequest('/api/apple-music/lyrics/auth/test', { method:'POST', body:'{}' });
        if (typeof window.showToast === 'function') window.showToast('Apple Music 凭据验证成功');
      } catch (error) {
        appleMusicAuthStatus = Object.assign({}, appleMusicAuthStatus || {}, { valid:false, error:error.code || 'VALIDATION_FAILED' });
        if (typeof window.showToast === 'function') window.showToast(error.message || 'Apple Music 凭据已失效');
      } finally {
        appleMusicAuthBusy = false;
        syncAppleMusicAuthControls();
      }
    });
    if (clearButton) clearButton.addEventListener('click', async function() {
      appleMusicAuthBusy = true;
      syncAppleMusicAuthControls();
      try {
        appleMusicAuthStatus = await appleMusicAuthRequest('/api/apple-music/lyrics/auth', { method:'DELETE' });
        if (token) token.value = '';
        if (storefront) storefront.value = '';
        if (settings.enabled === true && settings.appleMusicSourceEnabled === true) {
          reloadCurrentLyricsForSourcePolicy();
        }
        if (typeof window.showToast === 'function') window.showToast('Apple Music 歌词凭据已清除');
      } catch (error) {
        if (typeof window.showToast === 'function') window.showToast('无法清除 Apple Music 歌词凭据');
      } finally {
        appleMusicAuthBusy = false;
        syncAppleMusicAuthControls();
      }
    });
  }

  function runtimeReducedMotion() {
    return settings.reduceMotion === true || !!(systemReducedMotion && systemReducedMotion.matches);
  }

  function lyricsFeatureEnabled() {
    return settings.enabled === true;
  }

  function mainLyricsEnabled() {
    return !window.fx || window.fx.particleLyrics !== false;
  }

  function shouldShowBeta() {
    return lyricsFeatureEnabled() && mainLyricsEnabled();
  }

  function fontStack(key) {
    if (key === 'hei') return '"Microsoft YaHei UI","PingFang SC","Noto Sans CJK SC",sans-serif';
    if (key === 'song') return '"Source Han Serif SC","Noto Serif CJK SC","SimSun",serif';
    if (key === 'serif') return 'Georgia,"Times New Roman","Noto Serif CJK SC",serif';
    if (key === 'humanist') return '"Segoe UI Variable","Aptos","Noto Sans CJK SC",sans-serif';
    if (key === 'mono') return '"Cascadia Code","SFMono-Regular","Noto Sans Mono CJK SC",monospace';
    return '"Segoe UI Variable","SF Pro Display","PingFang SC","Microsoft YaHei UI",sans-serif';
  }

  function updateStageVisibility(active) {
    if (!stage) return;
    active = !!active;
    var changed = stageActiveState !== active;
    stageActiveState = active;
    document.body.classList.toggle('apple-music-lyrics-beta-active', active);
    stage.classList.toggle('active', active);
    stage.setAttribute('aria-hidden', active ? 'false' : 'true');
    stage.inert = !active;
    if (window.stageLyrics && window.stageLyrics.group) {
      window.stageLyrics.group.visible = !active && mainLyricsEnabled();
    }
    if (changed && typeof window.resetStageLyricRuntimeFault === 'function') {
      window.resetStageLyricRuntimeFault();
    }
    if (!active && changed && typeof window.tickLyricsParticles === 'function') {
      try { window.tickLyricsParticles(); } catch (error) {}
    }
  }

  function showRuntimeFailure(error) {
    console.error('[AppleMusicLyricsBeta] renderer unavailable:', error);
    updateStageVisibility(false);
    if (!failureToastShown && typeof window.showToast === 'function') {
      failureToastShown = true;
      window.showToast('Apple Music 歌词暂时不可用，已恢复原版歌词');
    }
  }

  function configurePlayer() {
    if (!player) return;
    var reduceMotion = runtimeReducedMotion();
    var quality = settings.renderQuality;
    var springEnabled = !reduceMotion && quality !== 'power' && settings.transitionStrength >= 0.12;
    var strength = settings.transitionStrength;
    player.setOptimizeOptions({
      normalizeSpaces: false,
      resetLineTimestamps: false,
      convertExcessiveBackgroundLines: false,
      syncMainAndBackgroundLines: false,
      cleanUnintentionalOverlaps: false,
      tryAdvanceStartTime: false
    });
    player.setAlignAnchor(Core.LayoutAlignAnchor.Center);
    player.setAlignPosition(settings.anchorPosition);
    player.setHidePassedLines(false);
    player.setEnableBlur(true);
    player.setEnableScale(!reduceMotion);
    player.setEnableSpring(springEnabled);
    player.setAlwaysPostpositionBackground(false);
    player.setWordFadeWidth(0.5);
    player.setOverscanPx(quality === 'high' ? 680 : (quality === 'power' ? 220 : 420));
    if (springEnabled) {
      player.setLinePosYSpringParams({
        mass: 1,
        stiffness: 92 + strength * 42,
        damping: 19 - Math.min(5, strength * 3.4)
      });
      player.setLineScaleSpringParams({
        mass: 1,
        stiffness: 104 + strength * 38,
        damping: 20 - Math.min(4, strength * 2.6)
      });
    }

    var element = player.getElement();
    var scale = settings.fontScale;
    element.style.fontFamily = fontStack(settings.fontFamily);
    element.style.fontWeight = String(settings.fontWeight);
    element.style.fontSize = 'clamp(' + (30 * scale).toFixed(2) + 'px,' + (4.35 * scale).toFixed(3) + 'vw,' + (74 * scale).toFixed(2) + 'px)';
    element.style.setProperty('--amll-lp-color', settings.textColor);
    element.style.setProperty('--amll-beta-text-color', settings.textColor);
    element.style.setProperty('--amll-beta-glow-color', settings.glowColor);
    element.style.setProperty('--amll-beta-translation-scale', String(settings.translationScale));
    element.style.setProperty('--amll-beta-roman-scale', String(settings.romanizationScale));
    element.style.setProperty('--amll-lp-bg-line-scale', String(settings.backgroundVocalScale));
    stage.style.setProperty('--amll-beta-anchor', (settings.anchorPosition * 100).toFixed(2) + '%');
    element.setAttribute('data-quality', quality);
    element.setAttribute('data-clarity', String(settings.clarity));
    element.classList.toggle('amll-beta-glow-off', !settings.glowEnabled);
    element.classList.toggle('amll-beta-reduce-motion', reduceMotion);
  }

  function ensurePlayer() {
    if (player) return true;
    if (playerCreationFailed) return false;
    if (!Core || !Core.LyricPlayer || !Model) {
      playerCreationFailed = true;
      showRuntimeFailure(new Error('AMLL Core did not load'));
      return false;
    }
    var pendingPlayer = null;
    try {
      pendingPlayer = new Core.LyricPlayer();
      player = pendingPlayer;
      var element = player.getElement();
      element.classList.add('mineradio-amll-player');
      surface.appendChild(element);
      configurePlayer();
      player.addEventListener('line-click', function(event) {
        seekToLyricLine(event.lineIndex);
      });
      bindBrowseReturnEvents(element);
      playerCreationFailed = false;
      failureToastShown = false;
      return true;
    } catch (error) {
      player = null;
      cleanupPlayerInstance(pendingPlayer);
      cleanupSurfacePlayers();
      playerCreationFailed = true;
      showRuntimeFailure(error);
      return false;
    }
  }

  function cleanupPlayerElement(element) {
    if (!element) return;
    if (typeof element.getAnimations === 'function') {
      element.getAnimations({ subtree:true }).forEach(function(animation) {
        try { animation.cancel(); } catch (error) {}
      });
    }
    if (element.parentNode) element.parentNode.removeChild(element);
  }

  function cleanupPlayerInstance(instance) {
    if (!instance) return;
    var element = null;
    try { element = instance.getElement(); } catch (error) {}
    try { instance.pause(); } catch (error) {}
    try { instance.dispose(); } catch (error) {}
    cleanupPlayerElement(element);
  }

  function cleanupSurfacePlayers() {
    if (!surface) return;
    Array.from(surface.children).forEach(cleanupPlayerElement);
  }

  function disposePlayer() {
    var activePlayer = player;
    player = null;
    clearTimeout(autoReturnTimer);
    autoReturnTimer = 0;
    cleanupPlayerInstance(activePlayer);
    cleanupSurfacePlayers();
    convertedLines = [];
    convertedPresentationGroups = [];
    lastPresentationKey = '';
    romanWrapLayoutCache = new WeakMap();
    lyricDecorationCache = new WeakMap();
    wordAdvanceMaskCache = new WeakMap();
    overlapCompletionMaskCache = new WeakSet();
    backgroundVocalClockCache = new WeakMap();
    earlyCurrentLine = null;
    lastPlaying = null;
    if (emptyState) {
      emptyState.classList.remove('show');
      emptyState.textContent = '';
    }
  }

  function currentTimeMs() {
    try {
      if (typeof window.getLyricPlaybackSeconds === 'function') {
        return Math.max(0, window.getLyricPlaybackSeconds() * 1000);
      }
    } catch (error) {}
    return 0;
  }

  function presentationOptions() {
    return { advanceWordLines:settings.wordAdvanceEnabled === true };
  }

  function setLineMaskClock(mainLine, absoluteTime, frozen) {
    if (!mainLine || typeof mainLine.setMaskAnimationState !== 'function') return;
    var shouldPlay = !frozen && !!window.playing && !document.hidden && !desktopWindowSuspended;
    mainLine.setMaskAnimationState(absoluteTime);
    if (!shouldPlay && typeof mainLine.pause === 'function') mainLine.pause();
  }

  function backgroundAnimationToken(backgroundLine) {
    if (!backgroundLine || typeof backgroundLine.getElement !== 'function') return null;
    var element = backgroundLine.getElement();
    if (!element || typeof element.getAnimations !== 'function') return null;
    var animations = element.getAnimations({ subtree:true });
    if (!animations.length) return null;
    return animations.reduce(function(longest, animation) {
      var timing = animation && animation.effect && animation.effect.getComputedTiming
        ? animation.effect.getComputedTiming()
        : null;
      var longestTiming = longest && longest.effect && longest.effect.getComputedTiming
        ? longest.effect.getComputedTiming()
        : null;
      var endTime = Number(timing && timing.endTime);
      var longestEndTime = Number(longestTiming && longestTiming.endTime);
      return Number.isFinite(endTime) && (!Number.isFinite(longestEndTime) || endTime > longestEndTime)
        ? animation
        : longest;
    }, animations[0]);
  }

  function backgroundAnimationClock(backgroundLine) {
    var token = backgroundAnimationToken(backgroundLine);
    var currentTime = token ? Number(token.currentTime) : NaN;
    return { token:token, currentTime:currentTime };
  }

  function syncBackgroundVocalClocks(timeMs, seek, presentationState) {
    if (!player || !presentationState) return;
    var shouldAnimate = !!window.playing && !document.hidden && !desktopWindowSuspended;
    var groups = Array.isArray(player.currentLyricGroups) ? player.currentLyricGroups : [];
    groups.forEach(function(group) {
      var backgroundLine = group && group.bgLine;
      if (!backgroundLine) return;
      var sourceLine = backgroundLine && typeof backgroundLine.getLine === 'function'
        ? backgroundLine.getLine()
        : null;
      if (!backgroundLine || !sourceLine || typeof backgroundLine.enable !== 'function') return;
      var startTime = Math.max(0, Number(sourceLine.startTime) || 0);
      var endTime = Math.max(startTime, Number(sourceLine.endTime) || startTime);
      var phase = timeMs < startTime ? 'before' : (timeMs >= endTime ? 'after' : 'active');
      var playing = phase === 'active' && shouldAnimate;
      var clock = backgroundAnimationClock(backgroundLine);
      var expectedTime = Math.max(0, Math.min(endTime - startTime, timeMs - startTime));
      var cached = backgroundVocalClockCache.get(backgroundLine);
      var driftTolerance = phase === 'active' ? 50 : 1;
      var drifted = Number.isFinite(clock.currentTime)
        && Math.abs(clock.currentTime - expectedTime) > driftTolerance;
      var shouldSync = seek === true
        || !cached
        || cached.phase !== phase
        || cached.playing !== playing
        || cached.animationToken !== clock.token
        || drifted;
      if (!shouldSync) return;
      var syncTime = phase === 'before' ? startTime : (phase === 'after' ? endTime : timeMs);
      Promise.resolve(backgroundLine.enable(syncTime, playing)).catch(function(error) {
        console.warn('[AppleMusicLyricsBeta] background vocal clock sync failed:',
          error && error.message || error);
      });
      backgroundVocalClockCache.set(backgroundLine, {
        phase:phase,
        playing:playing,
        animationToken:backgroundAnimationToken(backgroundLine)
      });
    });
  }

  function holdLineAnimationsAtSourceStart(mainLine) {
    if (!mainLine
        || typeof mainLine.getLine !== 'function'
        || typeof mainLine.enable !== 'function') return;
    mainLine.enable(Number(mainLine.getLine().startTime) || 0, false);
  }

  function resumePlayerKeepingEarlyLineFrozen() {
    if (!player) return;
    player.resume();
    if (earlyCurrentLine && earlyCurrentLine.mainLine) {
      holdLineAnimationsAtSourceStart(earlyCurrentLine.mainLine);
    }
  }

  function applyWordAdvanceAnimations(state, timeMs, seek) {
    if (!player || !state) return;
    if (seek) wordAdvanceMaskCache = new WeakMap();
    var groups = Array.isArray(player.currentLyricGroups) ? player.currentLyricGroups : [];
    state.groups.forEach(function(presentation, index) {
      var group = groups[index];
      var mainLine = group && group.mainLine;
      if (!mainLine) return;
      var effect = Model.wordAdvanceEffect(presentation, timeMs);
      if (!effect) {
        wordAdvanceMaskCache.delete(mainLine);
        return;
      }
      var cacheKey = effect.mode + ':' + effect.wordTime + ':' + (effect.frozen ? '1' : '0');
      if (effect.frozen && wordAdvanceMaskCache.get(mainLine) === cacheKey) return;
      setLineMaskClock(mainLine, effect.wordTime, effect.frozen);
      wordAdvanceMaskCache.set(mainLine, cacheKey);
    });

    var earlyIndex = state.earlyCurrentGroup;
    if (earlyCurrentLine && earlyCurrentLine.index !== earlyIndex) {
      if (earlyCurrentLine.index === state.currentGroup
          && earlyCurrentLine.mainLine
          && typeof earlyCurrentLine.mainLine.enable === 'function') {
        earlyCurrentLine.mainLine.enable(
          timeMs,
          !!window.playing && !document.hidden && !desktopWindowSuspended
        );
      }
      earlyCurrentLine = null;
    }
    if (earlyIndex >= 0) {
      var earlyGroup = groups[earlyIndex];
      var earlyMainLine = earlyGroup && earlyGroup.mainLine;
      if (earlyMainLine) {
        if (seek || !earlyCurrentLine || earlyCurrentLine.mainLine !== earlyMainLine) {
          holdLineAnimationsAtSourceStart(earlyMainLine);
        }
        earlyCurrentLine = { index:earlyIndex, mainLine:earlyMainLine };
      }
    }
  }

  function applyAppleOverlapCompletionMasks(state, timeMs) {
    if (!player || !state) return;
    var groups = Array.isArray(player.currentLyricGroups) ? player.currentLyricGroups : [];
    state.groups.forEach(function(presentation, index) {
      var overlapCluster = presentation.appleOverlapCluster;
      var group = groups[index];
      var mainLine = group && group.mainLine;
      if (!mainLine || !overlapCluster) return;
      var truncatedAtRelease = presentation.sourceEndTime > overlapCluster.releaseTime;
      if (truncatedAtRelease && timeMs >= overlapCluster.releaseTime) {
        setLineMaskClock(mainLine, presentation.sourceEndTime, true);
        overlapCompletionMaskCache.add(mainLine);
        return;
      }
      if (!overlapCompletionMaskCache.has(mainLine)) return;
      if (typeof mainLine.enable === 'function') {
        mainLine.enable(timeMs, !!window.playing && !document.hidden && !desktopWindowSuspended);
      }
      overlapCompletionMaskCache.delete(mainLine);
    });
  }

  function syncAppleOverlapAnchor(state, seek) {
    if (!player || !state) return;
    var targetIndex = Number(state.overlapAnchorGroup);
    if (!Number.isInteger(targetIndex) || targetIndex < 0) return;
    var timelineState = player.timelineState;
    if (!timelineState || timelineState.scrollToIndex === targetIndex) return;
    timelineState.scrollToIndex = targetIndex;
    if (typeof player.calcLayout === 'function') {
      Promise.resolve(player.calcLayout(seek === true, seek === true)).catch(function(error) {
        console.warn('[AppleMusicLyricsBeta] overlapping Apple anchor layout failed:',
          error && error.message || error);
      });
    }
  }

  function setPresentationTime(timeMs, seek) {
    if (!player) return null;
    var state = Model.presentationStateFromGroups(convertedPresentationGroups, timeMs);
    var groups = Array.isArray(player.currentLyricGroups) ? player.currentLyricGroups : [];
    var restores = [];
    groups.forEach(function(group, index) {
      var presentation = state.groups[index];
      var line = group && group.mainLine && typeof group.mainLine.getLine === 'function'
        ? group.mainLine.getLine()
        : null;
      if (!line || !presentation || !isFinite(presentation.presentationEndTime)) return;
      restores.push({ line:line, startTime:line.startTime, endTime:line.endTime });
      line.startTime = Math.max(0, Number(presentation.presentationStartTime) || 0);
      line.endTime = Math.max(Number(line.startTime) || 0, presentation.presentationEndTime);
    });
    try {
      player.setCurrentTime(timeMs, seek);
    } finally {
      restores.forEach(function(entry) {
        entry.line.startTime = entry.startTime;
        entry.line.endTime = entry.endTime;
      });
    }
    syncBackgroundVocalClocks(timeMs, seek, state);
    syncAppleOverlapAnchor(state, seek);
    applyWordAdvanceAnimations(state, timeMs, seek);
    return state;
  }

  function refreshLyrics(force) {
    if (!player || !Model) return;
    var rawLines = Array.isArray(window.lyricsLines) ? window.lyricsLines : [];
    var timingSource = String(window.lyricsTimingSource || 'none');
    var loading = window.lyricTrackLoading === true;
    if (!force && rawLines === lastRawLines && timingSource === lastTimingSource && loading === lastLoading) return;
    lastRawLines = rawLines;
    lastTimingSource = timingSource;
    lastLoading = loading;
    convertedLines = Model.toAmllLines(rawLines, settings, timingSource);
    convertedPresentationGroups = Model.presentationGroups(convertedLines, presentationOptions());
    var time = currentTimeMs();
    player.setLyricLines(convertedLines, time);
    decorateLyricLayers();
    var presentationState = setPresentationTime(time, true);
    Promise.resolve(player.calcLayout(true, true)).catch(function(error) {
      console.warn('[AppleMusicLyricsBeta] initial layout failed:', error && error.message || error);
    });
    lastPlaybackTimeMs = time;
    lastPresentationKey = '';
    updateLinePresentation(time, true, presentationState, true);
    updateEmptyState(loading, convertedLines.length);
  }

  function updateEmptyState(loading, count) {
    if (!emptyState) return;
    if (count > 0) {
      emptyState.classList.remove('show');
      emptyState.textContent = '';
      return;
    }
    emptyState.textContent = loading
      ? '正在匹配歌词…'
      : '暂无歌词 · 可在歌词设置中选择匹配';
    emptyState.classList.add('show');
  }

  function effectiveSeekTimeMs(line) {
    var delay = 0;
    try {
      if (typeof window.getLyricDelayMs === 'function') {
        delay = Number(window.getLyricDelayMs(window.currentLyricSong && window.currentLyricSong())) || 0;
      }
    } catch (error) {}
    return Math.max(0, Math.round(Number(line && line.startTime || 0) + delay));
  }

  async function seekToLyricLine(index) {
    var line = convertedLines[Number(index)];
    if (!line) return;
    var targetMs = effectiveSeekTimeMs(line);
    var durationMs = typeof window.getPlaybackDurationSeconds === 'function'
      ? Math.max(0, Number(window.getPlaybackDurationSeconds()) || 0) * 1000
      : 0;
    if (durationMs > 0) targetMs = Math.min(targetMs, Math.max(0, durationMs - 50));
    try {
      if (typeof window.seekPlaybackToSeconds !== 'function') throw new Error('Current content is not seekable');
      var result = await window.seekPlaybackToSeconds(targetMs / 1000, { source:'amll-line', silent:true });
      if (!result || !result.ok) throw new Error('Current content is not seekable');
      player.resetScroll();
      setPresentationTime(currentTimeMs(), true);
      player.calcLayout(false, false);
    } catch (error) {
      if (typeof window.showToast === 'function') window.showToast('当前内容暂不支持歌词跳转');
    }
  }

  function scheduleAutoReturn() {
    clearTimeout(autoReturnTimer);
    autoReturnTimer = setTimeout(function() {
      if (!player) return;
      try {
        player.resetScroll();
        setPresentationTime(currentTimeMs(), true);
        player.calcLayout(false, false);
      } catch (error) {}
    }, Math.max(1000, settings.autoReturnSeconds * 1000));
  }

  function bindBrowseReturnEvents(element) {
    ['wheel', 'pointerup', 'touchend'].forEach(function(name) {
      element.addEventListener(name, scheduleAutoReturn, { passive:true });
    });
  }

  function updateRomanWrapState(wrapper, force) {
    var mainLine = wrapper && wrapper.querySelector('.FmKaba_lyricMainLine');
    if (!mainLine) return;
    var layoutKey = Math.round(wrapper.clientWidth * 10) + ':' + settings.romanizationScale;
    if (!force && romanWrapLayoutCache.get(wrapper) === layoutKey) return;
    romanWrapLayoutCache.set(wrapper, layoutKey);
    var romanWords = mainLine.querySelectorAll('.FmKaba_romanWord');
    var rowTops = [];
    romanWords.forEach(function(romanWord) {
      var wordElement = romanWord.closest('.mineradio-amll-korean-column')
        || (romanWord.parentElement && romanWord.parentElement.parentElement);
      if (!wordElement) return;
      var top = wordElement.offsetTop;
      if (!rowTops.some(function(existing){ return Math.abs(existing - top) < 2; })) rowTops.push(top);
    });
    mainLine.classList.toggle('mineradio-amll-roman-wrapped', rowTops.length > 1);
  }

  function alignedKoreanColumns(line) {
    var columns = line && Array.isArray(line.mineradioRomanColumns)
      ? line.mineradioRomanColumns
      : [];
    if (!columns.length) return null;
    var normalized = columns.map(function(column) {
      var sourceText = String(column && column.sourceText || '');
      var romanized = String(column && column.romanized || '').trim().replace(/\s+/g, ' ');
      return sourceText && romanized ? { sourceText:sourceText, romanized:romanized } : null;
    });
    return normalized.every(Boolean) ? normalized : null;
  }

  function renderAlignedKoreanColumns(wrapper, mainLine, flatRomanLine, line) {
    var columns = alignedKoreanColumns(line);
    if (!columns || !mainLine) {
      var staleColumns = mainLine && mainLine.querySelector('.mineradio-amll-korean-columns');
      if (staleColumns) {
        mainLine.textContent = (line && Array.isArray(line.words) ? line.words : []).map(function(word) {
          return String(word && word.word || '');
        }).join('');
        lyricDecorationCache.delete(mainLine);
      }
      wrapper && wrapper.classList.remove('mineradio-amll-has-korean-columns');
      flatRomanLine && flatRomanLine.classList.remove('mineradio-amll-flat-roman-hidden');
      return false;
    }
    var signature = columns.map(function(column) {
      return column.sourceText + '\u0000' + column.romanized;
    }).join('\u0001');
    var existing = mainLine.querySelector('.mineradio-amll-korean-columns');
    if (!existing || existing.getAttribute('data-mineradio-column-signature') !== signature) {
      var container = document.createElement('span');
      container.className = 'mineradio-amll-korean-columns';
      container.setAttribute('data-mineradio-column-signature', signature);
      columns.forEach(function(column) {
        var columnElement = document.createElement('span');
        columnElement.className = 'mineradio-amll-korean-column';
        var source = document.createElement('span');
        source.className = 'mineradio-amll-korean-source';
        source.textContent = column.sourceText;
        var roman = document.createElement('span');
        roman.className = 'FmKaba_romanWord mineradio-amll-korean-roman';
        roman.textContent = column.romanized;
        columnElement.appendChild(source);
        columnElement.appendChild(roman);
        container.appendChild(columnElement);
      });
      mainLine.replaceChildren(container);
      lyricDecorationCache.delete(mainLine);
    }
    wrapper && wrapper.classList.add('mineradio-amll-has-korean-columns');
    flatRomanLine && flatRomanLine.classList.add('mineradio-amll-flat-roman-hidden');
    return true;
  }

  function wrapTextNodeRuns(textNode, originalLayer) {
    if (!textNode || !textNode.parentNode || !textNode.nodeValue) return;
    var text = textNode.nodeValue;
    var latinPattern = /\p{Script=Latin}[\p{Script=Latin}\p{M}]*/gu;
    var fragment = document.createDocumentFragment();
    var cursor = 0;
    var match;
    while ((match = latinPattern.exec(text))) {
      if (match.index > cursor) {
        var prefix = text.slice(cursor, match.index);
        if (originalLayer) {
          var originalPrefix = document.createElement('span');
          originalPrefix.className = 'mineradio-amll-original-run';
          originalPrefix.textContent = prefix;
          fragment.appendChild(originalPrefix);
        } else {
          fragment.appendChild(document.createTextNode(prefix));
        }
      }
      var latinRun = document.createElement('span');
      latinRun.className = (originalLayer ? 'mineradio-amll-original-run ' : '')
        + 'mineradio-amll-latin-run';
      latinRun.textContent = match[0];
      fragment.appendChild(latinRun);
      cursor = match.index + match[0].length;
    }
    if (cursor === 0 && !originalLayer) return;
    if (cursor < text.length) {
      var suffix = text.slice(cursor);
      if (originalLayer) {
        var originalSuffix = document.createElement('span');
        originalSuffix.className = 'mineradio-amll-original-run';
        originalSuffix.textContent = suffix;
        fragment.appendChild(originalSuffix);
      } else {
        fragment.appendChild(document.createTextNode(suffix));
      }
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function decorateTextContainer(container, originalLayer) {
    if (!container) return;
    var textSignature = (originalLayer ? 'original:' : 'latin:') + container.textContent;
    var hasRequiredRuns = originalLayer
      ? !!container.querySelector('.mineradio-amll-original-run')
      : (!/\p{Script=Latin}/u.test(container.textContent)
        || !!container.querySelector('.mineradio-amll-latin-run'));
    if (hasRequiredRuns && lyricDecorationCache.get(container) === textSignature) return;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    var textNodes = [];
    while (walker.nextNode()) {
      var textNode = walker.currentNode;
      var parent = textNode.parentElement;
      if (!parent || parent.closest('.mineradio-amll-original-run, .mineradio-amll-latin-run')) continue;
      if (parent.closest('.FmKaba_rubyWord')) continue;
      if (originalLayer && parent.closest('.FmKaba_romanWord')) continue;
      textNodes.push(textNode);
    }
    textNodes.forEach(function(textNode) {
      wrapTextNodeRuns(textNode, originalLayer);
    });
    lyricDecorationCache.set(container, textSignature);
  }

  function romanWordSourceText(romanWord) {
    if (!romanWord) return '';
    var alignedColumn = romanWord.closest('.mineradio-amll-korean-column');
    if (alignedColumn) {
      var alignedSource = alignedColumn.querySelector('.mineradio-amll-korean-source');
      return String(alignedSource && alignedSource.textContent || '');
    }
    var parent = romanWord.parentElement;
    if (!parent) return '';
    var sourceText = '';
    Array.from(parent.children).some(function(child) {
      if (child === romanWord) return true;
      sourceText += String(child.textContent || '');
      return false;
    });
    return sourceText;
  }

  function koreanRomanSegments(romanWord) {
    if (!romanWord || !/[\uac00-\ud7a3]/u.test(romanWordSourceText(romanWord))) return [];
    var romanText = String(
      romanWord.getAttribute('aria-label') || romanWord.textContent || ''
    ).trim().replace(/\s+/g, ' ');
    return romanText.split(' ').filter(Boolean);
  }

  function romanWordNeedsSegmentation(romanWord) {
    return !!(romanWord
      && !romanWord.classList.contains('mineradio-amll-roman-segmented')
      && koreanRomanSegments(romanWord).length > 1);
  }

  function segmentKoreanRomanWord(romanWord) {
    if (!romanWordNeedsSegmentation(romanWord)) return;
    var romanText = String(romanWord.textContent || '').trim().replace(/\s+/g, ' ');
    var segments = koreanRomanSegments(romanWord);
    var fragment = document.createDocumentFragment();
    segments.forEach(function(segment) {
      var element = document.createElement('span');
      element.className = 'mineradio-amll-roman-syllable';
      element.textContent = segment;
      fragment.appendChild(element);
    });
    romanWord.replaceChildren(fragment);
    romanWord.classList.add('mineradio-amll-roman-segmented');
    romanWord.setAttribute('aria-label', romanText);
    lyricDecorationCache.delete(romanWord);
  }

  function appleKoreanWordColumns(line) {
    var columns = line && Array.isArray(line.mineradioAppleKoreanWordColumns)
      ? line.mineradioAppleKoreanWordColumns
      : [];
    if (!columns.length) return null;
    var normalized = columns.map(function(column) {
      var sourceText = String(column && column.sourceText || '').trim();
      var romanized = String(column && column.romanized || '').trim().replace(/\s+/g, ' ');
      return sourceText && romanized ? { sourceText:sourceText, romanized:romanized } : null;
    });
    return normalized.every(Boolean) ? normalized : null;
  }

  function appleWordSourceText(body, romanWord) {
    if (!body) return '';
    var source = body.querySelector(':scope > .mineradio-amll-apple-word-source');
    if (source) return String(source.textContent || '').trim();
    var text = '';
    Array.from(body.children).some(function(child) {
      if (child === romanWord) return true;
      text += String(child.textContent || '');
      return false;
    });
    return text.trim();
  }

  function renderAppleKoreanWordLayout(mainLine, line) {
    if (!mainLine) return;
    var enabled = !!(line && line.mineradioAppleKoreanLexicalTiming);
    var columns = appleKoreanWordColumns(line);
    var words = Array.from(mainLine.querySelectorAll('.FmKaba_wordWithRuby'));
    var matchesColumns = !!(columns && columns.length === words.length && words.every(function(word, index) {
      var body = word.querySelector(':scope > .FmKaba_wordBody');
      var romanWord = body && body.querySelector(':scope > .FmKaba_romanWord');
      if (!body || !romanWord) return false;
      var romanized = String(romanWord.getAttribute('aria-label') || romanWord.textContent || '')
        .trim().replace(/\s+/g, ' ');
      return appleWordSourceText(body, romanWord) === columns[index].sourceText
        && romanized === columns[index].romanized;
    }));
    words.forEach(function(word) {
      var body = word.querySelector(':scope > .FmKaba_wordBody');
      if (!body) return;
      var ruby = word.querySelector(':scope > .FmKaba_rubyWord');
      var romanWord = body.querySelector(':scope > .FmKaba_romanWord');
      var source = body.querySelector(
        ':scope > .mineradio-amll-apple-word-source, '
        + ':scope > .mineradio-amll-apple-lexical-source'
      );
      var wordLayout = matchesColumns && !!romanWord;
      var lexicalTiming = enabled && !!romanWord && !!(ruby && ruby.children.length);
      word.toggleAttribute('data-mineradio-apple-korean-word-layout', wordLayout);
      word.toggleAttribute('data-mineradio-apple-korean-lexical-timing', lexicalTiming);
      if (!wordLayout && !lexicalTiming) {
        if (source) {
          while (source.firstChild) body.insertBefore(source.firstChild, source);
          source.remove();
        }
        return;
      }
      if (source) {
        source.classList.toggle('mineradio-amll-apple-word-source', wordLayout);
        source.classList.add('mineradio-amll-apple-lexical-source');
        return;
      }
      var sourceLayer = document.createElement('div');
      sourceLayer.className = (wordLayout ? 'mineradio-amll-apple-word-source ' : '')
        + 'mineradio-amll-apple-lexical-source';
      while (body.firstChild && body.firstChild !== romanWord) sourceLayer.appendChild(body.firstChild);
      body.insertBefore(sourceLayer, romanWord);
    });
  }

  function decorateLyricText(wrapper, lyricElement, line, allowAlignedColumns) {
    if (!lyricElement) return;
    var mainLine = lyricElement.querySelector('.FmKaba_lyricMainLine');
    var flatRomanLine = lyricElement.querySelector('.FmKaba_lyricSubLine:nth-child(3)');
    if (allowAlignedColumns) renderAlignedKoreanColumns(wrapper, mainLine, flatRomanLine, line);
    renderAppleKoreanWordLayout(mainLine, line);
    decorateTextContainer(mainLine, true);
    mainLine && mainLine.querySelectorAll('.FmKaba_romanWord').forEach(function(romanWord) {
      segmentKoreanRomanWord(romanWord);
      decorateTextContainer(romanWord, false);
    });
    decorateTextContainer(lyricElement.querySelector('.FmKaba_lyricSubLine:nth-child(2)'), false);
    decorateTextContainer(flatRomanLine, false);
  }

  function decorateWrapperText(wrapper, lineGroup) {
    if (!wrapper) return;
    var foreground = wrapper.querySelector('.FmKaba_lyricLine:not(.FmKaba_lyricBgLine)');
    decorateLyricText(wrapper, foreground, lineGroup && lineGroup.main, true);
    var backgroundLines = lineGroup && Array.isArray(lineGroup.background)
      ? lineGroup.background
      : [];
    wrapper.querySelectorAll('.FmKaba_lyricBgLine').forEach(function(background, index) {
      decorateLyricText(wrapper, background, backgroundLines[index], false);
    });
  }

  function decorateLyricLayers() {
    if (!player) return;
    var groups = Array.isArray(player.currentLyricGroups) ? player.currentLyricGroups : [];
    var lineGroups = convertedLyricLayerGroups();
    groups.forEach(function(group, index) {
      decorateWrapperText(lyricGroupWrapper(group), lineGroups[index]);
    });
  }

  function convertedLyricLayerGroups() {
    var groups = [];
    convertedLines.forEach(function(line) {
      if (line && line.isBG === true) {
        if (groups.length) groups[groups.length - 1].background.push(line);
        return;
      }
      if (line) groups.push({ main:line, background:[] });
    });
    return groups;
  }

  function lyricGroupWrapper(group) {
    var wrapper = group && group.element;
    if (wrapper && wrapper.classList
        && wrapper.classList.contains('FmKaba_lyricLineWrapper')) return wrapper;
    var mainElement = group && group.mainLine && typeof group.mainLine.getElement === 'function'
      ? group.mainLine.getElement()
      : null;
    return mainElement && typeof mainElement.closest === 'function'
      ? mainElement.closest('.FmKaba_lyricLineWrapper')
      : null;
  }

  function mountedLyricNeedsDecoration(lyricElement, line, checkAlignedColumns) {
    if (!lyricElement) return false;
    var mainLine = lyricElement.querySelector('.FmKaba_lyricMainLine');
    if (!mainLine || !mainLine.textContent.trim()) return false;
    var lexicalWords = Array.from(mainLine.querySelectorAll('.FmKaba_wordWithRuby'));
    var markedLexicalWords = lexicalWords.filter(function(word) {
      return word.hasAttribute('data-mineradio-apple-korean-lexical-timing');
    });
    var expectedLexicalWords = line && line.mineradioAppleKoreanLexicalTiming
      ? (Array.isArray(line.words) ? line.words : []).filter(function(word) {
        return Array.isArray(word && word.ruby) && word.ruby.some(function(segment) {
          return segment && String(segment.word || '').trim();
        });
      }).length
      : 0;
    if (markedLexicalWords.length !== expectedLexicalWords) return true;
    var expectedWordColumns = appleKoreanWordColumns(line);
    var markedWordColumns = lexicalWords.filter(function(word) {
      return word.hasAttribute('data-mineradio-apple-korean-word-layout');
    });
    if (markedWordColumns.length !== (expectedWordColumns ? expectedWordColumns.length : 0)) return true;
    if (markedWordColumns.some(function(word) {
      var body = word.querySelector(':scope > .FmKaba_wordBody');
      return !body || !body.querySelector(':scope > .mineradio-amll-apple-word-source');
    })) return true;
    if (markedLexicalWords.some(function(word) {
      var body = word.querySelector(':scope > .FmKaba_wordBody');
      return !body || !body.querySelector(':scope > .mineradio-amll-apple-lexical-source');
    })) return true;
    if (checkAlignedColumns && alignedKoreanColumns(line)) {
      var flatRomanLine = lyricElement.querySelector('.FmKaba_lyricSubLine:nth-child(3)');
      if (!mainLine.querySelector('.mineradio-amll-korean-columns')
          || flatRomanLine && !flatRomanLine.classList.contains('mineradio-amll-flat-roman-hidden')) return true;
    }
    if (Array.from(mainLine.querySelectorAll('.FmKaba_romanWord')).some(romanWordNeedsSegmentation)) {
      return true;
    }
    return !mainLine.querySelector('.mineradio-amll-original-run');
  }

  function mountedWrapperNeedsDecoration(wrapper, lineGroup) {
    if (!wrapper || !wrapper.isConnected) return false;
    var foreground = wrapper.querySelector('.FmKaba_lyricLine:not(.FmKaba_lyricBgLine)');
    if (mountedLyricNeedsDecoration(foreground, lineGroup && lineGroup.main, true)) return true;
    var backgroundLines = lineGroup && Array.isArray(lineGroup.background)
      ? lineGroup.background
      : [];
    return Array.from(wrapper.querySelectorAll('.FmKaba_lyricBgLine')).some(function(background, index) {
      return mountedLyricNeedsDecoration(background, backgroundLines[index], false);
    });
  }

  function updateLinePresentation(timeMs, force, state, forceRomanMeasure) {
    if (!player || !convertedLines.length) return;
    state = state || Model.presentationStateFromGroups(convertedPresentationGroups, timeMs);
    var now = performance.now();
    var stateKey = state.currentGroup + ':' + state.anchorGroup + ':'
      + (state.interlude ? '1' : '0') + ':' + state.states.join(',');
    var groups = Array.isArray(player.currentLyricGroups) ? player.currentLyricGroups : [];
    var lineGroups = convertedLyricLayerGroups();
    var needsMountedDecoration = groups.some(function(group, index) {
      return mountedWrapperNeedsDecoration(lyricGroupWrapper(group), lineGroups[index]);
    });
    if (!force && !needsMountedDecoration
        && stateKey === lastPresentationKey && now - lastPresentationUpdateAt < 220) return;
    lastPresentationKey = stateKey;
    lastPresentationUpdateAt = now;
    var reduce = runtimeReducedMotion();
    var qualityScale = settings.renderQuality === 'power' ? 0.58 : 1;
    var firstFuture = state.states.indexOf('future');
    var anchor = state.anchorGroup >= 0
      ? state.anchorGroup
      : (firstFuture >= 0 ? firstFuture : Math.max(0, state.states.length - 1));
    groups.forEach(function(group, index) {
      var wrapper = lyricGroupWrapper(group);
      if (!wrapper) return;
      var lineState = state.states[index] || 'future';
      var future = lineState === 'future';
      var distance = Math.max(1, Math.abs(index - anchor));
      var blur = future
        ? Math.min(12, settings.futureBlur * qualityScale * (1.5 + Math.min(5, distance) * 1.2))
        : 0;
      if (reduce) blur *= 0.35;
      wrapper.setAttribute('data-mineradio-line-state', lineState);
      wrapper.toggleAttribute('data-mineradio-anchor-current', index === state.anchorGroup);
      wrapper.toggleAttribute('data-mineradio-blur-future', future);
      wrapper.style.setProperty('--amll-beta-line-blur', blur.toFixed(2) + 'px');
      wrapper.style.setProperty('--amll-beta-line-distance', String(distance));
      if (!wrapper.isConnected) return;
      decorateWrapperText(wrapper, lineGroups[index]);
      updateRomanWrapState(wrapper, forceRomanMeasure === true);
    });
  }

  function snapToPlaybackTime() {
    if (player) explicitSnapPending = true;
  }

  function updatePlaybackState() {
    if (!player) return;
    var isPlaying = !!window.playing && !document.hidden && !desktopWindowSuspended;
    if (isPlaying === lastPlaying) return;
    lastPlaying = isPlaying;
    try {
      if (isPlaying) resumePlayerKeepingEarlyLineFrozen();
      else player.pause();
    } catch (error) {}
  }

  function renderFrame(now) {
    if (!running) return;
    requestAnimationFrame(renderFrame);
    var active = shouldShowBeta();
    if (active && !ensurePlayer()) return;
    updateStageVisibility(active && !!player);
    if (!active || !player) {
      lastFrameAt = now;
      return;
    }

    refreshLyrics(false);
    if (document.hidden || desktopWindowSuspended) {
      lastFrameAt = now;
      return;
    }

    var delta = Math.max(0, Math.min(64, now - lastFrameAt));
    var timeMs = currentTimeMs();
    var explicitSnap = explicitSnapPending;
    explicitSnapPending = false;
    var seek = explicitSnap
      || lastVisibility
      || timeMs + 80 < lastPlaybackTimeMs
      || Math.abs(timeMs - lastPlaybackTimeMs) > 900;
    lastVisibility = false;
    lastFrameAt = now;
    lastPlaybackTimeMs = timeMs;
    try {
      var presentationState = setPresentationTime(timeMs, seek);
      if (explicitSnap) player.calcLayout(true, true);
      player.update(delta);
      applyAppleOverlapCompletionMasks(presentationState, timeMs);
      updatePlaybackState();
      updateLinePresentation(timeMs, seek, presentationState, false);
    } catch (error) {
      disposePlayer();
      playerCreationFailed = true;
      showRuntimeFailure(error);
    }
  }

  function applySettings(options) {
    options = options || {};
    settings = Model.normalizeSettings(settings);
    saveSettings();
    syncSettingsControls();
    if (!settings.enabled) {
      playerCreationFailed = false;
      updateStageVisibility(false);
      disposePlayer();
      return;
    }
    if (options.retryPlayer) playerCreationFailed = false;
    var createdPlayer = false;
    if (shouldShowBeta() && !player) createdPlayer = ensurePlayer();
    if (player) {
      try {
        if (!createdPlayer) configurePlayer();
        if (createdPlayer || options.rebuildLyrics) refreshLyrics(true);
        else {
          player.calcLayout(true, false);
          updateLinePresentation(currentTimeMs(), true, null, true);
        }
      } catch (error) {
        disposePlayer();
        playerCreationFailed = true;
        showRuntimeFailure(error);
      }
    }
    updateStageVisibility(shouldShowBeta() && !!player);
  }

  function settingLabel(key, value) {
    if (key === 'anchorPosition') return Math.round(value * 100) + '%';
    if (key === 'fontScale') return Math.round(value * 100) + '%';
    if (key === 'fontWeight') return String(Math.round(value));
    if (key === 'futureBlur' || key === 'transitionStrength') return Number(value).toFixed(2);
    if (key === 'translationScale' || key === 'romanizationScale' || key === 'backgroundVocalScale') {
      return Math.round(value * 100) + '%';
    }
    if (key === 'autoReturnSeconds') return Number(value).toFixed(1) + ' 秒';
    return String(value);
  }

  function syncSettingsControls() {
    document.querySelectorAll('[data-amll-setting]').forEach(function(control) {
      var key = control.getAttribute('data-amll-setting');
      if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
      if (control.type === 'checkbox') control.checked = !!settings[key];
      else if (control.type === 'radio') control.checked = String(control.value) === String(settings[key]);
      else control.value = settings[key];
    });
    document.querySelectorAll('[data-amll-output]').forEach(function(output) {
      var key = output.getAttribute('data-amll-output');
      if (Object.prototype.hasOwnProperty.call(settings, key)) output.textContent = settingLabel(key, settings[key]);
    });
    var card = document.getElementById('apple-music-lyrics-beta-card');
    var summary = document.getElementById('apple-music-lyrics-beta-summary');
    if (card) card.classList.toggle('enabled', settings.enabled);
    if (summary) summary.textContent = settings.enabled ? '已开启 · 独立多行渲染' : '默认关闭 · 点击进入独立设置';
    syncAppleMusicAuthControls();
  }

  function readControlValue(control) {
    if (control.type === 'checkbox') return control.checked;
    if (control.type === 'range' || control.type === 'number') return Number(control.value);
    return control.value;
  }

  function bindSettingsControls() {
    document.querySelectorAll('[data-amll-setting]').forEach(function(control) {
      var apply = function() {
        if (control.type === 'radio' && !control.checked) return;
        var key = control.getAttribute('data-amll-setting');
        var previousSourcePolicy = effectiveSourcePolicyKey(settings);
        settings[key] = readControlValue(control);
        if (key === 'appleMusicSourceEnabled' && settings.appleMusicSourceEnabled !== true) {
          settings.appleMusicTranslationPriority = false;
        }
        var rebuild = key === 'showTranslation'
          || key === 'showRomanization'
          || key === 'wordAdvanceEnabled';
        applySettings({
          rebuildLyrics:rebuild,
          retryPlayer:key === 'enabled' && settings.enabled === true
        });
        if (key === 'enabled' || key === 'appleMusicSourceEnabled' || key === 'appleMusicTranslationPriority') {
          if (effectiveSourcePolicyKey(settings) !== previousSourcePolicy) {
            reloadCurrentLyricsForSourcePolicy();
          }
        }
      };
      control.addEventListener(control.type === 'range' ? 'input' : 'change', apply);
    });
    var reset = document.getElementById('apple-music-lyrics-beta-reset');
    if (reset) reset.addEventListener('click', function() {
      if (!window.confirm('恢复 Apple Music 歌词 Beta 的全部默认设置？')) return;
      var previousSourcePolicy = effectiveSourcePolicyKey(settings);
      settings = Model.normalizeSettings(Model.DEFAULT_SETTINGS);
      applySettings({ rebuildLyrics:true });
      if (effectiveSourcePolicyKey(settings) !== previousSourcePolicy) {
        reloadCurrentLyricsForSourcePolicy();
      }
      if (typeof window.showToast === 'function') window.showToast('Apple Music 歌词设置已恢复默认');
    });
  }

  function openSettings() {
    var modal = document.getElementById('apple-music-lyrics-beta-settings');
    if (!modal) return;
    syncSettingsControls();
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    loadAppleMusicAuthStatus();
  }

  function closeSettings() {
    var modal = document.getElementById('apple-music-lyrics-beta-settings');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  function init() {
    if (!Model) {
      showRuntimeFailure(new Error('Apple Music lyrics model did not load'));
      return;
    }
    stage = document.getElementById('apple-music-lyrics-beta-stage');
    surface = document.getElementById('apple-music-lyrics-beta-surface');
    emptyState = document.getElementById('apple-music-lyrics-beta-empty');
    if (!stage || !surface) return;
    stage.inert = true;
    bindSettingsControls();
    bindAppleMusicSourceControls();
    syncSettingsControls();
    loadAppleMusicAuthStatus();
    if (settings.enabled) ensurePlayer();
    refreshLyrics(true);
    updateStageVisibility(shouldShowBeta() && !!player);
    if (window.desktopWindow && typeof window.desktopWindow.onStateChange === 'function') {
      removeDesktopStateListener = window.desktopWindow.onStateChange(handleDesktopWindowState);
      if (typeof window.desktopWindow.getState === 'function') {
        Promise.resolve(window.desktopWindow.getState()).then(handleDesktopWindowState).catch(function(){});
      }
    }
    requestAnimationFrame(renderFrame);
  }

  function handleDesktopWindowState(state) {
    state = state || {};
    var suspended = state.isMinimized === true || state.isVisible === false;
    if (suspended === desktopWindowSuspended) return;
    desktopWindowSuspended = suspended;
    if (!player) return;
    try {
      if (suspended) {
        player.pause();
        lastPlaying = false;
      } else {
        setPresentationTime(currentTimeMs(), true);
        player.calcLayout(true, true);
        lastVisibility = true;
        lastPlaying = null;
        updatePlaybackState();
      }
    } catch (error) {}
  }

  window.openAppleMusicLyricsBetaSettings = openSettings;
  window.closeAppleMusicLyricsBetaSettings = closeSettings;
  window.MineradioAppleMusicLyrics = Object.freeze({
    isEnabled: lyricsFeatureEnabled,
    isActive: function(){ return shouldShowBeta() && !!player; },
    refresh: function(){ if (player) refreshLyrics(true); },
    snap: snapToPlaybackTime,
    getSettings: function(){ return Object.assign({}, settings); },
    getSourcePolicy: sourcePolicy,
    refreshSourceStatus: loadAppleMusicAuthStatus
  });

  document.addEventListener('visibilitychange', function() {
    lastVisibility = document.hidden;
    if (!player) return;
    try {
      if (document.hidden) player.pause();
      else {
        setPresentationTime(currentTimeMs(), true);
        if (window.playing) resumePlayerKeepingEarlyLineFrozen();
        player.calcLayout(true, true);
      }
    } catch (error) {}
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') closeSettings();
  });
  if (systemReducedMotion && typeof systemReducedMotion.addEventListener === 'function') {
    systemReducedMotion.addEventListener('change', function(){ applySettings(); });
  }
  window.addEventListener('beforeunload', function() {
    running = false;
    if (typeof removeDesktopStateListener === 'function') removeDesktopStateListener();
    disposePlayer();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
