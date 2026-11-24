// Run from the project root: node scripts/prepare-icons.cjs
// Uses Jimp already included with Expo's image utilities; no app dependency is added.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const Jimp = require('jimp-compact');

const ROOT = path.dirname(require.resolve('../package.json'));
const SIZE = 1024;
const BLUE = 0x062b56ff;
// Android layers are 108dp; only the central 72dp is the visible launcher area.
// Scale to 78% of that viewport, not 78% of the entire oversized layer. This
// keeps the wide wordmark inside the central 66dp circle that masks cannot clip.
// https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
const ARTWORK_SIZE = Math.round(SIZE * (72 / 108) * 0.78);

async function main() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'app.json'), 'utf8'));
  const iconPath = path.resolve(ROOT, config.expo.icon);
  const original = await fs.readFile(iconPath);
  assert.equal(original.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'The source icon must be a PNG');
  const source = await Jimp.read(original);
  assert.equal(source.bitmap.width, SIZE, 'The source icon must be 1024px wide');
  assert.equal(source.bitmap.height, SIZE, 'The source icon must be 1024px tall');

  // Flatten alpha against blue instead of replacing dark pixels inside the artwork.
  const fullBleed = new Jimp(SIZE, SIZE, BLUE);
  fullBleed.scan(0, 0, SIZE, SIZE, function (x, y, index) {
    const alpha = source.bitmap.data[index + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      this.bitmap.data[index + channel] = Math.round(
        source.bitmap.data[index + channel] * alpha + this.bitmap.data[index + channel] * (1 - alpha)
      );
    }
  });
  const foreground = new Jimp(SIZE, SIZE, BLUE);
  const artwork = fullBleed.clone().resize(ARTWORK_SIZE, ARTWORK_SIZE, Jimp.RESIZE_BICUBIC);
  const inset = (SIZE - ARTWORK_SIZE) / 2;
  foreground.composite(artwork, inset, inset);
  // Jimp's compositor can round an opaque alpha down to 254; both outputs must be opaque.
  foreground.scan(0, 0, SIZE, SIZE, function (x, y, index) { this.bitmap.data[index + 3] = 255; });

  const foregroundPath = path.join(ROOT, 'assets/images/adaptive-icon.png');
  await fs.writeFile(iconPath, await fullBleed.getBufferAsync(Jimp.MIME_PNG));
  await fs.writeFile(foregroundPath, await foreground.getBufferAsync(Jimp.MIME_PNG));
  console.log(JSON.stringify({
    icon: path.relative(ROOT, iconPath), foreground: path.relative(ROOT, foregroundPath),
    dimensions: `${SIZE}x${SIZE}`, background: '#062B56',
    artworkSize: ARTWORK_SIZE, inset, visibleViewportScale: '78%',
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
