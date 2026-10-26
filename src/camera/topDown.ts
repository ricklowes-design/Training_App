import { apply, weight, type H } from '../domain/homography';

// The room photo redrawn from above (parent request 2026-10-26): every floor point of the clear
// floor is looked up in the photo through the fitted floor → photo map. Floor the camera cannot
// see (behind it, or outside the picture) stays transparent.

export async function renderTopDown(photo: Blob, floorToImg: H, lengthM: number, widthM: number, pxPerM = 80): Promise<Blob> {
  const bmp = await createImageBitmap(photo);
  const src = document.createElement('canvas');
  src.width = bmp.width;
  src.height = bmp.height;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(bmp, 0, 0);
  bmp.close();
  const sp = sctx.getImageData(0, 0, src.width, src.height).data;
  const ow = Math.max(1, Math.round(widthM * pxPerM));
  const oh = Math.max(1, Math.round(lengthM * pxPerM));
  const out = document.createElement('canvas');
  out.width = ow;
  out.height = oh;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(ow, oh);
  // The sign the projective weight has for points in front of the camera (the floor centre).
  const front = Math.sign(weight(floorToImg, [0, lengthM / 2])) || 1;
  for (let j = 0; j < oh; j++) {
    const y = lengthM - (j + 0.5) / pxPerM; // front wall at the top
    for (let i = 0; i < ow; i++) {
      const x = -widthM / 2 + (i + 0.5) / pxPerM;
      if (Math.sign(weight(floorToImg, [x, y])) !== front) continue;
      const uv = apply(floorToImg, [x, y]);
      if (!uv) continue;
      const u = Math.floor(uv[0] * src.width);
      const v = Math.floor(uv[1] * src.height);
      if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
      const s = 4 * (v * src.width + u);
      const o = 4 * (j * ow + i);
      img.data[o] = sp[s];
      img.data[o + 1] = sp[s + 1];
      img.data[o + 2] = sp[s + 2];
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the floor map'))), 'image/png'));
}
