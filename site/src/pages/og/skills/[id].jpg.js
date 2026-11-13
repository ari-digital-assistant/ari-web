import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { registrySkills, registryFile } from '../../../lib/registry.js';
import { ogPlatform, screenshotPlatforms } from '../../../lib/skills.js';

// The link-preview card for each skill page: the brand background from
// scripts/og/skill.html with the skill's first screenshot inside a phone on the
// right. A raw screenshot used to be og:image, but it is a 1080x2364 portrait
// WebP, and every large-card unfurler crops to ~1.91:1, which left a thin strip
// from the middle of the screen. Some unfurlers (LinkedIn) also won't show
// WebP at all. This is 1200x630 JPEG, which they all handle.
//
// Only rasters are composited here. sharp renders SVG through librsvg, which
// can't load Manrope, so any text would come out in whatever font the build
// machine has, or as boxes. All the text is baked into skill-card.png, and the
// skill's own name rides in og:title next to the image.

const W = 1200;
const H = 630;
// The phone, sized like the home page hero's. It runs off the bottom edge of
// the card, which keeps the screenshot's top half (where the conversation is)
// big enough to read at unfurl size.
const PHONE = { x: 800, y: 62, w: 330, r: 46, bezel: 11 };
const SCREEN = {
  x: PHONE.x + PHONE.bezel,
  y: PHONE.y + PHONE.bezel,
  w: PHONE.w - 2 * PHONE.bezel,
  h: H - PHONE.y - PHONE.bezel,
  r: PHONE.r - PHONE.bezel,
};

// Like the screenshot cache in lib/registry.js, this is resolved from site/,
// the working directory of every build.
const BASE = new URL('src/assets/og/skill-card.png', pathToFileURL(`${process.cwd()}/`));

// The phone body, with its glow. Its bottom edge sits below the card, so only
// the top corners show as rounded.
const phone = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter></defs>
  <rect x="${PHONE.x}" y="${PHONE.y + 24}" width="${PHONE.w}" height="${H}" rx="${PHONE.r}" fill="#F73E1E" fill-opacity=".45" filter="url(#b)"/>
  <rect x="${PHONE.x}" y="${PHONE.y}" width="${PHONE.w}" height="${H}" rx="${PHONE.r}" fill="#2A1826"/>
  <rect x="${PHONE.x + .5}" y="${PHONE.y + .5}" width="${PHONE.w - 1}" height="${H}" rx="${PHONE.r}" fill="none" stroke="#FFFFFF" stroke-opacity=".10"/>
</svg>`);

// Rounds the screenshot's top corners to sit inside the bezel.
const screenMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SCREEN.w}" height="${SCREEN.h}">
  <rect width="${SCREEN.w}" height="${SCREEN.h + SCREEN.r}" rx="${SCREEN.r}" fill="#fff"/>
</svg>`);

export async function getStaticPaths() {
  return (await registrySkills())
    .filter((skill) => screenshotPlatforms(skill).length)
    .map((skill) => ({ params: { id: skill.id }, props: { skill } }));
}

export async function GET({ props: { skill } }) {
  const path = skill.screenshots[ogPlatform(skill)][0].replace(/^\/+/, '');
  // Full width of the screen, cropped from the top: a portrait phone shot
  // loses its bottom, a landscape one its sides, and neither gets letterboxed.
  const screen = await sharp(await registryFile(path))
    .resize(SCREEN.w, SCREEN.h, { fit: 'cover', position: 'top' })
    .composite([{ input: screenMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const card = await sharp(await readFile(BASE))
    .composite([
      { input: phone, left: 0, top: 0 },
      { input: screen, left: SCREEN.x, top: SCREEN.y },
    ])
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return new Response(card, { headers: { 'content-type': 'image/jpeg' } });
}
