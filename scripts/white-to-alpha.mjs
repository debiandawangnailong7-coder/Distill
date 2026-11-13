// 纯 Node PNG 白底转透明：从边界泛洪填充最大连续近白区域。
// 解码 8-bit RGB (colorType 2) / RGBA (colorType 6) / 编码 RGBA (colorType 6)，非交错。幂等可重复执行。
import fs from 'node:fs';
import zlib from 'node:zlib';

const TOL = Number(process.argv[2] ?? 30); // 通道距白的容差
const files = process.argv.slice(3);

function decode(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 签名不符: ' + path);
  let pos = 8, w, h, depth, color, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (depth !== 8 || bpp === 0 || interlace !== 0) throw new Error(`不支持的格式: ${path} depth=${depth} color=${color}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * bpp);
  // 逐行还原 PNG filter
  const prevRow = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[i] = v & 0xff;
    }
    prevRow.set(out);
  }
  return { w, h, px, bpp };
}

function crc32(data) {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function encodeRGBA(path, w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter 0
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, out);
}

for (const file of files) {
  const { w, h, px, bpp } = decode(file);
  const n = w * h;
  // 泛洪：从边界所有近白像素出发，4 连通扩展（只看 RGB；已透明的区域 RGB 仍是白，结果幂等）
  const bg = new Uint8Array(n); // 1 = 背景
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const nearWhite = (i) => {
    const o = i * bpp;
    return px[o] >= 256 - TOL && px[o + 1] >= 256 - TOL && px[o + 2] >= 256 - TOL;
  };
  for (let x = 0; x < w; x++) { for (const i of [x, (h - 1) * w + x]) if (!bg[i] && nearWhite(i)) { bg[i] = 1; queue[qt++] = i; } }
  for (let y = 0; y < h; y++) { for (const i of [y * w, y * w + w - 1]) if (!bg[i] && nearWhite(i)) { bg[i] = 1; queue[qt++] = i; } }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !bg[j] && nearWhite(j)) { bg[j] = 1; queue[qt++] = j; }
    }
  }
  // 输出 RGBA：背景全透明；与背景相邻的 1px 边界环做柔和过渡（按白度渐变），减少白边光晕
  const rgba = new Uint8Array(n * 4);
  let cleared = 0, feathered = 0;
  for (let i = 0; i < n; i++) {
    const o = i * bpp, d = i * 4;
    rgba[d] = px[o]; rgba[d + 1] = px[o + 1]; rgba[d + 2] = px[o + 2];
    rgba[d + 3] = 255;
    if (bg[i]) { rgba[d + 3] = 0; cleared++; }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bg[i]) continue;
      const isRing = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      if (!isRing) continue;
      const o = i * bpp;
      const minC = Math.min(px[o], px[o + 1], px[o + 2]);
      // 白度从容差边界到纯白线性映射到 alpha 255→0
      const t = Math.max(0, Math.min(1, (minC - (255 - TOL)) / TOL));
      if (t > 0) { rgba[i * 4 + 3] = Math.round(255 * (1 - t)); feathered++; }
    }
  }
  encodeRGBA(file, w, h, rgba);
  console.log(`${file}: ${w}x${h} 透明 ${cleared} 像素 (${(cleared / n * 100).toFixed(1)}%) 柔边 ${feathered}`);
}
