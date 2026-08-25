// png.mjs — decodificador mínimo de PNG para os testes de arte.
// Cobre o que este projeto usa: color type 3 (paletizado, bit depth 1/2/4/8)
// e color type 6 (RGBA 8 bits), sem entrelaçamento.
//
// Existe porque os testes de asset precisam olhar pixel e alpha, e o contrato
// de arte (fundo transparente de verdade, escala uniforme no ciclo de andar)
// não dá para verificar só pelo cabeçalho.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('não é um PNG');
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height, bitsPerPixel) {
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const x = line[i];
      const a = i >= bytesPerPixel ? cur[i - bytesPerPixel] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0;
      switch (filter) {
        case 0: cur[i] = x; break;
        case 1: cur[i] = (x + a) & 0xff; break;
        case 2: cur[i] = (x + b) & 0xff; break;
        case 3: cur[i] = (x + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[i] = (x + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`filtro PNG desconhecido: ${filter}`);
      }
    }
  }
  return { data: out, stride };
}

/**
 * Decodifica um PNG.
 * @returns {{width:number,height:number,colorType:number,palette:number[][],
 *            trns:number[]|null, indices:Uint8Array|null, alpha:Uint8Array}}
 *   `indices` só existe em PNG paletizado. `alpha` é sempre um canal por pixel.
 */
export function decodePng(path) {
  const chunks = readChunks(readFileSync(path));
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG sem IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (interlace !== 0) throw new Error('PNG entrelaçado não suportado');

  const plte = chunks.find((c) => c.type === 'PLTE');
  const palette = [];
  if (plte) {
    for (let i = 0; i < plte.data.length; i += 3) {
      palette.push([plte.data[i], plte.data[i + 1], plte.data[i + 2]]);
    }
  }
  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  const trns = trnsChunk ? Array.from(trnsChunk.data) : null;

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const bitsPerPixel = bitDepth * channels;
  const { data, stride } = unfilter(raw, width, height, bitsPerPixel);

  const alpha = new Uint8Array(width * height);
  let indices = null;

  if (colorType === 3) {
    indices = new Uint8Array(width * height);
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * stride + Math.floor(x / perByte)];
        const shift = 8 - bitDepth * ((x % perByte) + 1);
        const idx = (byte >> shift) & mask;
        indices[y * width + x] = idx;
        alpha[y * width + x] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  } else if (colorType === 6) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        alpha[y * width + x] = data[y * stride + x * 4 + 3];
      }
    }
  } else {
    alpha.fill(255);
  }

  return { width, height, colorType, bitDepth, palette, trns, indices, alpha };
}

/** Recorta o canal alpha de um frame de sprite-sheet horizontal. */
export function frameAlpha(png, frameIndex, frameW, frameH) {
  const out = new Uint8Array(frameW * frameH);
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      out[y * frameW + x] = png.alpha[y * png.width + frameIndex * frameW + x];
    }
  }
  return out;
}

/** Área da silhueta (pixels com alpha acima do limiar). */
export function silhouetteArea(a, threshold = 128) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] >= threshold) n++;
  return n;
}

/** Caixa envolvente da silhueta, ou null se o frame estiver vazio. */
export function silhouetteBBox(a, w, h, threshold = 128) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y * w + x] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Tamanho do maior componente conexo (8-vizinhos) da silhueta. */
export function largestBlob(a, w, h, threshold = 128) {
  const seen = new Uint8Array(w * h);
  let best = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || a[start] < threshold) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const px = p % w;
      const py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (seen[q] || a[q] < threshold) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (size > best) best = size;
  }
  return best;
}
