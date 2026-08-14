const assert = require('node:assert/strict');

async function connectCdp() {
  const pages = await fetch('http://127.0.0.1:9223/json/list').then((response) => response.json());
  const page = pages.find((item) => item.type === 'page' && /Mineradio/i.test(item.title || '')) || pages[0];
  assert.ok(page && page.webSocketDebuggerUrl, 'A Mineradio CDP page should be available on port 9223');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once:true });
    socket.addEventListener('error', reject, { once:true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function main() {
  const { socket, send } = await connectCdp();
  try {
    const evaluation = await send('Runtime.evaluate', {
      awaitPromise:true,
      returnByValue:true,
      expression:`(function(){
        var line = {
          t:0,
          text:'널',
          source:'qrc-word',
          nativeQqKaraoke:true,
          romanText:'neol',
          romanMode:'qrc-word',
          romanLanguage:'ko',
          romanTokens:[{
            sourceText:'널',
            romanized:'neol',
            c0:0,
            c1:1,
            sourceNodeIndexes:[0]
          }],
          transText:'你',
          karaokeTimeline:[{
            text:'널',
            start:0,
            duration:1.5,
            c0:0,
            c1:1,
            timed:true
          }]
        };
        var base = buildLyricMesh(line.text, '', '', line);
        var mesh = buildLyricMesh(line.text, line.romanText, line.transText, line);
        var data = mesh.userData.lyric;
        var alignedLine = {
          t:0,
          text:'조금도 망설일 것 없죠 난',
          source:'qrc-word',
          nativeQqKaraoke:true,
          romanText:'jo geum do mang seo ril geot eop jyo nan',
          romanMode:'qrc-word',
          romanLanguage:'ko',
          romanTokens:[
            { sourceText:'조금도', romanized:'jo geum do', c0:0, c1:3, sourceNodeIndexes:[] },
            { sourceText:'망설일', romanized:'mang seo ril', c0:4, c1:7, sourceNodeIndexes:[] },
            { sourceText:'것', romanized:'geot', c0:8, c1:9, sourceNodeIndexes:[] },
            { sourceText:'없죠', romanized:'eop jyo', c0:10, c1:12, sourceNodeIndexes:[] },
            { sourceText:'난', romanized:'nan', c0:13, c1:14, sourceNodeIndexes:[] }
          ],
          transText:'我一点也不会犹豫',
          karaokeTimeline:[
            { text:'조금도', start:0, duration:.8, c0:0, c1:3, timed:true },
            { text:'망설일', start:.8, duration:.8, c0:4, c1:7, timed:true },
            { text:'것', start:1.6, duration:.4, c0:8, c1:9, timed:true },
            { text:'없죠', start:2, duration:.7, c0:10, c1:12, timed:true },
            { text:'난', start:2.7, duration:.5, c0:13, c1:14, timed:true }
          ]
        };
        var alignedMesh = buildLyricMesh(
          alignedLine.text,
          alignedLine.romanText,
          alignedLine.transText,
          alignedLine
        );
        var alignedMask = alignedMesh.userData.lyric.mask;
        var wideRoman = new Array(10).fill('extraordinaryromanization').join('-');
        var wideLine = {
          t:0,
          text:'널 사랑해',
          source:'lrc',
          romanText:'neol ' + wideRoman,
          romanMode:'line',
          romanLanguage:'ko',
          romanTokens:[
            { sourceText:'널', romanized:'neol', c0:0, c1:1, sourceNodeIndexes:[] },
            { sourceText:'사랑해', romanized:wideRoman, c0:2, c1:5, sourceNodeIndexes:[] }
          ],
          karaokeTimeline:[]
        };
        var wideMesh = buildLyricMesh(wideLine.text, wideLine.romanText, '', wideLine);
        var wideData = wideMesh.userData.lyric;
        var wideMask = wideData.mask;
        var japaneseLine = {
          t:0,
          text:'君の名は Baby',
          source:'lrc',
          romanText:'kimi no na wa Baby',
          romanMode:'line',
          romanLanguage:'ja',
          romanTokens:[
            { sourceText:'君', romanized:'kimi', c0:0, c1:1, sourceNodeIndexes:[] },
            { sourceText:'の', romanized:'no', c0:1, c1:2, sourceNodeIndexes:[] },
            { sourceText:'名', romanized:'na', c0:2, c1:3, sourceNodeIndexes:[] },
            { sourceText:'は', romanized:'wa', c0:3, c1:4, sourceNodeIndexes:[] },
            { sourceText:'Baby', romanized:'Baby', c0:5, c1:9, sourceNodeIndexes:[] }
          ],
          karaokeTimeline:[]
        };
        var japaneseMesh = buildLyricMesh(japaneseLine.text, japaneseLine.romanText, '', japaneseLine);
        var japaneseMask = japaneseMesh.userData.lyric.mask;
        var staleJapaneseCacheIsRejected = !lyricPayloadRomanizationIsCurrent({
          lyric:'[00:00.00]君の名は',
          romanization:{
            engineVersion:'2',
            language:'ja',
            lines:[]
          },
          cache:{
            romanizationEngineVersion:'2',
            romanizationSessionId:'runtime-test'
          }
        }, [{
          t:0,
          text:'君の名は',
          source:'lrc'
        }], 'ja');
        var staleEngineVersionIsRejected = !lyricPayloadRomanizationIsCurrent({
          lyric:'[00:00.00]뜨거운',
          romanization:{
            engineVersion:'1',
            language:'ko',
            lines:[{ lineIndex:0, text:'tteugeoun' }],
            processedLineIndexes:[0]
          },
          cache:{
            romanizationEngineVersion:'2',
            romanizationSessionId:'runtime-test'
          }
        }, [{
          t:0,
          text:'뜨거운',
          source:'qrc-word'
        }], 'ko');
        var noRomanLine = {
          t:0,
          text:'Oh oh oh ha',
          source:'qrc-word',
          nativeQqKaraoke:true,
          karaokeTimeline:[
            { text:'Oh', start:0, duration:1.2, c0:0, c1:2, timed:true },
            { text:'oh', start:1.2, duration:1.2, c0:3, c1:5, timed:true },
            { text:'oh', start:2.4, duration:1.2, c0:6, c1:8, timed:true },
            { text:'ha', start:3.6, duration:1.2, c0:9, c1:11, timed:true }
          ]
        };
        var noRomanMesh = buildLyricMesh(noRomanLine.text, '', '', noRomanLine);
        var noRomanData = noRomanMesh.userData.lyric;
        var noRomanMask = noRomanData.mask;
        var noRomanGlowTexture = noRomanData.glow && noRomanData.glow.children &&
          noRomanData.glow.children[0] && noRomanData.glow.children[0].material &&
          noRomanData.glow.children[0].material.uniforms.uMap.value;
        var noRomanGlowLayout = noRomanGlowTexture && noRomanGlowTexture.userData &&
          noRomanGlowTexture.userData.layouts && noRomanGlowTexture.userData.layouts[0];
        var noRomanMeasureCanvas = document.createElement('canvas');
        var noRomanMeasureCtx = noRomanMeasureCanvas.getContext('2d');
        noRomanMeasureCtx.font = lyricFontCss(noRomanMask.fontSize);
        var noRomanMeasuredGlyphWidth = lyricMeasureText(
          noRomanMeasureCtx,
          noRomanGlowLayout.text,
          noRomanMask.fontSize
        ) * noRomanMask.fitScaleX;
        var noRomanGlowPadRatio = (
          noRomanGlowLayout.width / noRomanGlowTexture.userData.renderScale -
          noRomanMeasuredGlyphWidth
        ) * 0.5 / noRomanMask.fontSize;
        var noRomanEffectLayersCentered = ['glow','readability','emphasisGlyph'].every(function(layerName){
          var layer = noRomanData[layerName];
          if (!layer || !Array.isArray(layer.children) || !layer.children.length) return false;
          return layer.children.every(function(child){
            var positions = child.geometry.attributes.position.array;
            var layouts = child.material.uniforms.uMap.value.userData.layouts;
            return layouts.every(function(layout, layoutIndex){
              var base = layoutIndex * 12;
              var renderedCenter = (positions[base] + positions[base + 3]) * 0.5;
              var expectedCenter = (layout.entry.centerUv - 0.5) * noRomanData.worldW;
              return Math.abs(renderedCenter - expectedCenter) < 0.000001;
            });
          });
        });
        var punctuationLine = {
          t:0,
          text:'사랑해 ! Baby',
          source:'lrc',
          romanText:'sa rang hae ! Baby',
          romanMode:'line',
          romanLanguage:'ko',
          romanTokens:[
            { sourceText:'사랑해', romanized:'sa rang hae', c0:0, c1:3, sourceNodeIndexes:[] },
            { sourceText:'!', romanized:'!', c0:4, c1:5, sourceNodeIndexes:[] },
            { sourceText:'Baby', romanized:'Baby', c0:6, c1:10, sourceNodeIndexes:[] }
          ],
          karaokeTimeline:[]
        };
        var punctuationMesh = buildLyricMesh(
          punctuationLine.text,
          punctuationLine.romanText,
          '',
          punctuationLine
        );
        var punctuationMask = punctuationMesh.userData.lyric.mask;
        var originalLayout = Array.isArray(alignedMask.originalLayout) ? alignedMask.originalLayout : [];
        var firstKoreanOpticalShift = originalLayout.length
          ? alignedMask.romanLayout[0].left - originalLayout[0].left
          : 0;
        var koreanColumnsAligned = originalLayout.length === alignedMask.romanLayout.length &&
          alignedMask.romanLayout.every(function(item, index){
            return firstKoreanOpticalShift > 0 &&
              Math.abs((item.left - originalLayout[index].left) - firstKoreanOpticalShift) < 0.001;
          });
        var koreanColumnsDoNotCollide = alignedMask.romanLayout.every(function(item, index){
          if (!originalLayout.length) return false;
          if (index >= alignedMask.romanLayout.length - 1) return true;
          var source = originalLayout[index];
          var nextSource = originalLayout[index + 1];
          return nextSource.left >= Math.max(item.right, source.right) - 0.001;
        });
        var qrcSourceMappingAligned = alignedMesh.userData.lyric.wordLift.entries.every(function(entry){
          return Math.abs(entry.startUv - alignedMask.sourceBoundaryPixels[entry.c0] / alignedMask.width) < 0.000001 &&
            Math.abs(entry.endUv - alignedMask.sourceBoundaryPixels[entry.c1] / alignedMask.width) < 0.000001;
        });
        var originalBaselineStable = Math.abs(
          ((data.mask.originalBaselineUv - 0.5) * data.worldH) -
          ((base.userData.lyric.mask.originalBaselineUv - 0.5) * base.userData.lyric.worldH)
        ) < 0.000001;
        var positionsBefore = Array.from(data.romanization.geometry.attributes.position.array);
        updateLyricMeshProgress(mesh, 0.4);
        updateLyricRomanization(mesh, line, 0.6, 0.4);
        var progressAtPointFour = data.romanization.geometry.getAttribute('aTokenProgress').array[0];
        var glowAtPointFour = data.romanization.geometry.getAttribute('aGlowStrength').array[0];
        var positionsAfter = Array.from(data.romanization.geometry.attributes.position.array);
        data.romanization.layout[0].sourceSlices = [];
        updateLyricRomanization(mesh, line, 0.3, 0.9);
        var sourceNodeFallbackProgress = data.romanization.geometry.getAttribute('aTokenProgress').array[0];
        fx.lyricLongWordGlow = false;
        updateLyricRomanization(mesh, line, 0.7, 0.46);
        var glowDisabled = data.romanGlowMat.uniforms.uGlowEnabled.value;
        fx.lyricLongWordGlow = true;
        var result = {
          romanMeshPresent:!!data.romanText,
          romanGlowPresent:!!data.romanGlow,
          romanReadabilityPresent:!!data.romanReadability,
          originalBaselineStable:originalBaselineStable,
          orderedBaselines:data.mask.originalBaseline < data.mask.romanBaseline &&
            data.mask.romanBaseline < data.mask.translationBaseline,
          romanScale:data.mask.romanFontSize / data.mask.fontSize,
          translationScale:data.mask.transFontSize / data.mask.fontSize,
          progressAtPointFour:progressAtPointFour,
          sourceNodeFallbackProgress:sourceNodeFallbackProgress,
          glowAtPointFour:glowAtPointFour,
          positionsFixed:JSON.stringify(positionsBefore) === JSON.stringify(positionsAfter),
          glowDisabled:glowDisabled,
          tokenSourceNodes:data.mask.romanLayout[0].sourceNodeIndexes
          ,romanNaturalScale:alignedMask.romanLayout.every(function(item){ return item.drawScale === 1; })
          ,koreanColumnsAligned:koreanColumnsAligned
          ,koreanColumnsDoNotCollide:koreanColumnsDoNotCollide
          ,translationCentered:Math.abs(alignedMask.translationCenter - alignedMask.width * 0.5) < 0.001
          ,wideTextureExpanded:wideMask.width > alignedMask.width
          ,wideGlyphWorldScaleStable:Math.abs(
            wideData.worldW / wideMask.width -
            alignedMesh.userData.lyric.worldW / alignedMask.width
          ) < 0.000001
          ,wideRowInsideTexture:wideMask.romanLayout[0].left >= 0 &&
            wideMask.romanLayout[wideMask.romanLayout.length - 1].right <= wideMask.width
          ,japaneseNaturalLeftAligned:japaneseMask.originalLayout.length === 0 &&
            japaneseMask.romanLayout.every(function(item){ return item.drawScale === 1; }) &&
            Math.abs(japaneseMask.romanLayout[0].left - japaneseMask.textMin * japaneseMask.width) < 0.001
          ,staleJapaneseCacheIsRejected:staleJapaneseCacheIsRejected
          ,staleEngineVersionIsRejected:staleEngineVersionIsRejected
          ,noRomanHasExactSourceBoundaries:Array.isArray(noRomanMask.sourceBoundaryPixels) &&
            noRomanMask.sourceBoundaryPixels.length === noRomanLine.text.length + 1
          ,noRomanEffectLayersCentered:noRomanEffectLayersCentered
          ,noRomanGlowPadRatio:noRomanGlowPadRatio
          ,koreanRomanOpticalShift:alignedMask.romanLayout[0].left -
            alignedMask.originalLayout[0].left
          ,koreanRomanOpticalShiftRatio:(alignedMask.romanLayout[0].left -
            alignedMask.originalLayout[0].left) / alignedMask.fontSize
          ,qrcSourceMappingAligned:qrcSourceMappingAligned
          ,alignedFallbackGlow:!!(wideData.glowMat && wideData.glowMat.map &&
            wideData.glowMat.map.image && wideData.glowMat.map.image.width === wideMask.width)
          ,punctuationAttached:Math.abs(
            punctuationMask.originalLayout[1].left - punctuationMask.originalLayout[0].right
          ) < 0.001 && Math.abs(
            punctuationMask.romanLayout[1].left - punctuationMask.romanLayout[0].right
          ) < 0.001
        };
        disposeLyricMesh(punctuationMesh);
        disposeLyricMesh(noRomanMesh);
        disposeLyricMesh(japaneseMesh);
        disposeLyricMesh(wideMesh);
        disposeLyricMesh(alignedMesh);
        disposeLyricMesh(mesh);
        disposeLyricMesh(base);
        return result;
      })()`,
    });
    assert.ok(!evaluation.exceptionDetails, evaluation.exceptionDetails && evaluation.exceptionDetails.text);
    const result = evaluation.result && evaluation.result.value;
    assert.equal(result.romanMeshPresent, true);
    assert.equal(result.romanGlowPresent, true);
    assert.equal(result.romanReadabilityPresent, true);
    assert.equal(result.originalBaselineStable, true);
    assert.equal(result.orderedBaselines, true);
    assert.ok(Math.abs(result.romanScale - 0.42) < 1e-6);
    assert.ok(Math.abs(result.translationScale - 0.34) < 1e-6);
    assert.ok(Math.abs(result.progressAtPointFour - 0.4) < 1e-6,
      'Romanized QRC progress should come directly from the source node clock');
    assert.ok(Math.abs(result.sourceNodeFallbackProgress - 0.2) < 1e-6,
      'QRC fallback progress must remain tied to source nodes instead of the independently supplied line progress');
    assert.ok(result.glowAtPointFour > 0,
      'A reliable native QQ long syllable should drive the romanized 60% glow layer');
    assert.equal(result.positionsFixed, true,
      'Romanized lyrics must not lift or scale while their source words sing');
    assert.equal(result.glowDisabled, 0,
      'The existing lyric glow setting should disable romanized glow too');
    assert.deepEqual(result.tokenSourceNodes, [0]);
    assert.equal(result.romanNaturalScale, true,
      'Romanization glyphs should keep their natural 42% font size without horizontal scaling');
    assert.equal(result.koreanColumnsAligned, true,
      'Korean source words and romanized columns should share one small, consistent optical right shift');
    assert.equal(result.koreanColumnsDoNotCollide, true,
      'Korean word gaps should expand only enough to prevent adjacent columns from colliding');
    assert.equal(result.translationCentered, true,
      'Translation should remain independently centered');
    assert.equal(result.wideTextureExpanded, true,
      'A naturally wide romanized line should expand the lyric texture instead of being compressed');
    assert.equal(result.wideGlyphWorldScaleStable, true,
      'Expanding the texture must preserve the apparent romanization font size in 3D');
    assert.equal(result.wideRowInsideTexture, true,
      'Expanded romanization must not be clipped by its texture');
    assert.equal(result.japaneseNaturalLeftAligned, true,
      'Japanese romanization should keep natural sizing and share the original line left edge without splitting the source');
    assert.equal(result.staleJapaneseCacheIsRejected, true,
      'A current-version cache with missing Japanese rows must be regenerated instead of hiding romanization forever');
    assert.equal(result.staleEngineVersionIsRejected, true,
      'An otherwise complete version 1 romanization cache must be rejected after the version 2 upgrade');
    assert.equal(result.noRomanHasExactSourceBoundaries, true,
      'QRC lines without romanization must retain the same exact source-boundary coordinate map');
    assert.equal(result.noRomanEffectLayersCentered, true,
      'QRC glyph, readability and glow layers without romanization must share the source glyph centers');
    assert.ok(result.noRomanGlowPadRatio <= 0.38,
      `QRC glow diffusion should stay close to the glyph instead of using ${result.noRomanGlowPadRatio}em padding`);
    assert.ok(result.koreanRomanOpticalShift > 0 &&
      result.koreanRomanOpticalShiftRatio <= result.romanScale * 0.16,
      'Korean romanization should receive only a small optical shift to the right');
    assert.equal(result.qrcSourceMappingAligned, true,
      'QRC lift and glow geometry should use the expanded Korean source-word positions');
    assert.equal(result.alignedFallbackGlow, true,
      'Non-QRC Korean glow should use the same expanded source layout instead of a compact duplicate');
    assert.equal(result.punctuationAttached, true,
      'A standalone punctuation token should attach directly to the preceding Korean source and romanized word');
    console.log('Runtime lyric romanization smoke: PASS');
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(`Runtime lyric romanization smoke: FAIL\n${error.stack || error.message}`);
  process.exitCode = 1;
});
