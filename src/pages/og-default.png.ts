import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const source = path.join(process.cwd(), 'public', 'og-default.svg');

export const GET: APIRoute = async () => {
  const png = await sharp(fs.readFileSync(source)).png({ compressionLevel: 9 }).toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
