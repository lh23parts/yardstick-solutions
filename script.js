const stage = document.getElementById('stage');
const canvas = document.getElementById('art');
const ctx = canvas.getContext('2d');
const BG = '#eb3c0c';
const DARK_THRESHOLD = 75; // luminance below this = hole interior, above = torn rim texture
const MIN_BLOB_PIXELS = 30;

let dpr = Math.max(1, window.devicePixelRatio || 1);
let cssW = 0, cssH = 0;
let poster = null;
let sprites = [];
const shots = []; // {fx, fy, fw, spriteIndex, rot, flip}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function isGreenScreen(r, g, b) {
  return g > 90 && g > r * 1.3 && g > b * 1.3;
}

function buildSprites(holesImg) {
  const w = holesImg.width, h = holesImg.height;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d');
  sctx.drawImage(holesImg, 0, 0);
  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;

  const foreground = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    foreground[i] = isGreenScreen(r, g, b) ? 0 : 1;
  }

  const labels = new Int32Array(w * h).fill(-1);
  const blobs = [];

  for (let start = 0; start < w * h; start++) {
    if (foreground[start] !== 1 || labels[start] !== -1) continue;
    const stack = [start];
    labels[start] = blobs.length;
    let minX = start % w, maxX = start % w, minY = (start / w) | 0, maxY = (start / w) | 0;
    let count = 0;
    const pixels = [];

    while (stack.length) {
      const idx = stack.pop();
      const x = idx % w, y = (idx / w) | 0;
      count++;
      pixels.push(idx);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
      for (const n of neighbors) {
        if (n < 0 || n >= w * h) continue;
        if (x === 0 && n === idx - 1) continue;
        if (x === w - 1 && n === idx + 1) continue;
        if (foreground[n] === 1 && labels[n] === -1) {
          labels[n] = blobs.length;
          stack.push(n);
        }
      }
    }

    blobs.push({ minX, maxX, minY, maxY, count, pixels });
  }

  const valid = blobs.filter(b => b.count >= MIN_BLOB_PIXELS);

  for (const blob of valid) {
    const bw = blob.maxX - blob.minX + 3;
    const bh = blob.maxY - blob.minY + 3;

    const rimCanvas = document.createElement('canvas');
    rimCanvas.width = bw;
    rimCanvas.height = bh;
    const rimCtx = rimCanvas.getContext('2d');
    const rimData = rimCtx.createImageData(bw, bh);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = bw;
    maskCanvas.height = bh;
    const maskCtx = maskCanvas.getContext('2d');
    const maskData = maskCtx.createImageData(bw, bh);

    for (const idx of blob.pixels) {
      const x = idx % w, y = (idx / w) | 0;
      const lx = x - blob.minX + 1, ly = y - blob.minY + 1;
      const outIdx = (ly * bw + lx) * 4;
      const r = px[idx * 4], g = px[idx * 4 + 1], b = px[idx * 4 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum <= DARK_THRESHOLD) {
        maskData.data[outIdx] = 0;
        maskData.data[outIdx + 1] = 0;
        maskData.data[outIdx + 2] = 0;
        maskData.data[outIdx + 3] = 255;
      } else {
        rimData.data[outIdx] = r;
        rimData.data[outIdx + 1] = g;
        rimData.data[outIdx + 2] = b;
        rimData.data[outIdx + 3] = 255;
      }
    }

    rimCtx.putImageData(rimData, 0, 0);
    maskCtx.putImageData(maskData, 0, 0);
    sprites.push({ rim: rimCanvas, mask: maskCanvas, w: bw, h: bh });
  }
}

function resize() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  cssW = window.innerWidth;
  cssH = window.innerHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function drawBase() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cssW, cssH);
  if (!poster) return;
  const scale = Math.min(cssW / poster.width, cssH / poster.height);
  const dw = poster.width * scale, dh = poster.height * scale;
  const dx = (cssW - dw) / 2, dy = (cssH - dh) / 2;
  ctx.drawImage(poster, dx, dy, dw, dh);
}

function stampAt(x, y, fw, spriteIndex, rot, flip) {
  if (!sprites.length) return;
  const spr = sprites[spriteIndex];
  const targetW = fw;
  const targetH = spr.h * (targetW / spr.w);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(flip, 1);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(spr.rim, -targetW / 2, -targetH / 2, targetW, targetH);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(spr.mask, -targetW / 2, -targetH / 2, targetW, targetH);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}

function redraw() {
  drawBase();
  for (const s of shots) {
    stampAt(s.fx * cssW, s.fy * cssH, s.fw * cssW, s.spriteIndex, s.rot, s.flip);
  }
}

function shoot(x, y) {
  if (!sprites.length) return;
  const spriteIndex = Math.floor(Math.random() * sprites.length);
  const fw = (80 + Math.random() * 70) / cssW;
  const rot = (Math.random() * 50 - 25) * Math.PI / 180;
  const flip = Math.random() < 0.5 ? -1 : 1;
  const shot = { fx: x / cssW, fy: y / cssH, fw, spriteIndex, rot, flip };
  shots.push(shot);
  stampAt(x, y, fw * cssW, spriteIndex, rot, flip);
  muzzleFlash(x, y);
}

function muzzleFlash(x, y) {
  const flash = document.createElement('div');
  flash.className = 'flash';
  flash.style.left = x + 'px';
  flash.style.top = y + 'px';
  stage.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());

  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.classList.add('shake');
}

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  shoot(e.clientX - rect.left, e.clientY - rect.top);
});

window.addEventListener('resize', resize);

Promise.all([loadImage('yardstick.png'), loadImage('bulletholes.jpg')]).then(([posterImg, holesImg]) => {
  poster = posterImg;
  buildSprites(holesImg);
  resize();
});
