'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const profileDir = path.join(root, 'output', 'amll-beta-electron-profile');
app.setPath('userData', profileDir);
app.setPath('sessionData', path.join(profileDir, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(window, expression, timeoutMs = 4000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(pathToFileURL(path.join(__dirname, 'fixtures', 'amll-beta-smoke.html')).href);
  await waitFor(window, `document.querySelectorAll('.FmKaba_lyricLineWrapper').length === 6
    && Number(getComputedStyle(document.querySelector('.FmKaba_lyricLine')).opacity) > 0.99
    && document.querySelector('.FmKaba_lyricMainLine').getBoundingClientRect().height > 10`);
  await delay(450);
  const first = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('.mineradio-amll-player');
    const wrappers = root ? Array.from(root.querySelectorAll('.FmKaba_lyricLineWrapper')) : [];
    const mainLine = root && root.querySelector('.FmKaba_lyricMainLine');
    const activeWrapper = wrappers[0];
    const rootRect = root && root.getBoundingClientRect();
    const lineRect = mainLine && mainLine.getBoundingClientRect();
    const activeRect = activeWrapper && activeWrapper.getBoundingClientRect();
    return {
      coreLoaded: !!window.MineradioAMLLCore,
      active: document.body.classList.contains('apple-music-lyrics-beta-active'),
      stageVisible: document.getElementById('apple-music-lyrics-beta-stage').classList.contains('active'),
      oldStageHidden: window.stageLyrics.group.visible === false,
      lineCount: wrappers.length,
      customOpacityStateCount: root ? root.querySelectorAll('[data-mineradio-line-state]').length : -1,
      currentState: activeWrapper && activeWrapper.getAttribute('data-mineradio-line-state'),
      translation: root && root.textContent.includes('你知道的'),
      romanization: root && root.textContent.includes('al') && root.textContent.includes('jan'),
      rootRect: rootRect && { width:rootRect.width, height:rootRect.height },
      lineRect: lineRect && { x:lineRect.x, y:lineRect.y, width:lineRect.width, height:lineRect.height },
      activeRect: activeRect && { x:activeRect.x, y:activeRect.y, width:activeRect.width, height:activeRect.height },
      lineOpacity: mainLine && getComputedStyle(mainLine).opacity,
      lineColor: mainLine && getComputedStyle(mainLine).color,
      activeTranslationOpacity: activeWrapper && activeWrapper.querySelector('.FmKaba_lyricSubLine:nth-child(2)')
        ? Number.parseFloat(getComputedStyle(activeWrapper.querySelector('.FmKaba_lyricSubLine:nth-child(2)')).opacity)
        : 0,
      activeWrapperOpacity: activeWrapper
        ? Number.parseFloat(getComputedStyle(activeWrapper).opacity)
        : 0,
      activeInnerLineOpacity: activeWrapper && activeWrapper.querySelector('.FmKaba_lyricLine')
        ? Number.parseFloat(getComputedStyle(activeWrapper.querySelector('.FmKaba_lyricLine')).opacity)
        : 0,
      futureTranslationOpacity: wrappers[1] && wrappers[1].querySelector('.FmKaba_lyricSubLine:nth-child(2)')
        ? Number.parseFloat(getComputedStyle(wrappers[1].querySelector('.FmKaba_lyricSubLine:nth-child(2)')).opacity)
        : 0,
      futureWrapperOpacity: wrappers[1]
        ? Number.parseFloat(getComputedStyle(wrappers[1]).opacity)
        : 0,
      futureInnerLineOpacity: wrappers[1] && wrappers[1].querySelector('.FmKaba_lyricLine')
        ? Number.parseFloat(getComputedStyle(wrappers[1].querySelector('.FmKaba_lyricLine')).opacity)
        : 0,
      mainFontSize: mainLine && Number.parseFloat(getComputedStyle(mainLine).fontSize),
      romanFontSize: root && root.querySelector('.FmKaba_romanWord')
        ? Number.parseFloat(getComputedStyle(root.querySelector('.FmKaba_romanWord')).fontSize)
        : 0,
      lineTexts: wrappers.map(wrapper => String(wrapper.textContent || '').replace(/\s+/g, ' ').trim()),
    };
  })()`);
  assert.equal(first.coreLoaded, true);
  assert.equal(first.active, true);
  assert.equal(first.stageVisible, true);
  assert.equal(first.oldStageHidden, true);
  assert.equal(first.lineCount, 6);
  assert(first.lineTexts[0].includes('알잖아'),
    `the first mounted wrapper must be the first lyric group: ${JSON.stringify(first.lineTexts)}`);
  assert.equal(first.customOpacityStateCount, 6,
    'every AMLL group must receive a Mineradio presentation state');
  assert.equal(first.currentState, 'current');
  assert(Math.abs(first.activeTranslationOpacity - 0.78) < 0.01,
    `current translations must use the fixed 78% opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(first.activeWrapperOpacity - 1) < 0.01,
    `the current wrapper must not multiply translation opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(first.activeInnerLineOpacity - 1) < 0.01,
    `the current inner line must not multiply translation opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(
    first.activeWrapperOpacity * first.activeInnerLineOpacity * first.activeTranslationOpacity - 0.78
  ) < 0.01, `the current translation must have 78% composite opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(first.futureTranslationOpacity - 0.58) < 0.01,
    `future translations must use the fixed 58% opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(first.futureWrapperOpacity - 1) < 0.01,
    `future wrappers must not multiply layer opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(first.futureInnerLineOpacity - 1) < 0.01,
    `the future inner line must not multiply row opacity: ${JSON.stringify(first)}`);
  assert(Math.abs(
    first.futureWrapperOpacity * first.futureInnerLineOpacity * first.futureTranslationOpacity - 0.58
  ) < 0.01, `future translations must have 58% composite opacity: ${JSON.stringify(first)}`);
  assert.equal(first.translation, true);
  assert.equal(first.romanization, true);
  assert(first.rootRect.width > 100 && first.rootRect.height > 100, JSON.stringify(first));
  assert(first.lineRect.width > 100 && first.lineRect.height > 10, JSON.stringify(first));
  assert(first.lineRect.x < 1280 && first.lineRect.y < 720, JSON.stringify(first));
  assert(Number(first.lineOpacity) > 0, JSON.stringify(first));
  assert.notEqual(first.lineColor, 'rgba(0, 0, 0, 0)', JSON.stringify(first));
  assert(Math.abs(first.romanFontSize / first.mainFontSize - 0.68) < 0.03,
    `QRC romanization size slider must control the rendered word size: ${JSON.stringify(first)}`);

  const toggle = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#amll-beta-smoke-toggle-row input[type="checkbox"]');
    const style = getComputedStyle(input);
    const knob = getComputedStyle(input, '::before');
    const before = input.checked;
    document.getElementById('amll-beta-smoke-toggle-row').click();
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      radius: Number.parseFloat(style.borderRadius),
      knobWidth: Number.parseFloat(knob.width),
      before,
      after: input.checked,
    };
  })()`);
  assert(toggle.width >= 36 && toggle.height >= 20 && toggle.radius >= 10 && toggle.knobWidth >= 14,
    `AMLL boolean settings must render as iOS-style slider switches: ${JSON.stringify(toggle)}`);
  assert.notEqual(toggle.before, toggle.after, 'clicking the whole settings row must toggle the switch');
  await window.webContents.executeJavaScript(
    `document.getElementById('amll-beta-smoke-toggle-row').click()`
  );
  await waitFor(window, `document.querySelector('.FmKaba_romanWord')`);

  const creditFilter = await window.webContents.executeJavaScript(`(() => ({
    compactChinese: [
      '作词张三',
      '制作人李四',
      '人声编辑王五'
    ].every(text => window.MineradioLyricCreditFilter.isLeadingCreditText(text)),
    compactEnglish: [
      'MixingEngineerCarol',
      'MasteringDave',
      'RecordingEngineerEve'
    ].every(text => window.MineradioLyricCreditFilter.isLeadingCreditText(text)),
    preservesLyric: !window.MineradioLyricCreditFilter.isLeadingCreditText('Composer of my own fate')
      && !window.MineradioLyricCreditFilter.isLeadingCreditText('作词的人也会唱歌'),
  }))()`);
  assert.deepEqual(creditFilter, { compactChinese:true, compactEnglish:true, preservesLyric:true },
    'the production lyric-credit filter must run correctly in Electron without deleting lyric-like text');
  const screenshot = await window.webContents.capturePage();
  const screenshotPath = path.join(root, 'output', 'amll-beta-runtime-smoke.png');
  fs.mkdirSync(path.dirname(screenshotPath), { recursive:true });
  fs.writeFileSync(screenshotPath, screenshot.toPNG());

  await window.webContents.executeJavaScript('window.testLyricTime = 5');
  await waitFor(window, `document.querySelector('.mineradio-amll-player .FmKaba_interludeDots.FmKaba_enabled')`);
  const interlude = await window.webContents.executeJavaScript(`(() => {
    const nativeDots = document.querySelector('.mineradio-amll-player .FmKaba_interludeDots.FmKaba_enabled');
    return {
      active: !!nativeDots,
      dots: nativeDots ? nativeDots.children.length : 0,
      customDotsRemoved: !document.getElementById('apple-music-lyrics-beta-interlude'),
    };
  })()`);
  assert.equal(interlude.active, true);
  assert.equal(interlude.dots, 3);
  assert.equal(interlude.customDotsRemoved, true);

  await window.webContents.executeJavaScript('window.testLyricTime = 14.5');
  await waitFor(window, `document.querySelectorAll('.FmKaba_lyricLineWrapper')[2]
    .getAttribute('data-mineradio-line-state') === 'current'`);
  const shortGapHold = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[2];
    return {
      state: wrapper.getAttribute('data-mineradio-line-state'),
      active: wrapper.querySelector('.FmKaba_lyricMainLine').classList.contains('FmKaba_active')
    };
  })()`);
  assert.deepEqual(shortGapHold, { state:'current', active:true },
    'a completed lyric must stay fully active through a short blank until the next foreground lyric starts');

  await window.webContents.executeJavaScript('window.testLyricTime = 9.4');
  await waitFor(window, `Number(getComputedStyle(
    document.querySelectorAll('.FmKaba_lyricLineWrapper')[1].querySelector('.FmKaba_lyricLine')
  ).opacity) > 0.99`);
  const secondMainLineOpacity = await window.webContents.executeJavaScript(
    `getComputedStyle(document.querySelectorAll('.FmKaba_lyricLineWrapper')[1]
      .querySelector('.FmKaba_lyricLine')).opacity`
  );
  assert.equal(secondMainLineOpacity, '1',
    'the second main lyric line must retain AMLL Core full active opacity');

  await window.webContents.executeJavaScript('window.testLyricTime = 10.95');
  await waitFor(window, `document.querySelectorAll('.FmKaba_lyricLineWrapper')[1]
    .getAttribute('data-mineradio-line-state') === 'past'
    && document.querySelectorAll('.FmKaba_lyricLineWrapper')[2]
    .getAttribute('data-mineradio-line-state') === 'current'`);
  const interruptedAdvance = await window.webContents.executeJavaScript(`(() => {
    const wrappers = document.querySelectorAll('.FmKaba_lyricLineWrapper');
    const fadeState = index => {
      const animation = wrappers[index].getAnimations({ subtree:true })
        .find(item => String(item.id || '').startsWith('fade-word-'));
       const timing = animation && animation.effect && animation.effect.getComputedTiming();
       return animation ? {
         id:String(animation.id || ''),
         time:Number(animation.currentTime) || 0,
         duration:Number(timing && timing.duration) || 0,
         playState:animation.playState,
       } : null;
    };
    return {
      previousState:wrappers[1].getAttribute('data-mineradio-line-state'),
      nextState:wrappers[2].getAttribute('data-mineradio-line-state'),
      previousFade:fadeState(1),
      nextFade:fadeState(2),
    };
  })()`);
  assert.equal(interruptedAdvance.previousState, 'past');
  assert.equal(interruptedAdvance.nextState, 'current');
  assert(interruptedAdvance.previousFade.time >= interruptedAdvance.previousFade.duration - 45,
  JSON.stringify(interruptedAdvance));
  assert.equal(interruptedAdvance.previousFade.playState, 'paused');
  assert(interruptedAdvance.nextFade, JSON.stringify(interruptedAdvance));
  assert.equal(interruptedAdvance.nextFade.playState, 'paused',
    'an early current line must keep its QRC animation at the real source start');

  await window.webContents.executeJavaScript('window.testLyricTime = 12.5');
  await waitFor(window, `Number(getComputedStyle(
    document.querySelectorAll('.FmKaba_lyricLineWrapper')[2].querySelector('.FmKaba_lyricLine')
  ).opacity) > 0.99`);
  const fourthLineOpacity = await window.webContents.executeJavaScript(
    `getComputedStyle(document.querySelectorAll('.FmKaba_lyricLineWrapper')[2]
      .querySelector('.FmKaba_lyricLine')).opacity`
  );
  assert.equal(fourthLineOpacity, '1',
    'a main line after grouped background vocals must remain fully opaque');

  await window.webContents.executeJavaScript('window.testLyricTime = 15.5');
  await waitFor(window, `Array.from(document.querySelectorAll('.FmKaba_lyricSubLine:nth-child(3)'))
    .some(line => line.textContent === 'sayonara')`);
  const lineRomanizationScale = await window.webContents.executeJavaScript(`(() => {
    const line = Array.from(document.querySelectorAll('.FmKaba_lyricSubLine:nth-child(3)'))
      .find(element => element.textContent === 'sayonara');
    const main = line && line.parentElement.querySelector('.FmKaba_lyricMainLine');
    return line && main
      ? Number.parseFloat(getComputedStyle(line).fontSize) / Number.parseFloat(getComputedStyle(main).fontSize)
      : 0;
  })()`);
  assert(Math.abs(lineRomanizationScale - 0.68) < 0.03,
    `LRC line romanization size slider must control the rendered sub-line size: ${lineRomanizationScale}`);

  await window.webContents.executeJavaScript('window.testLyricTime = 19.52');
  await waitFor(window, `document.querySelectorAll('.FmKaba_lyricLineWrapper')[4]
    .getAttribute('data-mineradio-line-state') === 'current'`);
  const acceleratedFadeTime = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[4];
    const animation = wrapper.getAnimations({ subtree:true })
      .find(item => String(item.id || '').startsWith('fade-word-'));
    return animation ? Number(animation.currentTime) || 0 : 0;
  })()`);
  assert(acceleratedFadeTime > 1800 && acceleratedFadeTime < 1900,
    `the final QRC word must be visibly accelerated before a seamless handoff: ${acceleratedFadeTime}`);

  await window.webContents.executeJavaScript('window.desktopStateListener({ isMinimized:true, isVisible:true })');
  await waitFor(window, `!document.querySelector('.mineradio-amll-player').classList.contains('FmKaba_playing')`);
  const pausedFadeTime = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[4];
    const animation = wrapper.getAnimations({ subtree:true })
      .find(item => String(item.id || '').startsWith('fade-word-'));
    return animation ? Number(animation.currentTime) || 0 : 0;
  })()`);
  await delay(180);
  const pausedFadeTimeAfterDelay = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[4];
    const animation = wrapper.getAnimations({ subtree:true })
      .find(item => String(item.id || '').startsWith('fade-word-'));
    return animation ? Number(animation.currentTime) || 0 : 0;
  })()`);
  assert(Math.abs(pausedFadeTimeAfterDelay - pausedFadeTime) < 8,
    'pause/minimize must freeze the accelerated word animation');
  await window.webContents.executeJavaScript('window.desktopStateListener({ isMinimized:false, isVisible:true })');
  await waitFor(window, `document.querySelector('.mineradio-amll-player').classList.contains('FmKaba_playing')`);

  await window.webContents.executeJavaScript(`(() => {
    window.testLyricTime = 19.85;
    window.MineradioAppleMusicLyrics.snap();
  })()`);
  await waitFor(window, `document.querySelectorAll('.FmKaba_lyricLineWrapper')[4]
    .getAttribute('data-mineradio-line-state') === 'past'
    && document.querySelectorAll('.FmKaba_lyricLineWrapper')[5]
    .getAttribute('data-mineradio-line-state') === 'current'`);
  const seekedNextFade = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[5];
    const animation = wrapper.getAnimations({ subtree:true })
      .find(item => String(item.id || '').startsWith('fade-word-'));
    return animation ? { time:Number(animation.currentTime) || 0, playState:animation.playState } : null;
  })()`);
  assert(seekedNextFade.time < 12 && seekedNextFade.playState === 'paused',
    `seek must rebuild the early line at zero QRC progress: ${JSON.stringify(seekedNextFade)}`);

  await window.webContents.executeJavaScript('window.desktopStateListener({ isMinimized:true, isVisible:true })');
  await waitFor(window, `!document.querySelector('.mineradio-amll-player').classList.contains('FmKaba_playing')`);
  await window.webContents.executeJavaScript('window.desktopStateListener({ isMinimized:false, isVisible:true })');
  await waitFor(window, `document.querySelector('.mineradio-amll-player').classList.contains('FmKaba_playing')`);
  await delay(180);
  const resumedEarlyFade = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[5];
    const animation = wrapper.getAnimations({ subtree:true })
      .find(item => String(item.id || '').startsWith('fade-word-'));
    return animation ? { time:Number(animation.currentTime) || 0, playState:animation.playState } : null;
  })()`);
  assert(resumedEarlyFade.time < 12 && resumedEarlyFade.playState === 'paused',
    `restoring the window must not start an early line before its QRC source time: ${JSON.stringify(resumedEarlyFade)}`);

  await window.webContents.executeJavaScript('window.testLyricTime = 22.2');
  await waitFor(window, `document.querySelectorAll('.FmKaba_lyricLineWrapper')[5]
    .getAttribute('data-mineradio-line-state') === 'past'`);
  const finalTranslationOpacity = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelectorAll('.FmKaba_lyricLineWrapper')[5];
    const translation = wrapper.querySelector('.FmKaba_lyricSubLine:nth-child(2)');
    return translation ? Number.parseFloat(getComputedStyle(translation).opacity) : 0;
  })()`);
  assert(Math.abs(finalTranslationOpacity - 0.58) < 0.01,
    `the final lyric must become past using the fixed 58% opacity: ${finalTranslationOpacity}`);

  await window.close();
  console.log('Apple Music lyrics beta Electron runtime smoke passed.');
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
