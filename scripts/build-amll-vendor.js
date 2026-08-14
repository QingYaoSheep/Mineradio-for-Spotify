'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { patchAmllCoreSource } = require('./patch-amll-core-source');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'public', 'vendor');
const jsOutput = path.join(outputDir, 'amll-core.bundle.js');
const cssSource = path.join(
  root,
  'node_modules',
  '@applemusic-like-lyrics',
  'core',
  'dist',
  'style.css'
);
const cssOutput = path.join(outputDir, 'amll-core.css');
const licenseBanner = [
  '/*!',
  ' * @applemusic-like-lyrics/core 0.5.2',
  ' * Copyright (c) AMLL contributors',
  ' * SPDX-License-Identifier: AGPL-3.0-only',
  ' * Source: https://github.com/amll-dev/applemusic-like-lyrics',
  ' */',
].join('\n');

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'amll-core-entry.js')],
    outfile: jsOutput,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome138'],
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: licenseBanner,
    },
    plugins: [{
      name: 'mineradio-amll-runtime-patch',
      setup(build) {
        build.onLoad({ filter: /amll-core\.mjs$/ }, async (args) => ({
          contents: patchAmllCoreSource(await fs.promises.readFile(args.path, 'utf8')),
          loader: 'js',
        }));
      },
    }],
  });
  const js = fs.readFileSync(jsOutput, 'utf8').replace(/[ \t]+(?=\r?\n)/g, '');
  fs.writeFileSync(jsOutput, js, 'utf8');
  const css = fs.readFileSync(cssSource, 'utf8');
  fs.writeFileSync(cssOutput, `${licenseBanner}\n${css}`, 'utf8');
  process.stdout.write('AMLL browser assets generated.\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
