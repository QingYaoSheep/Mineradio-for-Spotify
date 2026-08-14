const assert = require('node:assert/strict');
const fs = require('node:fs');

const debugPortArgument = process.argv.find((value) => value.startsWith('--debug-port='));
const debugPort = debugPortArgument ? Number(debugPortArgument.slice('--debug-port='.length)) : 9223;

async function connectCdp() {
  const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
  const page = pages.find((item) => item.type === 'page' && /Mineradio/i.test(item.title || '')) || pages[0];
  assert.ok(page && page.webSocketDebuggerUrl, `A Mineradio CDP page should be available on port ${debugPort}`);
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
    const longGlowPreview = process.argv.includes('--long-glow-preview');
    const longGlowEarlyPreview = process.argv.includes('--long-glow-early-preview');
    const reloadMode = process.argv.includes('--reload');
  try {
    await send('Runtime.enable');
    let ready = await send('Runtime.evaluate', { returnByValue: true, expression: "typeof fx !== 'undefined'" });
    if (reloadMode) {
      await send('Page.enable');
      await send('Page.navigate', { url: 'http://127.0.0.1:3000/?runtimeReload=' + Date.now() });
      ready = { result:{ value:false } };
    }
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
        var originalAmllRuntime = window.MineradioAppleMusicLyrics;
        window.MineradioAppleMusicLyrics = { isActive:function(){ return false; } };
        var originalLongWordGlow = fx.lyricLongWordGlow;
        var originalLyricTextureClarity = fx.lyricTextureClarity;
        fx.lyricTextureClarity = 1;
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
        parsed.forEach(function(line){
          line.nativeQqKaraoke = true;
          line.transText = '固定翻译基线';
        });
        applyLyricsState(parsed, true, 'qrc-word', []);
        createLyricsParticles();
        clearStageLyrics();
        if (typeof setCurrentLyricDelayMs === 'function') setCurrentLyricDelayMs(0, true);
        if (typeof setGlobalLyricDelayMs === 'function') setGlobalLyricDelayMs(0, true);
        playing = false;
        syncSpotifyPlaybackClock(1.5, false, { snap:true });
        tickLyricsParticles();
        var forward = stageLyrics.current.userData.lastLyricProgress;
        var desktopForward = currentDesktopLyricSnapshot().progress;
        var clonedTimelineLength = lyricsLines[0].karaokeTimeline.length;
        syncSpotifyPlaybackClock(0.5, false, { snap:true });
        tickLyricsParticles();
        var backward = stageLyrics.current.userData.lastLyricProgress;
        var wordLift = stageLyrics.current.userData.lyric.wordLift;
        var translationText = stageLyrics.current.userData.lyric.translationText;
        var translationTextMat = stageLyrics.current.userData.lyric.translationTextMat;
        var translationBaselineBefore = translationText && translationText.position.y;
        var firstLiftSignal = wordLift.bytes[wordLift.entries[0].startPixel * 4] / 255;
        var secondLiftSignal = wordLift.bytes[wordLift.entries[1].startPixel * 4] / 255;
        function materialAtlas(material) {
          return material && material.uniforms && material.uniforms.uMap && material.uniforms.uMap.value;
        }
        var glowAtlasLayouts = stageLyrics.current.userData.lyric.glowMat.reduce(function(total, material){ return total + materialAtlas(material).userData.layouts.length; }, 0);
        var readabilityAtlasLayouts = stageLyrics.current.userData.lyric.readabilityMat.reduce(function(total, material){ return total + materialAtlas(material).userData.layouts.length; }, 0);
        syncSpotifyPlaybackClock(3.5, false, { snap:true });
        tickLyricsParticles();
        var translationBaselineAfter = translationText && translationText.position.y;
        var complete = stageLyrics.current.userData.lastLyricProgress;
        var shaderProgress = stageLyrics.current.userData.lyric.textMat.uniforms.uProgress.value;
        var stressText = '逐字歌词阴影独立上浮测试保持流畅稳定自然';
        var stressTimeline = Array.from(stressText).map(function(char, index){
          return { text:char, start:index * .1, duration:.2, c0:index, c1:index + 1, timed:true };
        });
        var stressStartedAt = performance.now();
        var stressMesh = buildLyricMesh(stressText, '', {
          text:stressText, source:'qrc-word', nativeQqKaraoke:true, karaokeTimeline:stressTimeline
        });
        var stressBuildMs = performance.now() - stressStartedAt;
        var stressData = stressMesh.userData.lyric;
        var stressMaterials = stressData.glowMat.concat(stressData.readabilityMat, stressData.emphasisGlyphMat);
        var stressAtlasPixels = stressMaterials.reduce(function(total, material){
          var atlas = materialAtlas(material);
          return total + atlas.userData.width * atlas.userData.height;
        }, 0);
        var stressMaxAtlasDimension = stressMaterials.reduce(function(maximum, material){
          var atlas = materialAtlas(material);
          return Math.max(maximum, atlas.userData.width, atlas.userData.height);
        }, 0);
        var stressBatchCount = stressData.wordLift.emphasisMaterials.length;
        var gpuMaxTextureSize = renderer.capabilities.maxTextureSize;
        var qrcWithoutEligibleLongTonesKeepsSimpleBaseGeometry = stressData.textMesh.geometry.attributes.position.count === 4 &&
          stressData.textMat.vertexShader.indexOf('aStrength') < 0;
        disposeLyricMesh(stressMesh);
        function copyPositions(mesh) {
          return Array.from(mesh.geometry.attributes.position.array);
        }
        function samePositions(a, b) {
          return a.length === b.length && a.every(function(value, index){ return Math.abs(value - b[index]) < 1e-7; });
        }
        function geometryPeakUv(mesh) {
          var positions = mesh.geometry.attributes.position.array;
          var uvs = mesh.geometry.attributes.uv.array;
          var columns = {};
          for (var vertexIndex = 0; vertexIndex < uvs.length / 2; vertexIndex++) {
            var key = Number(uvs[vertexIndex * 2]).toFixed(5);
            var y = positions[vertexIndex * 3 + 1];
            if (!columns[key]) columns[key] = { uv:Number(key), min:y, max:y };
            columns[key].min = Math.min(columns[key].min, y);
            columns[key].max = Math.max(columns[key].max, y);
          }
          return Object.keys(columns).map(function(key){ return columns[key]; }).sort(function(a, b){ return a.uv - b.uv; })
            .reduce(function(best, column){
              column.height = column.max - column.min;
              return !best || column.height > best.height ? column : best;
            }, null);
        }
        function effectPeak(group) {
          var peaks = [];
          (group && group.children || []).forEach(function(mesh){
            var positions = mesh.geometry.attributes.position.array;
            for (var quad = 0; quad < positions.length / 12; quad++) {
              var offset = quad * 12;
              var minX = Math.min(positions[offset], positions[offset + 3], positions[offset + 6], positions[offset + 9]);
              var maxX = Math.max(positions[offset], positions[offset + 3], positions[offset + 6], positions[offset + 9]);
              var minY = Math.min(positions[offset + 1], positions[offset + 4], positions[offset + 7], positions[offset + 10]);
              var maxY = Math.max(positions[offset + 1], positions[offset + 4], positions[offset + 7], positions[offset + 10]);
              peaks.push({ x:(minX + maxX) * .5, height:maxY - minY });
            }
          });
          return peaks.reduce(function(best, peak){ return !best || peak.height > best.height ? peak : best; }, null);
        }
        var longParsed = parseQrcText('<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[0,5500]All my love is (0,1000)gone(1000,4500)"/></QrcInfos>');
        var longLine = longParsed[0];
        var longText = longLine.text;
        longLine.nativeQqKaraoke = true;
        longLine.transText = '我所有的爱 都已耗尽';
        fx.lyricLongWordGlow = true;
        var longMesh = buildLyricMesh(longText, longLine.transText, longLine);
        function maximumGlowAtlasEdgeAlpha(materials) {
          var maximum = 0;
          (Array.isArray(materials) ? materials : []).forEach(function(material){
            var texture = material && material.uniforms && material.uniforms.uMap && material.uniforms.uMap.value;
            var canvas = texture && texture.image;
            var layouts = texture && texture.userData && texture.userData.layouts;
            if (!canvas || !Array.isArray(layouts) || !layouts.length) return;
            var context = canvas.getContext('2d', { willReadFrequently:true });
            var pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            function sample(x, y) {
              x = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
              y = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
              maximum = Math.max(maximum, pixels[(y * canvas.width + x) * 4 + 3]);
            }
            layouts.forEach(function(layout){
              var left = layout.x;
              var right = layout.x + layout.width - 1;
              var top = layout.y;
              var bottom = layout.y + layout.height - 1;
              for (var x = left; x <= right; x += 2) {
                sample(x, top);
                sample(x, bottom);
              }
              for (var y = top; y <= bottom; y += 2) {
                sample(left, y);
                sample(right, y);
              }
            });
          });
          return maximum;
        }
        var glowAtlasEdgeAlpha = maximumGlowAtlasEdgeAlpha(longMesh.userData.lyric.glowMat);
        var longBaseGeometry = longMesh.userData.lyric.textMesh.geometry;
        var pendingBaseHasLocalPulseGeometry = !!(
          longBaseGeometry.attributes.aStrength &&
          longBaseGeometry.attributes.aGlyphCenter &&
          longBaseGeometry.attributes.aWordCenter
        );
        var pendingBaseVertexShader = longMesh.userData.lyric.textMat.vertexShader;
        var pendingBaseShaderUsesPulse = pendingBaseVertexShader.indexOf('motionPulse') >= 0 &&
          pendingBaseVertexShader.indexOf('transformed.x=expandedCenterX') >= 0;
        function measureLongToneRenderedPixels(mesh, line, sampleTime) {
          var data = mesh.userData.lyric;
          var targetWidth = 768;
          var targetHeight = 256;
          var target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
            minFilter:THREE.LinearFilter,
            magFilter:THREE.LinearFilter,
            format:THREE.RGBAFormat
          });
          var testScene = new THREE.Scene();
          var testCamera = new THREE.OrthographicCamera(-3.7, 3.7, 1.25, -1.25, 0.1, 10);
          testCamera.position.set(0, 0, 5);
          testCamera.lookAt(0, 0, 0);
          mesh.position.set(0, 0, 0);
          mesh.rotation.set(0, 0, 0);
          mesh.scale.setScalar(1);
          testScene.add(mesh);
          data.textMat.uniforms.uOpacity.value = 1;
          if (data.translationTextMat) data.translationTextMat.opacity = 0;
          if (data.translationReadabilityMat) data.translationReadabilityMat.opacity = 0;
          setLyricLayerOpacity(data.readabilityMat, 0);
          setLyricLayerOpacity(data.glowMat, 0);
          setLyricEmphasisLineOpacity(data.glowMat, 1);
          setLyricLayerOpacity(data.emphasisGlyphMat, 1);
          if (data.sunMat) data.sunMat.opacity = 0;
          if (data.sparks) data.sparks.visible = false;
          updateLyricWordLift(mesh, line, sampleTime);
          data.wordLift.emphasisMaterials.forEach(function(material){
            material.uniforms.uQualityMotion.value = 1;
            material.uniforms.uQualityHalo.value = 1;
          });
          var originalTarget = renderer.getRenderTarget();
          var originalClearColor = renderer.getClearColor(new THREE.Color()).clone();
          var originalClearAlpha = renderer.getClearAlpha();
          function renderPixels(enabled) {
            data.wordLift.emphasisMaterials.forEach(function(material){
              material.uniforms.uEmphasisEnabled.value = enabled ? 1 : 0;
            });
            if (data.wordLift.baseTextMaterial && data.wordLift.baseTextMaterial.uniforms.uEmphasisEnabled) {
              data.wordLift.baseTextMaterial.uniforms.uEmphasisEnabled.value = enabled ? 1 : 0;
            }
            renderer.setRenderTarget(target);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, true, true);
            renderer.render(testScene, testCamera);
            var pixels = new Uint8Array(targetWidth * targetHeight * 4);
            renderer.readRenderTargetPixels(target, 0, 0, targetWidth, targetHeight, pixels);
            return pixels;
          }
          var enabledPixels = renderPixels(true);
          var disabledPixels = renderPixels(false);
          data.textMat.uniforms.uOpacity.value = 0;
          var effectOnlyPixels = renderPixels(true);
          data.textMat.uniforms.uOpacity.value = 1;
          data.glow.visible = false;
          data.readability.visible = false;
          data.emphasisGlyph.visible = false;
          data.textMat.uniforms.uProgress.value = .72;
          var pendingBaseEnabledPixels = renderPixels(true);
          var pendingBaseDisabledPixels = renderPixels(false);
          data.glow.visible = true;
          data.readability.visible = true;
          data.emphasisGlyph.visible = true;
          renderer.setRenderTarget(originalTarget);
          renderer.setClearColor(originalClearColor, originalClearAlpha);
          testScene.remove(mesh);
          target.dispose();
          var brighterPixels = 0;
          var haloPixels = 0;
          var totalLuminanceDelta = 0;
          var effectOnlyPeak = 0;
          var pendingBaseChangedPixels = 0;
          var pendingBaseExpansionPixels = 0;
          var pendingBaseAbsoluteDelta = 0;
          function pixelLuminance(pixels, index) {
            return pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114;
          }
          for (var pixelIndex = 0; pixelIndex < enabledPixels.length; pixelIndex += 4) {
            var enabledLuminance = pixelLuminance(enabledPixels, pixelIndex);
            var disabledLuminance = pixelLuminance(disabledPixels, pixelIndex);
            var effectOnlyLuminance = pixelLuminance(effectOnlyPixels, pixelIndex);
            var pendingBaseEnabledLuminance = pixelLuminance(pendingBaseEnabledPixels, pixelIndex);
            var pendingBaseDisabledLuminance = pixelLuminance(pendingBaseDisabledPixels, pixelIndex);
            var pendingBaseDelta = Math.abs(pendingBaseEnabledLuminance - pendingBaseDisabledLuminance);
            effectOnlyPeak = Math.max(effectOnlyPeak, effectOnlyLuminance);
            var delta = enabledLuminance - disabledLuminance;
            if (delta > 8) brighterPixels++;
            if (disabledLuminance < 3 && enabledLuminance > 12) haloPixels++;
            if (delta > 0) totalLuminanceDelta += delta;
            if (pendingBaseDelta > 6) pendingBaseChangedPixels++;
            if (pendingBaseDisabledLuminance < 3 && pendingBaseEnabledLuminance > 8) pendingBaseExpansionPixels++;
            pendingBaseAbsoluteDelta += pendingBaseDelta;
          }
          return {
            brighterPixels:brighterPixels,
            haloPixels:haloPixels,
            totalLuminanceDelta:totalLuminanceDelta,
            effectOnlyPeak:effectOnlyPeak,
            pendingBaseChangedPixels:pendingBaseChangedPixels,
            pendingBaseExpansionPixels:pendingBaseExpansionPixels,
            pendingBaseAbsoluteDelta:pendingBaseAbsoluteDelta,
            strengthPeak:data.emphasisGlyph.children.reduce(function(maximum, child){
              var values = child.geometry.attributes.aStrength.array;
              for (var index = 0; index < values.length; index++) maximum = Math.max(maximum, values[index]);
              return maximum;
            }, 0),
            atlasAlphaPeak:data.emphasisGlyph.children.reduce(function(maximum, child){
              var canvas = child.material.uniforms.uMap.value.image;
              var alpha = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
              for (var index = 3; index < alpha.length; index += 4) maximum = Math.max(maximum, alpha[index]);
              return maximum;
            }, 0),
            effectVisible:data.emphasisGlyph.visible && data.emphasisGlyph.children.every(function(child){
              return child.visible && child.material.visible;
            }),
            shaderDiagnostics:(renderer.info.programs || []).map(function(program){
              var diagnostics = program && program.diagnostics;
              return diagnostics && diagnostics.runnable === false
                ? { runnable:false, vertexLog:diagnostics.vertexShader && diagnostics.vertexShader.log, fragmentLog:diagnostics.fragmentShader && diagnostics.fragmentShader.log }
                : null;
            }).filter(Boolean)
          };
        }
        var renderedLongTonePixels = measureLongToneRenderedPixels(longMesh, longLine, 2.35);
        var longBasePositions = copyPositions(longMesh.userData.lyric.textMesh);
        var translationPositionsBefore = copyPositions(longMesh.userData.lyric.translationText);
        var longEntry = longMesh.userData.lyric.wordLift.entries[1];
        var longGlyphs = longEntry.effectEntries.filter(function(entry){ return entry.longToneStrength > 0; });
        updateLyricWordLift(longMesh, longLine, 2.35);
        var earlyFirstFrame = sampleLyricLongToneGlyph(longEntry, 2.35, 0, longGlyphs.length);
        var earlyLastFrame = sampleLyricLongToneGlyph(longEntry, 2.35, longGlyphs.length - 1, longGlyphs.length);
        var earlyUniformTimeExact = longMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return Math.abs(material.uniforms.uLyricTime.value - 2.35) < 1e-7;
        });
        var pendingBaseTimeExact = Math.abs(
          longMesh.userData.lyric.wordLift.baseTextMaterial.uniforms.uLyricTime.value - 2.35
        ) < 1e-7;
        updateLyricWordLift(longMesh, longLine, 4.15);
        var lateFirstFrame = sampleLyricLongToneGlyph(longEntry, 4.15, 0, longGlyphs.length);
        var lateLastFrame = sampleLyricLongToneGlyph(longEntry, 4.15, longGlyphs.length - 1, longGlyphs.length);
        updateLyricWordLift(longMesh, longLine, 2.35);
        var seekBackFrame = sampleLyricLongToneGlyph(longEntry, 2.35, 0, longGlyphs.length);
        var translationPositionsAfter = copyPositions(longMesh.userData.lyric.translationText);
        var longTextVertexCount = longMesh.userData.lyric.textMesh.geometry.attributes.position.count;
        var longToneTexturePeak = longMesh.userData.lyric.wordLift.bytes.reduce(function(maximum, value, index){
          return index % 4 === 1 ? Math.max(maximum, value) : maximum;
        }, 0);
        var originalQuality = fx.performanceQuality;
        fx.performanceQuality = 'eco';
        updateLyricWordLift(longMesh, longLine, 4.15);
        var ecoProfileApplied = longMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uQualityMotion.value === .65 && material.uniforms.uQualityHalo.value === .45;
        });
        fx.performanceQuality = 'balanced';
        updateLyricWordLift(longMesh, longLine, 4.15);
        var balancedProfileApplied = longMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uQualityMotion.value === .85 && material.uniforms.uQualityHalo.value > 0;
        });
        fx.performanceQuality = originalQuality;
        var originalOverallLyricGlow = fx.lyricGlow;
        fx.lyricGlow = false;
        updateLyricWordLift(longMesh, longLine, 4.15);
        var longWordGlowIsSelfContained = longMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uEmphasisEnabled.value === 1 &&
            material.uniforms.uQualityMotion.value > 0 &&
            material.uniforms.uQualityHalo.value > 0;
        });
        var originalHaloStrength = fx.lyricGlowStrength;
        fx.lyricGlowStrength = 0;
        updateLyricWordLift(longMesh, longLine, 4.15);
        var zeroHaloStrengthApplied = longMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uHaloStrength && material.uniforms.uHaloStrength.value === 0;
        });
        fx.lyricGlowStrength = 0.85;
        updateLyricWordLift(longMesh, longLine, 4.15);
        var maximumHaloStrengthApplied = longMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uHaloStrength && material.uniforms.uHaloStrength.value >= 1.99;
        });
        fx.lyricGlowStrength = originalHaloStrength;
        updateLyricWordLift(longMesh, longLine, 4.15);
        fx.lyricGlow = originalOverallLyricGlow;
        var longToneFramesStartedAt = performance.now();
        for (var longToneFrame = 0; longToneFrame < 360; longToneFrame++) {
          updateLyricWordLift(longMesh, longLine, 1.001 + (longToneFrame / 359) * 4.498);
        }
        var longTone360FrameUpdateMs = performance.now() - longToneFramesStartedAt;
        var pendingGeometryFixed = samePositions(longBasePositions, copyPositions(longMesh.userData.lyric.textMesh));
        var terminalFrame = sampleLyricLongToneGlyph(longEntry, 2.35, 0, longGlyphs.length);
        releaseLyricWordEffectLayers(longMesh);
        var releasedLongWordEffects = !longMesh.userData.lyric.glow &&
          !longMesh.userData.lyric.readability &&
          !longMesh.userData.lyric.emphasisGlyph &&
          longMesh.userData.lyric.wordLift.emphasisMaterials.length === 0 &&
          longMesh.userData.lyric.wordLift.effectPositionAttributes.length === 0 &&
          longMesh.userData.lyric.wordLift.effectColorAttributes.length === 0 &&
          samePositions(longBasePositions, copyPositions(longMesh.userData.lyric.textMesh)) &&
          longMesh.userData.lyric.wordLift.bytes.every(function(value, index){ return index % 4 !== 1 || value === 0; });
        disposeLyricMesh(longMesh);
        var overlapLine = {
          text:'Hold',
          source:'qrc-word',
          nativeQqKaraoke:true,
          karaokeTimeline:[
            { text:'Hold', start:0, duration:4.5, c0:0, c1:4, timed:true },
            { text:'Hold', start:.5, duration:4.5, c0:0, c1:4, timed:true }
          ]
        };
        var overlapMesh = buildLyricMesh(overlapLine.text, '', overlapLine);
        updateLyricWordLift(overlapMesh, overlapLine, 2.25);
        var overlapEffectEntries = overlapMesh.userData.lyric.wordLift.effectEntries;
        var overlapNormalized = overlapEffectEntries.every(function(entry){ return entry.overlapDivisor === 2; });
        var overlapOpacityNormalized = overlapMesh.userData.lyric.glow.children.every(function(mesh){
          var values = mesh.geometry.attributes.aOpacityScale.array;
          return Array.from(values).every(function(value){ return Math.abs(value - .5) < .000001; });
        });
        var originalHighlightColor = stageLyrics.palette.highlight;
        stageLyrics.palette.highlight = '#ff4d8d';
        applyLyricPaletteToMesh(overlapMesh);
        updateLyricWordLift(overlapMesh, overlapLine, 2.25);
        var expectedUpdatedHighlight = lyricThreeColor(stageLyrics.palette.highlight, '#fff0b8', 0.50);
        var dynamicHighlightSynced = overlapMesh.userData.lyric.emphasisGlyphMat.every(function(material){
          var color = material.uniforms.uColor.value;
          return Math.abs(color.r - expectedUpdatedHighlight.r) < .000001 &&
            Math.abs(color.g - expectedUpdatedHighlight.g) < .000001 &&
            Math.abs(color.b - expectedUpdatedHighlight.b) < .000001;
        });
        var whiteHaloShaderPresent = overlapMesh.userData.lyric.glowMat.every(function(material){
          return material.fragmentShader.indexOf('mix(uColor,vec3(1.0)') >= 0;
        });
        stageLyrics.palette.highlight = originalHighlightColor;
        applyLyricPaletteToMesh(overlapMesh);
        updateLyricWordLift(overlapMesh, overlapLine, 2.25);
        var overlapFramesStartedAt = performance.now();
        for (var overlapFrame = 0; overlapFrame < 360; overlapFrame++) {
          updateLyricWordLift(overlapMesh, overlapLine, .501 + (overlapFrame / 359) * 3.998);
        }
        var overlap360FrameUpdateMs = performance.now() - overlapFramesStartedAt;
        disposeLyricMesh(overlapMesh);
        var adjacentOverlapLine = {
          text:'啊哦',
          source:'qrc-word',
          nativeQqKaraoke:true,
          karaokeTimeline:[
            { text:'啊', start:0, duration:4, c0:0, c1:1, timed:true },
            { text:'哦', start:.5, duration:4, c0:1, c1:2, timed:true }
          ]
        };
        var adjacentOverlapMesh = buildLyricMesh(adjacentOverlapLine.text, '', adjacentOverlapLine);
        var adjacentOverlapNormalized = adjacentOverlapMesh.userData.lyric.wordLift.effectEntries.every(function(entry){
          return entry.overlapDivisor === 2;
        });
        disposeLyricMesh(adjacentOverlapMesh);
        var punctuationLine = {
          text:'gone!',
          source:'qrc-word',
          nativeQqKaraoke:true,
          karaokeTimeline:[
            { text:'gone', start:0, duration:4, c0:0, c1:4, timed:true },
            { text:'!', start:4, duration:.2, c0:4, c1:5, timed:true }
          ]
        };
        var punctuationMesh = buildLyricMesh(punctuationLine.text, '', punctuationLine);
        var terminalBoostSurvivesPunctuation = punctuationMesh.userData.lyric.wordLift.entries[0].terminalBoost === true;
        disposeLyricMesh(punctuationMesh);
        var exactThresholdLine = {
          text:'Hold',
          source:'qrc-word',
          nativeQqKaraoke:true,
          karaokeTimeline:[{ text:'Hold', start:0, duration:3, c0:0, c1:4, timed:true }]
        };
        var exactThresholdMesh = buildLyricMesh('Hold', '', exactThresholdLine);
        updateLyricWordLift(exactThresholdMesh, exactThresholdLine, 1.5);
        var exactThresholdEligible = exactThresholdMesh.userData.lyric.wordLift.longToneEnabled;
        disposeLyricMesh(exactThresholdMesh);
        function qrcGlowRuleFixture(text, duration, reliable) {
          var line = {
            text:text,
            source:'qrc-word',
            nativeQqKaraoke:reliable !== false,
            karaokeTimeline:[{ text:text, start:0, duration:duration, c0:0, c1:text.length, timed:true }]
          };
          var mesh = buildLyricMesh(text, '', line);
          var lift = mesh.userData.lyric.wordLift;
          var result = {
            enabled:!!(lift && lift.longToneEnabled),
            strength:lift && lift.entries.length ? Number(lift.entries[0].longToneStrength) || 0 : 0,
            effectLayers:lift && Array.isArray(lift.emphasisMaterials) ? lift.emphasisMaterials.length : 0
          };
          disposeLyricMesh(mesh);
          return result;
        }
        var amllGlowRules = {
          cjkOneSecond:qrcGlowRuleFixture('啊', 1),
          latinOhOneSecond:qrcGlowRuleFixture('Oh', 1),
          latinApostropheOneSecond:qrcGlowRuleFixture("I'm", 1),
          latinTooShort:qrcGlowRuleFixture('A', 4),
          latinTooLong:qrcGlowRuleFixture('Together', 4),
          latinWhitespaceBlock:qrcGlowRuleFixture('All my', 4),
          digitMixedBlock:qrcGlowRuleFixture('Oh2', 4),
          punctuationOnly:qrcGlowRuleFixture('...', 4),
          belowOneSecond:qrcGlowRuleFixture('爱', .999),
          nonFiniteDuration:qrcGlowRuleFixture('Oh', Infinity),
          unreliableQrc:qrcGlowRuleFixture('Oh', 4, false),
          strengthAtOne:qrcGlowRuleFixture('Oh', 1).strength,
          strengthAtTwo:qrcGlowRuleFixture('Oh', 2).strength,
          strengthAtThree:qrcGlowRuleFixture('Oh', 3).strength,
          strengthAtFour:qrcGlowRuleFixture('Oh', 4).strength
        };
        fx.lyricLongWordGlow = false;
        var disabledMesh = buildLyricMesh(longText, '', longLine);
        updateLyricWordLift(disabledMesh, longLine, 3);
        var disabledUniformApplied = disabledMesh.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uEmphasisEnabled.value === 0;
        }) && disabledMesh.userData.lyric.wordLift.baseTextMaterial.uniforms.uEmphasisEnabled.value === 0;
        disposeLyricMesh(disabledMesh);
        fx.lyricLongWordGlow = true;
        syncSpotifyPlaybackClock(0.5, false, { snap:true });
        tickLyricsParticles();
        closeLyricMatchModal();
        clearStageLyrics();
        longLine.transText = '我所有的爱 都已耗尽';
        lyricsLines = [longLine];
        var previewTime = ${longGlowPreview && !longGlowEarlyPreview ? '4.15' : '2.35'};
        syncSpotifyPlaybackClock(previewTime, false, { snap:true });
        stageLyrics.currentIdx = 0;
        showStageLine(longLine, true);
        updateLyricWordLift(stageLyrics.current, longLine, previewTime);
        updateLyricMeshProgress(stageLyrics.current, 0.80);
        stageLyrics.current.userData.age = 1;
        for (var previewFrame = 0; previewFrame < 12; previewFrame++) updateStageLyrics3D(1 / 60);
        await new Promise(function(resolve){ setTimeout(resolve, 700); });
        var previewState = {
          clock:getLyricPlaybackSeconds(),
          attached:!!stageLyrics.current.parent,
          glyphOpacity:stageLyrics.current.userData.lyric.emphasisGlyphMat.map(function(material){ return material.uniforms.uOpacity.value; }),
          glowOpacity:stageLyrics.current.userData.lyric.glowMat.map(function(material){ return material.uniforms.uOpacity.value; }),
          emphasisOpacity:stageLyrics.current.userData.lyric.glowMat.map(function(material){ return material.uniforms.uEmphasisOpacity.value; }),
          haloQuality:stageLyrics.current.userData.lyric.wordLift.emphasisMaterials.map(function(material){ return material.uniforms.uQualityHalo.value; }),
          times:stageLyrics.current.userData.lyric.wordLift.emphasisMaterials.map(function(material){ return material.uniforms.uLyricTime.value; }),
          enabled:stageLyrics.current.userData.lyric.wordLift.emphasisMaterials.map(function(material){ return material.uniforms.uEmphasisEnabled.value; })
        };
        fx.lyricLongWordGlow = originalLongWordGlow;
        fx.lyricTextureClarity = originalLyricTextureClarity;
        window.MineradioAppleMusicLyrics = originalAmllRuntime;
        return {
          timingSource:lyricsTimingSource,
          nativeKaraoke:lyricsHasNativeKaraoke,
          clonedTimelineLength:clonedTimelineLength,
          forward:forward,
          desktopForward:desktopForward,
          backward:backward,
          wordLiftWorld:wordLift.liftWorld,
          translationHasOwnLayer:!!translationText,
          translationUsesWordLift:!!(translationTextMat && translationTextMat.uniforms && translationTextMat.uniforms.uWordLiftMap),
          translationBaselineBefore:translationBaselineBefore,
          translationBaselineAfter:translationBaselineAfter,
          firstLiftSignal:firstLiftSignal,
          secondLiftSignal:secondLiftSignal,
          glowAtlasLayouts:glowAtlasLayouts,
          readabilityAtlasLayouts:readabilityAtlasLayouts,
          effectBatchCount:wordLift.emphasisMaterials.length,
          stressBuildMs:stressBuildMs,
          stressAtlasPixels:stressAtlasPixels,
          stressMaxAtlasDimension:stressMaxAtlasDimension,
          stressBatchCount:stressBatchCount,
          gpuMaxTextureSize:gpuMaxTextureSize,
          qrcWithoutEligibleLongTonesKeepsSimpleBaseGeometry:qrcWithoutEligibleLongTonesKeepsSimpleBaseGeometry,
          longTextVertexCount:longTextVertexCount,
          longGlyphCount:longGlyphs.length,
          pendingBaseHasLocalPulseGeometry:pendingBaseHasLocalPulseGeometry,
          pendingBaseShaderUsesPulse:pendingBaseShaderUsesPulse,
          renderedBrighterPixels:renderedLongTonePixels.brighterPixels,
          renderedHaloPixels:renderedLongTonePixels.haloPixels,
          renderedLuminanceDelta:renderedLongTonePixels.totalLuminanceDelta,
          renderedEffectOnlyPeak:renderedLongTonePixels.effectOnlyPeak,
          renderedPendingBaseChangedPixels:renderedLongTonePixels.pendingBaseChangedPixels,
          renderedPendingBaseExpansionPixels:renderedLongTonePixels.pendingBaseExpansionPixels,
          renderedPendingBaseAbsoluteDelta:renderedLongTonePixels.pendingBaseAbsoluteDelta,
          renderedStrengthPeak:renderedLongTonePixels.strengthPeak,
          renderedAtlasAlphaPeak:renderedLongTonePixels.atlasAlphaPeak,
          renderedEffectVisible:renderedLongTonePixels.effectVisible,
          renderedShaderDiagnostics:renderedLongTonePixels.shaderDiagnostics,
          earlyFirstPulse:earlyFirstFrame.pulse,
          earlyLastPulse:earlyLastFrame.pulse,
          lateFirstPulse:lateFirstFrame.pulse,
          lateLastPulse:lateLastFrame.pulse,
          seekBackPulse:seekBackFrame.pulse,
          earlyUniformTimeExact:earlyUniformTimeExact,
          pendingBaseTimeExact:pendingBaseTimeExact,
          terminalScale:terminalFrame.scale,
          terminalGlow:terminalFrame.glow,
          longToneTexturePeak:longToneTexturePeak,
          ecoProfileApplied:ecoProfileApplied,
          balancedProfileApplied:balancedProfileApplied,
          longWordGlowIsSelfContained:longWordGlowIsSelfContained,
          zeroHaloStrengthApplied:zeroHaloStrengthApplied,
          maximumHaloStrengthApplied:maximumHaloStrengthApplied,
          glowAtlasEdgeAlpha:glowAtlasEdgeAlpha,
          longTone360FrameUpdateMs:longTone360FrameUpdateMs,
          pendingGeometryFixed:pendingGeometryFixed,
          releasedLongWordEffects:releasedLongWordEffects,
          overlapNormalized:overlapNormalized,
          overlapOpacityNormalized:overlapOpacityNormalized,
          adjacentOverlapNormalized:adjacentOverlapNormalized,
          terminalBoostSurvivesPunctuation:terminalBoostSurvivesPunctuation,
          dynamicHighlightSynced:dynamicHighlightSynced,
          whiteHaloShaderPresent:whiteHaloShaderPresent,
          overlap360FrameUpdateMs:overlap360FrameUpdateMs,
          translationGeometryFixed:samePositions(translationPositionsBefore, translationPositionsAfter),
          exactThresholdEligible:exactThresholdEligible,
          amllGlowRules:amllGlowRules,
          disabledUniformApplied:disabledUniformApplied,
          previewState:previewState,
          complete:complete,
          shaderProgress:shaderProgress
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
        syncSpotifyPlaybackClock(15.8, false, { snap:true });
        stageLyrics.currentIdx = -3;
        showStageBreathDots(segment);
        updateLyricBreathDots(stageLyrics.current, getLyricBreathDotState(segment, 15.8));
        await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });
        var data = stageLyrics.current.userData.lyric;
        var pulsesBeforePause = data.breathState.pulses.slice();
        var finalHoldPulses = getLyricBreathDotState(segment, 18.8).pulses.slice();
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
        var originalLyricLayoutRaw = localStorage.getItem(LYRIC_LAYOUT_STORE_KEY);
        var originalLongWordGlow = fx.lyricLongWordGlow;
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
        var cacheSong = { provider:'spotify', id:'runtime-cache-song', name:'Runtime Cache Song', artist:'Mineradio', duration:187 };
        var cachePayload = {
          provider:'qq',
          mid:'runtime-cache-qrc',
          qrc:'[0,2000]Runtime(0,1000) Cache(1000,1000)',
          lyric:'',
          tlyric:'[00:00.00]运行时缓存翻译'
        };
        var storedManual = await saveSongLyricCache(cacheSong, cachePayload, {
          mode:'manual',
          candidate:{ provider:'qq', mid:'runtime-cache-qrc', name:'Runtime Cache Song', artist:'Mineradio' }
        });
        var loadedManual = await fetchSongLyricCache(cacheSong);
        if (loadedManual && loadedManual.cache) await removeSongLyricCache(cacheSong, loadedManual.cache.revision);
        fx.lyricLongWordGlow = true;
        saveLyricLayout();
        updateFxInputs();
        var longWordGlowToggle = document.getElementById('t-lyricLongWordGlow');
        var longWordGlowInitiallyOn = !!(longWordGlowToggle && longWordGlowToggle.classList.contains('on'));
        var toggleLine = parseQrcText('<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[0,4500]Hold(0,4500)"/></QrcInfos>')[0];
        toggleLine.nativeQqKaraoke = true;
        showStageLine(toggleLine, true);
        toggleFx('lyricLongWordGlow');
        var longWordGlowRemovedFromCurrent = stageLyrics.current.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uEmphasisEnabled.value === 0;
        });
        var savedLongWordGlow = JSON.parse(localStorage.getItem(LYRIC_LAYOUT_STORE_KEY) || '{}').lyricLongWordGlow;
        var archivedLongWordGlow = normalizeFxArchiveSnapshot(Object.assign({}, fx, { lyricLongWordGlow:false })).lyricLongWordGlow;
        toggleFx('lyricLongWordGlow');
        var longWordGlowRestoredToCurrent = stageLyrics.current.userData.lyric.wordLift.emphasisMaterials.every(function(material){
          return material.uniforms.uEmphasisEnabled.value === 1;
        });
        var modal = document.querySelector('#lyric-match-modal .lyric-match-modal');
        var result = {
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
          manualCacheStored:!!(storedManual && storedManual.cache && storedManual.cache.stored),
          manualCacheReloaded:!!(loadedManual && loadedManual.qrc && loadedManual.tlyric),
          manualCacheSource:loadedManual && loadedManual.cacheSelection && loadedManual.cacheSelection.candidate && loadedManual.cacheSelection.candidate.mid,
          longWordGlowTogglePresent:!!longWordGlowToggle,
          longWordGlowInitiallyOn:longWordGlowInitiallyOn,
          longWordGlowSavedOff:savedLongWordGlow === false,
          longWordGlowArchivedOff:archivedLongWordGlow === false,
          longWordGlowRemovedFromCurrent:longWordGlowRemovedFromCurrent,
          longWordGlowRestoredToCurrent:longWordGlowRestoredToCurrent,
          modalWidth: modal.getBoundingClientRect().width,
          modalHeight: modal.getBoundingClientRect().height
        };
        fx.lyricLongWordGlow = originalLongWordGlow;
        if (originalLyricLayoutRaw == null) localStorage.removeItem(LYRIC_LAYOUT_STORE_KEY);
        else localStorage.setItem(LYRIC_LAYOUT_STORE_KEY, originalLyricLayoutRaw);
        updateFxInputs();
        refreshCurrentLyricStyle();
        return result;
      })()` : `(async function(){
        await document.fonts.ready;
        var originalAmllRuntime = window.MineradioAppleMusicLyrics;
        window.MineradioAppleMusicLyrics = { isActive:function(){ return false; } };
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
        var ordinaryLyricData = stageLyrics.current.userData.lyric;
        var mask = ordinaryLyricData.mask;
        var lyricFragmentShader = ordinaryLyricData.textMat.fragmentShader;
        var ordinaryWholeLineGlowAbsent = !ordinaryLyricData.glow && !ordinaryLyricData.glowMat &&
          !ordinaryLyricData.sun && !ordinaryLyricData.sunMat &&
          !ordinaryLyricData.sparks && !ordinaryLyricData.sparkMat;
        var rendererReady = !!(renderer && stageLyrics.current && stageLyrics.current.parent);
        function measureKaraokeFeather(text) {
          var testMesh = buildLyricMesh(text, '', null);
          stageLyrics.group.add(testMesh);
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          updateLyricMeshProgress(testMesh, 0.5);
          scene.updateMatrixWorld(true);
          var data = testMesh.userData.lyric;
          function screenPoint(localX, localY) {
            var point = new THREE.Vector3(localX, localY, 0);
            data.textMesh.localToWorld(point);
            point.project(camera);
            return {
              x:(point.x + 1) * innerWidth * 0.5,
              y:(1 - point.y) * innerHeight * 0.5
            };
          }
          function distance(a, b) {
            var dx = a.x - b.x;
            var dy = a.y - b.y;
            return Math.sqrt(dx * dx + dy * dy);
          }
          var textLeft = (data.mask.textMin - 0.5) * data.worldW;
          var textRight = (data.mask.textMax - 0.5) * data.worldW;
          var centerY = (Number(data.mask.originalCenterOffsetY) || 0) * data.worldH;
          var glyphHeightWorld = data.worldH * data.mask.fontSize / Math.max(1, data.mask.height);
          var textScreenWidth = distance(screenPoint(textLeft, centerY), screenPoint(textRight, centerY));
          var glyphScreenHeight = distance(screenPoint(0, centerY - glyphHeightWorld * 0.5), screenPoint(0, centerY + glyphHeightWorld * 0.5));
          var result = {
            fontSize:data.mask.fontSize,
            glyphScreenHeight:glyphScreenHeight,
            expectedPixels:Math.max(12, Math.min(48, glyphScreenHeight * 0.35)),
            actualPixels:data.textMat.uniforms.uFeather.value * textScreenWidth
          };
          stageLyrics.group.remove(testMesh);
          disposeLyricMesh(testMesh);
          return result;
        }
        var largeLyricFeather = measureKaraokeFeather('Oh');
        var smallLyricFeather = measureKaraokeFeather('This intentionally long lyric line forces the rendered lyric font to become much smaller');
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        var lyricPlane = stageLyrics.current.userData.lyric.textMesh;
        var lyricPositions = lyricPlane.geometry.attributes.position;
        var projectedMinY = Infinity;
        var projectedMaxY = -Infinity;
        for (var projectedVertex = 0; projectedVertex < lyricPositions.count; projectedVertex++) {
          var projectedPoint = new THREE.Vector3(
            lyricPositions.getX(projectedVertex),
            lyricPositions.getY(projectedVertex),
            lyricPositions.getZ(projectedVertex)
          );
          lyricPlane.localToWorld(projectedPoint);
          projectedPoint.project(camera);
          projectedMinY = Math.min(projectedMinY, projectedPoint.y);
          projectedMaxY = Math.max(projectedMaxY, projectedPoint.y);
        }
        var projectedCssHeight = Math.max(1, (projectedMaxY - projectedMinY) * innerHeight * .5);
        var lyricTexturePixelsPerOutputPixel = mask.height / (projectedCssHeight * renderer.getPixelRatio());
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
        var result = {
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
          ordinaryWholeLineGlowAbsent:ordinaryWholeLineGlowAbsent,
          clockDelta: clockB - clockA,
          clockElapsedMs: clockElapsedMs,
          rendererReady: rendererReady,
          lyricTextureWidth:mask.width,
          lyricTextureHeight:mask.height,
          lyricTextureResolutionScale:mask.resolutionScale,
          requestedLyricTextureClarity:normalizeLyricTextureClarity(fx.lyricTextureClarity),
          gpuMaxTextureSize:renderer.capabilities.maxTextureSize,
          oversizedGlowCanvasScale:lyricTextureCanvasScale(renderer.capabilities.maxTextureSize * 2, renderer.capabilities.maxTextureSize),
          largeLyricFeather:largeLyricFeather,
          smallLyricFeather:smallLyricFeather,
          lyricTexturePixelsPerOutputPixel:lyricTexturePixelsPerOutputPixel
        };
        window.MineradioAppleMusicLyrics = originalAmllRuntime;
        return result;
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
      assert.equal(result.glowAtlasLayouts, 2, 'The QRC line should pack both character halos into one atlas');
      assert.equal(result.readabilityAtlasLayouts, 2, 'The QRC line should pack both character shadows into one atlas');
      assert.equal(result.effectBatchCount, 3, 'The QRC line should render halo, shadow and emphasis glyph as three batched layers');
      assert.ok(Math.abs(result.firstLiftSignal - .578125) < .005,
        'At 0.5s only the first word should be 57.8125% through its two-second source-time rise');
      assert.ok(Math.abs(result.secondLiftSignal) < 1e-6, 'The second word effect must remain fixed before its own QRC start');
      assert.equal(result.translationHasOwnLayer, true, 'QRC translation glyphs should use a dedicated fixed layer');
      assert.equal(result.translationUsesWordLift, false, 'Translation glyphs must never sample the QRC word-lift map');
      assert.equal(result.translationBaselineAfter, result.translationBaselineBefore, 'Translation baseline must stay fixed while original words rise');
      assert.ok(result.stressMaxAtlasDimension <= result.gpuMaxTextureSize,
        'Long QRC word-effect atlases must stay within the active GPU texture limit');
      assert.ok(result.stressAtlasPixels < 2200000,
        'A 20-character QRC line should keep all three effect atlases below the guarded budget');
      assert.ok(result.stressBatchCount >= 3 && result.stressBatchCount <= 6,
        'A normal long QRC line should remain within a small bounded number of effect batches');
      assert.ok(result.stressBuildMs < 1000,
        'A 20-character QRC line should build its isolated effect atlases without a one-second frame stall');
      assert.equal(result.qrcWithoutEligibleLongTonesKeepsSimpleBaseGeometry, true,
        'QRC lines without eligible long tones should keep the simple base quad and shader');
      assert.equal(result.pendingBaseHasLocalPulseGeometry, true,
        'The original karaoke glyph layer should have local long-tone timing geometry for both filled and pending regions');
      assert.equal(result.pendingBaseShaderUsesPulse, true,
        'The original karaoke glyph shader should apply the same local QRC pulse as the glow layer');
      assert.ok(result.renderedPendingBaseChangedPixels >= 150,
        'The real WebGL frame should visibly transform the original pending karaoke glyph pixels during a long-tone pulse');
      assert.ok(result.renderedPendingBaseExpansionPixels >= 30,
        'The pending 75%-opacity karaoke region should expand into previously empty pixels with the glow pulse');
      assert.ok(result.renderedPendingBaseAbsoluteDelta >= 10000,
        'The original filled and pending glyph regions should produce a material source-time-driven size change');
      assert.ok(result.longTextVertexCount > 4,
        'Long-tone lyrics should use bounded local strips instead of one whole-texture quad');
      assert.equal(result.longGlyphCount, 4, 'The eligible word should be represented by four independent grapheme quads');
      assert.ok(result.renderedBrighterPixels >= 250,
        'The real WebGL frame should contain a clearly visible region that is brighter with long-tone emphasis enabled');
      assert.ok(result.renderedHaloPixels >= 120,
        'The real WebGL frame should contain a soft halo extending into pixels outside the resting glyph');
      assert.ok(result.renderedLuminanceDelta >= 18000,
        'The rendered long-tone emphasis should create a material, human-visible luminance change');
      assert.ok(result.renderedEffectOnlyPeak >= 100,
        'The isolated long-tone effect layers should render a bright visible signal');
      assert.equal(result.renderedStrengthPeak, 1,
        'The eligible long word should reach full source-derived emphasis strength');
      assert.equal(result.renderedAtlasAlphaPeak, 255,
        'The generated emphasis glyph atlas should contain opaque source pixels');
      assert.equal(result.renderedEffectVisible, true,
        'The generated emphasis mesh and material should remain visible');
      assert.deepEqual(result.renderedShaderDiagnostics, [],
        'Every real WebGL long-tone material should compile successfully');
      assert.ok(result.earlyFirstPulse > .99 && result.earlyLastPulse === 0,
        'The emphasis wave should begin at the first glyph without moving the last glyph early');
      assert.ok(result.lateFirstPulse === 0 && result.lateLastPulse > .99,
        'The emphasis wave should finish at the last glyph after the first glyph has returned');
      assert.ok(Math.abs(result.seekBackPulse - result.earlyFirstPulse) < 1e-7,
        'A backward seek should reproduce the exact source-derived glyph frame');
      assert.equal(result.earlyUniformTimeExact, true,
        'Every GPU batch should receive the exact lyric source time');
      assert.equal(result.pendingBaseTimeExact, true,
        'The original pending karaoke glyphs should receive the exact same QRC source time as the glow layers');
      assert.equal(result.pendingGeometryFixed, true,
        'CPU geometry must remain immutable while the GPU samples QRC time');
      assert.equal(result.terminalScale, 1.125, 'The final long word should receive the agreed 25% amplitude boost');
      assert.equal(result.terminalGlow, 1.3, 'The final long word should receive the agreed 30% halo boost');
      assert.equal(result.longToneTexturePeak, 0, 'The old whole-texture green-channel glow map must stay unused');
      assert.equal(result.ecoProfileApplied, true, 'Eco quality should retain a cheaper but still visible halo');
      assert.equal(result.balancedProfileApplied, true, 'Balanced quality should keep motion and a reduced halo');
      assert.equal(result.longWordGlowIsSelfContained, true,
        'The dedicated lyric glow effect should remain visible independently of the general lyric bloom switch');
      assert.equal(result.zeroHaloStrengthApplied, true,
        'The renamed glow strength slider should be able to remove only the long-tone halo');
      assert.equal(result.maximumHaloStrengthApplied, true,
        'The renamed glow strength slider should increase the long-tone halo without restoring a whole-line bloom');
      assert.ok(result.glowAtlasEdgeAlpha <= 2,
        'Long-tone glow atlas cell edges must be transparent so the halo cannot show rectangular clipping');
      assert.ok(result.longTone360FrameUpdateMs < 500,
        'A 360-frame GPU long-tone sweep should stay within the guarded CPU update budget');
      assert.equal(result.translationGeometryFixed, true, 'Translation geometry must remain fixed while the original long word waves');
      assert.equal(result.releasedLongWordEffects, true, 'A departing long-word line should release all character effect resources');
      assert.equal(result.overlapNormalized, true,
        'Overlapping source nodes should share one normalized opacity budget per grapheme');
      assert.equal(result.overlapOpacityNormalized, true,
        'Overlapping GPU halo vertices should receive the normalized opacity attribute');
      assert.equal(result.adjacentOverlapNormalized, true,
        'Time-overlapping adjacent graphemes should share the soft-halo opacity budget');
      assert.equal(result.terminalBoostSurvivesPunctuation, true,
        'A separate trailing punctuation node must not steal the final voiced word boost');
      assert.equal(result.dynamicHighlightSynced, true,
        'Changing the karaoke highlight color should immediately update the solid emphasis glyph color');
      assert.equal(result.whiteHaloShaderPresent, true,
        'The temporary halo should blend toward neutral white instead of stretching the palette texture');
      assert.ok(result.overlap360FrameUpdateMs < 500,
        'A 360-frame overlapping long-tone sweep should stay within the guarded CPU update budget');
      assert.equal(result.exactThresholdEligible, true, 'A three-second QRC word should receive the agreed moderate-to-obvious pulse');
      assert.equal(result.amllGlowRules.cjkOneSecond.enabled, true,
        'A reliable one-second CJK QRC syllable should create long-tone effect layers');
      assert.equal(result.amllGlowRules.latinOhOneSecond.enabled, true,
        'A reliable one-second 2-letter Latin QRC word should create long-tone effect layers');
      assert.equal(result.amllGlowRules.latinApostropheOneSecond.enabled, true,
        'Internal apostrophes should not count against the 2-7 Latin-letter rule');
      assert.equal(result.amllGlowRules.latinTooShort.enabled, false,
        'A one-letter Latin token should not trigger the glow effect');
      assert.equal(result.amllGlowRules.latinTooLong.enabled, false,
        'A Latin block longer than seven letters should not trigger the glow effect');
      assert.equal(result.amllGlowRules.latinWhitespaceBlock.enabled, false,
        'Whitespace-separated Latin words should not be merged into one glow block');
      assert.equal(result.amllGlowRules.digitMixedBlock.enabled, false,
        'Digit-mixed QRC blocks should not trigger the glow effect');
      assert.equal(result.amllGlowRules.punctuationOnly.enabled, false,
        'Pure punctuation should not trigger the glow effect');
      assert.equal(result.amllGlowRules.belowOneSecond.enabled, false,
        'QRC nodes shorter than one second should remain fixed');
      assert.equal(result.amllGlowRules.nonFiniteDuration.enabled, false,
        'Only QRC nodes with finite source duration may trigger the glow effect');
      assert.equal(result.amllGlowRules.unreliableQrc.enabled, false,
        'Only reliable native QQ QRC nodes should reach the long-tone renderer');
      assert.ok(Math.abs(result.amllGlowRules.strengthAtOne - .22) < .000001 &&
        Math.abs(result.amllGlowRules.strengthAtTwo - .45) < .000001 &&
        Math.abs(result.amllGlowRules.strengthAtThree - .72) < .000001 &&
        Math.abs(result.amllGlowRules.strengthAtFour - 1) < .000001,
      'One, two, three and four-second QRC nodes should follow the agreed AMLL-style strength levels');
      assert.equal(result.disabledUniformApplied, true, 'Disabling lyric glow effect must stop the GPU pulse immediately');
      assert.equal(result.previewState.attached, true, 'The eligible long-tone line should be attached to the live lyric stage');
      assert.ok(result.previewState.glyphOpacity.every(function(value){ return value > .5; }),
        'The live stage fade should expose the long-tone emphasis glyphs');
      assert.ok(result.previewState.emphasisOpacity.every(function(value){ return value > .5; }),
        'The live stage fade should expose the long-tone halo instead of leaving it transparent');
      assert.ok(result.previewState.haloQuality.every(function(value){ return value > 0; }),
        'The live stage quality profile should retain a visible halo');
      assert.ok(result.previewState.enabled.every(function(value){ return value === 1; }),
        'The dedicated lyric glow toggle should enable every live-stage emphasis material');
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
      assert.equal(result.manualCacheStored, true, 'The renderer should persist a parsed manual QRC payload through the local cache API');
      assert.equal(result.manualCacheReloaded, true, 'Cached QRC and translation text should parse back as usable lyrics');
      assert.equal(result.manualCacheSource, 'runtime-cache-qrc', 'The manually selected lyric candidate should survive cache normalization');
      assert.equal(result.longWordGlowTogglePresent, true, 'Lyric settings should expose the lyric glow effect toggle');
      assert.equal(result.longWordGlowInitiallyOn, true, 'Lyric glow effect should default to enabled');
      assert.equal(result.longWordGlowSavedOff, true, 'Turning lyric glow effect off should persist in local layout settings');
      assert.equal(result.longWordGlowArchivedOff, true, 'User visual archives should preserve the lyric glow effect preference');
      assert.equal(result.longWordGlowRemovedFromCurrent, true,
        'Turning lyric glow effect off should rebuild the current 3D lyric without long-tone geometry');
      assert.equal(result.longWordGlowRestoredToCurrent, true,
        'Turning lyric glow effect back on should restore it on the current eligible QRC lyric');
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
      assert.equal(result.originalShadowPasses.length, 2, 'Original lyrics should retain only the two dark readability passes');
      assert.equal(result.translationShadowPasses.length, 2, 'Translation should use the same dark-only shadow structure');
      assert.ok(result.originalShadowPasses.every(function(pass){ return pass.color === 'rgba(0,0,0,1)'; }),
        'Ordinary lyric readability must not contain a white halo pass');
      assert.equal(result.ordinaryWholeLineGlowAbsent, true,
        'Ordinary lyric rows must not allocate a whole-line halo, sun bloom or lyric light particles');
      assert.ok(Math.abs(result.translationShadowPasses[0].blur / result.originalShadowPasses[0].blur - result.translationScale) < 0.001,
        'Translation shadow dimensions should scale with the translation font size');
      assert.ok(result.clockDelta > 0.045, 'Spotify clock should advance continuously between samples');
      assert.ok(Math.abs(result.clockDelta - result.clockElapsedMs / 1000) < 0.015, 'Spotify clock should track the high-resolution page clock');
      assert.equal(result.rendererReady, true);
      assert.ok(result.lyricTexturePixelsPerOutputPixel >= 1.75,
        'The live 3D lyric texture should retain at least 1.75 source texels per rendered device pixel');
      assert.ok(result.lyricTextureResolutionScale >= 1 &&
        result.lyricTextureResolutionScale <= result.requestedLyricTextureClarity,
      'The live lyric texture scale should respect the selected clarity tier and active GPU budget');
      assert.equal(result.oversizedGlowCanvasScale, 0.5,
        'A glow canvas twice the GPU width should enter the proportional texture-cap branch');
      assert.ok(result.lyricTextureWidth <= result.gpuMaxTextureSize && result.lyricTextureHeight <= result.gpuMaxTextureSize,
        'The higher-resolution lyric texture should remain within the active GPU texture limit');
      assert.ok(Math.abs(result.largeLyricFeather.actualPixels - result.largeLyricFeather.expectedPixels) <= 1.5,
        'A large rendered lyric should use a karaoke transition approximately 35% of its visible glyph height');
      assert.ok(Math.abs(result.smallLyricFeather.actualPixels - result.smallLyricFeather.expectedPixels) <= 1.5,
        'A small rendered lyric should use a proportionally narrower karaoke transition');
      assert.ok(result.largeLyricFeather.actualPixels > result.smallLyricFeather.actualPixels,
        'The karaoke transition should visibly narrow as the rendered lyric becomes smaller');
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
