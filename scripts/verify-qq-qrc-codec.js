const assert = require('node:assert/strict');

const {
  buildQQMusicLyricRequestParam,
  decodeQQMusicuLyricData,
  decryptQQMusicQrc,
} = require('../qq-lyric-codec');

const encryptedQrcFixture = 'D6A2BE95D6447372A06696AD9B6EB9F910D4CA186FC7B8B1CB2D8FDCFC5BCB8B1856D8490F9C3EC0';
const expectedQrc = '[1000,2000]Love(1000,1000) Story(2000,1000)';
const encryptedTranslationFixture = '32DABB4C5E9846FAE09110315820F7F476BB38D4C2E6EF2E71F1B30DA01B9558';

assert.equal(
  decryptQQMusicQrc(encryptedQrcFixture),
  expectedQrc,
  'QQ Music hexadecimal QRC payloads must decrypt to their source-timed plaintext',
);

assert.deepEqual(
  buildQQMusicLyricRequestParam('song-mid', 123),
  {
    songMID: 'song-mid',
    songID: 123,
    format: 'json',
    crypt: 1,
    ct: 19,
    cv: 1873,
    interval: 0,
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 1,
    roma_t: 0,
    trans: 1,
    trans_t: 0,
    type: -1,
  },
  'QQ lyric requests must explicitly ask for encrypted QRC, translation and romanization',
);

assert.deepEqual(
  decodeQQMusicuLyricData({
    crypt: 1,
    qrc: 1,
    lyric: encryptedQrcFixture,
    trans: encryptedTranslationFixture,
    roma: '',
  }),
  {
    lyric: '',
    qrc: expectedQrc,
    tlyric: '[00:01.00]爱情故事',
    roma: '',
  },
  'Encrypted QQ lyrics must map the decrypted lyric field to QRC and preserve decrypted translation',
);

assert.deepEqual(
  decodeQQMusicuLyricData({
    crypt: 1,
    qrc: 1,
    lyric: encryptedQrcFixture,
    trans: '0011223344556677',
    roma: '',
  }),
  {
    lyric: '',
    qrc: expectedQrc,
    tlyric: '',
    roma: '',
  },
  'A damaged optional translation must not discard an otherwise valid QRC timeline',
);

console.log('QQ QRC codec: PASS');
