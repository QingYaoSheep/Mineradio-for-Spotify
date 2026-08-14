'use strict';

const zlib = require('zlib');

const QQ_QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'ascii');
const DECRYPT = 0;
const ENCRYPT = 1;
// QQ's desktop-compatible QRC cipher uses two historical, non-standard DES
// S-box entries. Keep these tables aligned with Lyricify Lyrics Helper's
// Apache-2.0 QRC decoder instead of substituting OpenSSL TripleDES.
// Reference: https://github.com/WXRIW/Lyricify-Lyrics-Helper
const QQ_DES_SBOX = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
];

function bitNumber(bytes, bit, shift) {
  const byteIndex = Math.floor(bit / 32) * 4 + 3 - Math.floor((bit % 32) / 8);
  return ((((bytes[byteIndex] >>> (7 - bit % 8)) & 1) << shift) >>> 0);
}

function bitNumberIntR(value, bit, shift) {
  return (((((value >>> (31 - bit)) & 1) << shift)) >>> 0);
}

function bitNumberIntL(value, bit, shift) {
  return (((((value << bit) >>> 0) & 0x80000000) >>> shift) >>> 0);
}

function sboxBit(value) {
  return (value & 32) | ((value & 31) >>> 1) | ((value & 1) << 4);
}

function initialPermutation(input) {
  const state = [0, 0];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const outputShift = 31 - (row * 8 + column);
      state[0] = (state[0] | bitNumber(input, 57 + row * 2 - column * 8, outputShift)) >>> 0;
      state[1] = (state[1] | bitNumber(input, 56 + row * 2 - column * 8, outputShift)) >>> 0;
    }
  }
  return state;
}

function inversePermutation(state0, state1) {
  const output = Buffer.alloc(8);
  const outputOrder = [3, 2, 1, 0, 7, 6, 5, 4];
  for (let group = 0; group < 8; group += 1) {
    const sourceBase = 7 - group;
    let value = 0;
    for (let pair = 0; pair < 4; pair += 1) {
      const sourceBit = sourceBase + pair * 8;
      value |= bitNumberIntR(state1, sourceBit, 7 - pair * 2);
      value |= bitNumberIntR(state0, sourceBit, 6 - pair * 2);
    }
    output[outputOrder[group]] = value;
  }
  return output;
}

const QQ_DES_P = [
  15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9,
  1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24,
];

function qqDesF(state, key) {
  const t1 = (
    bitNumberIntL(state, 31, 0)
    | ((state & 0xf0000000) >>> 1)
    | bitNumberIntL(state, 4, 5)
    | bitNumberIntL(state, 3, 6)
    | ((state & 0x0f000000) >>> 3)
    | bitNumberIntL(state, 8, 11)
    | bitNumberIntL(state, 7, 12)
    | ((state & 0x00f00000) >>> 5)
    | bitNumberIntL(state, 12, 17)
    | bitNumberIntL(state, 11, 18)
    | ((state & 0x000f0000) >>> 7)
    | bitNumberIntL(state, 16, 23)
  ) >>> 0;
  const t2 = (
    bitNumberIntL(state, 15, 0)
    | ((state & 0x0000f000) << 15)
    | bitNumberIntL(state, 20, 5)
    | bitNumberIntL(state, 19, 6)
    | ((state & 0x00000f00) << 13)
    | bitNumberIntL(state, 24, 11)
    | bitNumberIntL(state, 23, 12)
    | ((state & 0x000000f0) << 11)
    | bitNumberIntL(state, 28, 17)
    | bitNumberIntL(state, 27, 18)
    | ((state & 0x0000000f) << 9)
    | bitNumberIntL(state, 0, 23)
  ) >>> 0;
  const expanded = [
    (t1 >>> 24) & 0xff,
    (t1 >>> 16) & 0xff,
    (t1 >>> 8) & 0xff,
    (t2 >>> 24) & 0xff,
    (t2 >>> 16) & 0xff,
    (t2 >>> 8) & 0xff,
  ].map((value, index) => value ^ key[index]);
  const substituted = (
    (QQ_DES_SBOX[0][sboxBit(expanded[0] >>> 2)] << 28)
    | (QQ_DES_SBOX[1][sboxBit(((expanded[0] & 3) << 4) | (expanded[1] >>> 4))] << 24)
    | (QQ_DES_SBOX[2][sboxBit(((expanded[1] & 15) << 2) | (expanded[2] >>> 6))] << 20)
    | (QQ_DES_SBOX[3][sboxBit(expanded[2] & 63)] << 16)
    | (QQ_DES_SBOX[4][sboxBit(expanded[3] >>> 2)] << 12)
    | (QQ_DES_SBOX[5][sboxBit(((expanded[3] & 3) << 4) | (expanded[4] >>> 4))] << 8)
    | (QQ_DES_SBOX[6][sboxBit(((expanded[4] & 15) << 2) | (expanded[5] >>> 6))] << 4)
    | QQ_DES_SBOX[7][sboxBit(expanded[5] & 63)]
  ) >>> 0;
  let permuted = 0;
  for (let index = 0; index < QQ_DES_P.length; index += 1) {
    permuted = (permuted | bitNumberIntL(substituted, QQ_DES_P[index], index)) >>> 0;
  }
  return permuted;
}

