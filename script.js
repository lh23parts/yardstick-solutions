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

// A text-free square of the poster's own paper, mirrored into a seamless tile
// so the letterbox area carries the same grain as the printed sheet.
const PATCH = { x: 640, y: 112, size: 400 };
let paperTile = null;

// Average tone of the poster's unprinted paper, so the tiled surround can be
// matched to it rather than to the (slightly brighter) sampled patch.
function posterPaperMean(posterImg) {
  const c = document.createElement('canvas');
  c.width = posterImg.width;
  c.height = posterImg.height;
  const cx = c.getContext('2d');
  cx.drawImage(posterImg, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 85) {
      sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
    }
  }
  return n ? [sr / n, sg / n, sb / n] : null;
}

function buildPaperTile(posterImg) {
  const s = PATCH.size;
  const patch = document.createElement('canvas');
  patch.width = s;
  patch.height = s;
  const pctx = patch.getContext('2d');
  pctx.drawImage(posterImg, PATCH.x, PATCH.y, s, s, 0, 0, s, s);

  const img = pctx.getImageData(0, 0, s, s);
  const d = img.data;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= 60) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;

  // Shift the patch onto the poster's mean paper tone so no edge shows where
  // the tiled surround meets the sheet.
  const gm = posterPaperMean(posterImg);
  const dr = gm ? gm[0] - mr : 0, dg = gm ? gm[1] - mg : 0, db = gm ? gm[2] - mb : 0;

  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 60) {
      // Despeckle: dark flecks would otherwise repeat on a visible grid.
      const j = Math.random() * 8 - 4;
      d[i] = mr + j; d[i + 1] = mg + j; d[i + 2] = mb + j;
    }
    d[i] += dr;
    d[i + 1] += dg;
    d[i + 2] += db;
  }
  pctx.putImageData(img, 0, 0);

  // Mirror into a 2x2 tile so opposite edges match and tiling leaves no seam.
  const tile = document.createElement('canvas');
  tile.width = s * 2;
  tile.height = s * 2;
  const tctx = tile.getContext('2d');
  tctx.drawImage(patch, 0, 0);
  tctx.save();
  tctx.translate(s * 2, 0);
  tctx.scale(-1, 1);
  tctx.drawImage(patch, 0, 0);
  tctx.restore();
  tctx.save();
  tctx.translate(0, s * 2);
  tctx.scale(1, -1);
  tctx.drawImage(patch, 0, 0);
  tctx.restore();
  tctx.save();
  tctx.translate(s * 2, s * 2);
  tctx.scale(-1, -1);
  tctx.drawImage(patch, 0, 0);
  tctx.restore();

  paperTile = tile;
}

function drawBase() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cssW, cssH);
  if (!poster) return;
  const scale = Math.min(cssW / poster.width, cssH / poster.height);

  // Lay the paper grain across the whole viewport at the poster's own scale,
  // so texture density matches across the seam.
  if (paperTile) {
    const pattern = ctx.createPattern(paperTile, 'repeat');
    if (pattern.setTransform) {
      pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cssW, cssH);
    } else {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cssW / scale, cssH / scale);
      ctx.restore();
    }
  }

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

// --- procedural gunshot audio (no external sound files) ---
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playShot(punchy) {
  if (!audioCtx) return;
  const ac = audioCtx;
  const now = ac.currentTime;
  const duration = punchy ? 0.11 + Math.random() * 0.03 : 0.16 + Math.random() * 0.05;

  const bufferSize = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const decay = Math.pow(1 - i / bufferSize, 2.2);
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  const noise = ac.createBufferSource();
  noise.buffer = buffer;

  const bandpass = ac.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = (punchy ? 1500 : 1100) + Math.random() * 500;
  bandpass.Q.value = 0.5;

  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(1, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  noise.connect(bandpass).connect(noiseGain).connect(ac.destination);

  const thump = ac.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(130 + Math.random() * 20, now);
  thump.frequency.exponentialRampToValueAtTime(35, now + duration * 0.7);

  const thumpGain = ac.createGain();
  thumpGain.gain.setValueAtTime(0.9, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.8);

  thump.connect(thumpGain).connect(ac.destination);

  noise.start(now);
  noise.stop(now + duration);
  thump.start(now);
  thump.stop(now + duration);
}

// --- click / click-and-hold machine-gun fire ---
let firing = false;
let fireTimer = null;
let pointerX = 0, pointerY = 0;

function fireOnce(x, y, punchy) {
  shoot(x, y);
  playShot(punchy);
}

function scheduleNextRound() {
  const interval = 85 + Math.random() * 45;
  fireTimer = setTimeout(() => {
    if (!firing) return;
    fireOnce(
      pointerX + (Math.random() * 30 - 15),
      pointerY + (Math.random() * 30 - 15),
      true
    );
    scheduleNextRound();
  }, interval);
}

function startFiring(x, y) {
  ensureAudio();
  pointerX = x;
  pointerY = y;
  firing = true;
  fireOnce(x, y, false);
  scheduleNextRound();
}

function stopFiring() {
  firing = false;
  clearTimeout(fireTimer);
}

function localCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = localCoords(e);
  startFiring(x, y);
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = localCoords(e);
  pointerX = x;
  pointerY = y;
});

canvas.addEventListener('pointerup', stopFiring);
canvas.addEventListener('pointercancel', stopFiring);
canvas.addEventListener('pointerleave', stopFiring);

window.addEventListener('resize', resize);

Promise.all([loadImage('yardstick.png'), loadImage('bulletholes.jpg')]).then(([posterImg, holesImg]) => {
  poster = posterImg;
  buildPaperTile(posterImg);
  buildSprites(holesImg);
  resize();
});
