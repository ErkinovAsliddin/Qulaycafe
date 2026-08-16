// Landing-page image optimizer.
//
// The design ships eight photographs as ~2 MB PNGs (16 MB total). On a phone
// that is the whole page weight several times over, so every photo is
// re-encoded to WebP at three widths and the PNGs are dropped:
//
//   restaurant-interior.png  ->  restaurant-interior.webp      (1536w)
//                                restaurant-interior@768.webp  ( 768w)
//                                restaurant-interior@384.webp  ( 384w)
//
// components/site/img.tsx derives the srcset from those names, so a 390 px
// phone downloads the 384/768 variant instead of a 2 MB original.
//
// sharp is deliberately NOT a dependency of this project — it is a large
// native module and this script runs by hand when the artwork changes:
//
//   npm install --prefix /tmp/imgtool sharp
//   NODE_PATH=/tmp/imgtool/node_modules node scripts/optimize-landing-images.mjs
//
// Originals live in the design export (Land/qulay-cafe*.zip); drop new PNGs
// into src/landing/public/images/ and re-run.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const WIDTHS = [384, 768, 1536];
const QUALITY = 78;
const DIR = process.argv[2] ?? path.join(process.cwd(), 'src/landing/public/images');

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error(
    'sharp is not available. Install it outside the project and re-run:\n' +
      '  npm install --prefix /tmp/imgtool sharp\n' +
      '  NODE_PATH=/tmp/imgtool/node_modules node scripts/optimize-landing-images.mjs'
  );
  process.exit(1);
}

const originals = (await fs.readdir(DIR)).filter(f => /\.(png|jpe?g)$/i.test(f));
if (originals.length === 0) {
  console.log(`Nothing to do — no PNG/JPEG originals in ${DIR}`);
  process.exit(0);
}

let before = 0;
let after = 0;

for (const file of originals) {
  const from = path.join(DIR, file);
  const base = file.replace(/\.(png|jpe?g)$/i, '');
  before += (await fs.stat(from)).size;

  const meta = await sharp(from).metadata();
  for (const width of WIDTHS) {
    // The largest width doubles as the plain <img src>, so it keeps the bare
    // name; anything wider than the original is skipped rather than upscaled.
    const isLargest = width === WIDTHS[WIDTHS.length - 1];
    if (meta.width && width > meta.width && !isLargest) continue;
    const target = isLargest ? `${base}.webp` : `${base}@${width}.webp`;
    const to = path.join(DIR, target);
    await sharp(from)
      .resize({ width: Math.min(width, meta.width ?? width), withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(to);
    after += (await fs.stat(to)).size;
    console.log(`${file} -> ${target}`);
  }

  await fs.rm(from);
}

const mb = n => (n / 1024 / 1024).toFixed(2);
console.log(`\n${originals.length} originals: ${mb(before)} MB -> ${mb(after)} MB of WebP variants`);