function qqDesCrypt(input, schedule) {
  let [state0, state1] = initialPermutation(input);
  for (let round = 0; round < 15; round += 1) {
    const previousState1 = state1;
    state1 = (qqDesF(state1, schedule[round]) ^ state0) >>> 0;
    state0 = previousState1;
  }
  state0 = (qqDesF(state1, schedule[15]) ^ state0) >>> 0;
  return inversePermutation(state0, state1);
}

const QQ_KEY_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const QQ_KEY_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
const QQ_KEY_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const QQ_KEY_COMPRESSION = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
  40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];

function qqDesKeySchedule(key, mode) {
  const schedule = Array.from({ length: 16 }, () => Array(6).fill(0));
  let c = 0;
  let d = 0;
  for (let index = 0; index < 28; index += 1) {
    c = (c | bitNumber(key, QQ_KEY_C[index], 31 - index)) >>> 0;
    d = (d | bitNumber(key, QQ_KEY_D[index], 31 - index)) >>> 0;
  }
  for (let round = 0; round < 16; round += 1) {
    const shift = QQ_KEY_SHIFTS[round];
    c = (((c << shift) | (c >>> (28 - shift))) & 0xfffffff0) >>> 0;
    d = (((d << shift) | (d >>> (28 - shift))) & 0xfffffff0) >>> 0;
    const target = mode === DECRYPT ? 15 - round : round;
    for (let bit = 0; bit < 24; bit += 1) {
      schedule[target][Math.floor(bit / 8)] |= bitNumberIntR(c, QQ_KEY_COMPRESSION[bit], 7 - bit % 8);
    }
    for (let bit = 24; bit < 48; bit += 1) {
      schedule[target][Math.floor(bit / 8)] |= bitNumberIntR(d, QQ_KEY_COMPRESSION[bit] - 27, 7 - bit % 8);
    }
  }
  return schedule;
}

function qqTripleDesSchedule(key) {
  return [
    qqDesKeySchedule(key.subarray(16), DECRYPT),
    qqDesKeySchedule(key.subarray(8), ENCRYPT),
    qqDesKeySchedule(key, DECRYPT),
  ];
}

function qqTripleDesDecrypt(input) {
  const output = Buffer.alloc(input.length);
  const schedule = qqTripleDesSchedule(QQ_QRC_KEY);
  for (let offset = 0; offset < input.length; offset += 8) {
    let block = input.subarray(offset, offset + 8);
    for (let pass = 0; pass < 3; pass += 1) block = qqDesCrypt(block, schedule[pass]);
    block.copy(output, offset);
  }
  return output;
}

function decryptQQMusicQrc(encryptedLyrics) {
  const hex = String(encryptedLyrics || '').trim();
  if (!hex) return '';
  if (hex.length % 16 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new TypeError('QQ QRC payload must be hexadecimal DES blocks');
  }

  const compressed = qqTripleDesDecrypt(Buffer.from(hex, 'hex'));
  const plaintext = zlib.inflateSync(compressed).toString('utf8');
  return plaintext.replace(/^\uFEFF/, '');
}

function buildQQMusicLyricRequestParam(songMID, songID) {
  const param = {
    format: 'json',
    crypt: 1,
    ct: 19,
    cv: 1873,
    interval: 0,
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 0,
    roma_t: 0,
    trans: 1,
    trans_t: 0,
    type: -1,
  };
  if (songMID) param.songMID = String(songMID);
  if (songID) param.songID = Number(songID);
  return param;
}

function decryptOptionalQQMusicQrc(value) {
  if (!value) return '';
  try {
    return decryptQQMusicQrc(value);
  } catch (error) {
    return '';
  }
}

function decodeQQMusicuLyricData(data) {
  data = data || {};
  if (Number(data.crypt) !== 1) {
    throw new TypeError('QQ MusicU lyric payload is not encrypted');
  }
  const source = decryptQQMusicQrc(data.lyric);
  return {
    lyric: Number(data.qrc) === 1 ? '' : source,
    qrc: Number(data.qrc) === 1 ? source : '',
    tlyric: decryptOptionalQQMusicQrc(data.trans),
    roma: decryptOptionalQQMusicQrc(data.roma),
  };
}

module.exports = {
  buildQQMusicLyricRequestParam,
  decodeQQMusicuLyricData,
  decryptQQMusicQrc,
};
