'use strict';

const assert = require('node:assert/strict');
const { readRendererSource } = require('./renderer-source');

const source = readRendererSource();

assert.match(source, /var QUEUE_VIRTUAL_ROW_HEIGHT = 62/);
assert.match(source, /var QUEUE_VIRTUAL_OVERSCAN = 4/);
assert.match(source, /function renderQueueVirtualWindow\(\)/);
assert.match(source, /playQueue\.slice\(start,\s*end\)/);
assert.match(source, /queue-virtual-spacer/);
assert.match(source, /scheduleQueueVirtualRender\(\)/);
assert.match(source, /panel\.addEventListener\(['"]scroll['"][\s\S]*scheduleQueueVirtualRender\(\)/);
assert.doesNotMatch(
  source.slice(source.indexOf('function renderQueuePanel(opts)'), source.indexOf('async function spotifyApi', source.indexOf('function renderQueuePanel(opts)'))),
  /\$ql\.innerHTML\s*=\s*playQueue\.map/,
  'the full queue must not be materialized into DOM'
);

console.log('Queue DOM virtualization verification passed');
