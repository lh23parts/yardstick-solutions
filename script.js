const stage = document.getElementById('stage');
const canvas = document.getElementById('art');
const ctx = canvas.getContext('2d');
const BG = '#eb3c0c';
const DARK_THRESHOLD = 75; // luminance below this = hole interior, above = torn rim texture
const MIN_BLOB_PIXELS = 30;

let dpr = Math.max(1, window.devicePixelRatio || 1);
let cssW = 0, cssH = 0;
let poster = null;
let contactPhone = null, contactEmail = null;
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
  // Once the sheet has been crumpled away it must not come back on resize.
  if (crumpled) {
    ctx.clearRect(0, 0, cssW, cssH);
  } else if (!crumpling) {
    redraw();
  }
}

// The paper texture is a pre-flattened, tone-matched square of the poster's own
// stock (see README); mirrored here into a 2x2 tile so it repeats seamlessly.
let paperTile = null;

// The scan carries a mild vignette, so the sheet's edge sits a few luminance
// units off the flat surround and reads as a faint line. Fading the blank outer
// margin dissolves that boundary, leaving one continuous sheet.
const FEATHER = 28; // source pixels of the poster's blank margin
let posterFeathered = null;

function buildFeatheredPoster(posterImg) {
  const w = posterImg.width, h = posterImg.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.drawImage(posterImg, 0, 0);

  x.globalCompositeOperation = 'destination-out';
  const edges = [
    [0, 0, FEATHER, 0, 0, 0, FEATHER, h],          // left
    [w, 0, w - FEATHER, 0, w - FEATHER, 0, FEATHER, h], // right
    [0, 0, 0, FEATHER, 0, 0, w, FEATHER],          // top
    [0, h, 0, h - FEATHER, 0, h - FEATHER, w, FEATHER]  // bottom
  ];
  for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of edges) {
    const grad = x.createLinearGradient(gx0, gy0, gx1, gy1);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grad;
    x.fillRect(rx, ry, rw, rh);
  }
  x.globalCompositeOperation = 'source-over';
  posterFeathered = c;
}

function buildPaperTile(patchImg) {
  const s = patchImg.width;
  const tile = document.createElement('canvas');
  tile.width = s * 2;
  tile.height = s * 2;
  const t = tile.getContext('2d');
  t.drawImage(patchImg, 0, 0);
  t.save(); t.translate(s * 2, 0); t.scale(-1, 1); t.drawImage(patchImg, 0, 0); t.restore();
  t.save(); t.translate(0, s * 2); t.scale(1, -1); t.drawImage(patchImg, 0, 0); t.restore();
  t.save(); t.translate(s * 2, s * 2); t.scale(-1, -1); t.drawImage(patchImg, 0, 0); t.restore();
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
  ctx.drawImage(posterFeathered || poster, dx, dy, dw, dh);

  drawContact();
}

// Phone and email set flush left in the bottom-left corner. Drawn into the
// base layer (not as DOM) so shots tear through them like the rest of the print.
const CONTACT_GAP = 23; // vertical gap between the two lines in source pixels

function drawContact() {
  if (!contactPhone || !contactEmail) return;
  const margin = Math.max(18, Math.round(cssW * 0.03));
  const emailW = Math.max(240, Math.min(cssW * 0.30, 460));
  const k = emailW / contactEmail.width;
  const phoneW = contactPhone.width * k, phoneH = contactPhone.height * k;
  const emailH = contactEmail.height * k;
  const gap = CONTACT_GAP * k;

  const emailY = cssH - margin - emailH;
  const phoneY = emailY - gap - phoneH;

  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(contactPhone, margin, phoneY, phoneW, phoneH);
  ctx.drawImage(contactEmail, margin, emailY, emailW, emailH);
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

// --- ammo ---
const MAX_AMMO = 6;
let ammo = MAX_AMMO;
let crumpling = false, crumpled = false;
const ammoEl = document.getElementById('ammo');

function setAmmo(n) {
  ammo = n;
  ammoEl.src = `ammo-${n}.png`;
  ammoEl.alt = `${n} of ${MAX_AMMO} shots remaining`;
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
let modalOpen = false;

// Returns false when the magazine is empty, which also ends a held burst.
function fireOnce(x, y, punchy) {
  if (ammo <= 0 || crumpling || crumpled) return false;
  shoot(x, y);
  playShot(punchy);
  setAmmo(ammo - 1);
  if (ammo === 0) {
    stopFiring();
    setTimeout(startCrumple, 550);
  }
  return true;
}

function scheduleNextRound() {
  const interval = 85 + Math.random() * 45;
  fireTimer = setTimeout(() => {
    if (!firing) return;
    const fired = fireOnce(
      pointerX + (Math.random() * 30 - 15),
      pointerY + (Math.random() * 30 - 15),
      true
    );
    if (fired) scheduleNextRound();
  }, interval);
}

function startFiring(x, y) {
  if (modalOpen || ammo <= 0 || crumpling || crumpled) return;
  ensureAudio();
  pointerX = x;
  pointerY = y;
  firing = true;
  firing = fireOnce(x, y, false);
  if (firing) scheduleNextRound();
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

// --- crumple: warp the shot-up sheet into a ball, leaving only sky ---
const GRID_X = 13, GRID_Y = 17;   // mesh resolution
const CRUMPLE_MS = 2600;
let sheetTex = null;              // snapshot of the sheet at the moment ammo ran out
let sheetW = 0, sheetH = 0;       // its own size, so a mid-animation resize cannot skew the source rects
let crumpleStart = 0;

// Deterministic per-vertex noise so the folds stay put between frames.
function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xffff) / 0xffff;
}

function smoothNoise(u, v, freq, seed) {
  const x = u * freq, y = v * freq;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed), n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed), n11 = hash2(x0 + 1, y0 + 1, seed);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

function fbm(u, v, seed) {
  return smoothNoise(u, v, 3, seed) * 0.6 +
         smoothNoise(u, v, 7, seed + 91) * 0.3 +
         smoothNoise(u, v, 15, seed + 197) * 0.1;
}

function startCrumple() {
  if (crumpling || crumpled) return;
  // snapshot the sheet as it stands, holes and all
  sheetTex = document.createElement('canvas');
  sheetW = sheetTex.width = cssW;
  sheetH = sheetTex.height = cssH;
  const t = sheetTex.getContext('2d');
  t.drawImage(canvas, 0, 0, cssW, cssH);

  crumpling = true;
  crumpleStart = performance.now();
  requestAnimationFrame(crumpleFrame);
}

// Map a source triangle onto a destination triangle with an affine transform.
function drawWarpedTriangle(tex, s0, s1, s2, d0, d1, d2) {
  const det = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (!det) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / det;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / det;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / det;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / det;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - d * s0[1];

  // Sample only this cell's slice of the texture rather than the whole sheet.
  const sx = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0])) - 1);
  const sy = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1])) - 1);
  const sw = Math.min(tex.width - sx, Math.ceil(Math.max(s0[0], s1[0], s2[0])) + 1 - sx);
  const sh = Math.min(tex.height - sy, Math.ceil(Math.max(s0[1], s1[1], s2[1])) + 1 - sy);
  if (sw <= 0 || sh <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(tex, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

function crumpleFrame(now) {
  const raw = Math.min(1, (now - crumpleStart) / CRUMPLE_MS);
  const ease = raw * raw * (3 - 2 * raw);

  // scrunch first, then close the fist and toss it away
  const squeeze = Math.min(1, ease / 0.62);          // collapse toward the centre
  const wrinkle = Math.min(1, ease / 0.45);          // ramps up and holds: paper does not un-crumple
  const toss = Math.max(0, (ease - 0.72) / 0.28);

  const cx = cssW / 2, cy = cssH * 0.46;
  // Converge on a roughly square ball rather than a shrunken rectangle.
  const ballR = Math.min(cssW, cssH) * 0.09;
  const ex = cssW / 2 + (ballR - cssW / 2) * squeeze;
  const ey = cssH / 2 + (ballR - cssH / 2) * squeeze;
  const spin = squeeze * 0.5 + toss * 1.6;
  const tossX = toss * cssW * 0.5;
  const tossY = toss * toss * cssH * 1.15 - toss * cssH * 0.25;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.globalAlpha = 1 - Math.max(0, (ease - 0.88) / 0.12);

  const cos = Math.cos(spin), sin = Math.sin(spin);
  const pts = [];
  for (let iy = 0; iy <= GRID_Y; iy++) {
    for (let ix = 0; ix <= GRID_X; ix++) {
      const u = ix / GRID_X, v = iy / GRID_Y;
      // sheet position, relative to centre, collapsing toward a ball
      let px = (u - 0.5) * 2 * ex, py = (v - 0.5) * 2 * ey;
      // folds: smooth noise pushes the surface around as it is squeezed
      const nx = (fbm(u, v, 11) - 0.5) * 2, ny = (fbm(u, v, 53) - 0.5) * 2;
      const amp = wrinkle * squeeze * Math.min(cssW, cssH) * 0.11;
      px += nx * amp;
      py += ny * amp;
      // pull edges in harder than the middle, the way paper gathers
      const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      px *= 1 - 0.25 * squeeze * edge;
      py *= 1 - 0.25 * squeeze * edge;
      pts.push([
        cx + px * cos - py * sin + tossX,
        cy + px * sin + py * cos + tossY,
        u, v
      ]);
    }
  }

  const idx = (ix, iy) => pts[iy * (GRID_X + 1) + ix];
  for (let iy = 0; iy < GRID_Y; iy++) {
    for (let ix = 0; ix < GRID_X; ix++) {
      const p00 = idx(ix, iy), p10 = idx(ix + 1, iy);
      const p01 = idx(ix, iy + 1), p11 = idx(ix + 1, iy + 1);
      const s00 = [p00[2] * sheetW, p00[3] * sheetH];
      const s10 = [p10[2] * sheetW, p10[3] * sheetH];
      const s01 = [p01[2] * sheetW, p01[3] * sheetH];
      const s11 = [p11[2] * sheetW, p11[3] * sheetH];

      drawWarpedTriangle(sheetTex, s00, s10, s01, p00, p10, p01);
      drawWarpedTriangle(sheetTex, s11, s10, s01, p11, p10, p01);

      // Shade by how much the cell compressed: tight folds go dark, and the
      // ones that splay out catch the light.
      const expected = (2 * ex / GRID_X) * (2 * ey / GRID_Y);
      const area = Math.abs(
        (p10[0] - p00[0]) * (p01[1] - p00[1]) - (p01[0] - p00[0]) * (p10[1] - p00[1])
      );
      const ratio = area / (expected + 0.0001);
      ctx.beginPath();
      ctx.moveTo(p00[0], p00[1]);
      ctx.lineTo(p10[0], p10[1]);
      ctx.lineTo(p11[0], p11[1]);
      ctx.lineTo(p01[0], p01[1]);
      ctx.closePath();
      if (ratio < 1) {
        ctx.fillStyle = `rgba(60,14,4,${Math.min(0.66, (1 - ratio) * 0.85) * squeeze})`;
      } else {
        ctx.fillStyle = `rgba(255,225,190,${Math.min(0.3, (ratio - 1) * 0.3) * squeeze})`;
      }
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;

  if (raw < 1) {
    requestAnimationFrame(crumpleFrame);
  } else {
    crumpling = false;
    crumpled = true;
    ctx.clearRect(0, 0, cssW, cssH);   // only sky left
    const msg = document.getElementById('outOfAmmo');
    msg.hidden = false;
    requestAnimationFrame(() => msg.classList.add('show'));
  }
}

// --- T-shirt order window ---
const overlay = document.getElementById('overlay');
const orderBtn = document.getElementById('orderBtn');
const orderForm = document.getElementById('orderForm');
const sentPane = document.getElementById('sentPane');
const formErr = document.getElementById('formErr');
const ORDER_TO = 'order@yardsticksolutions.com';

const mailwin = document.querySelector('.mailwin');
const WIN_PAD = 12;

// Drop the window somewhere new on every open, always fully on screen.
// randomize=false just re-clamps the current spot (used on resize).
function placeWindow(randomize) {
  const maxX = Math.max(WIN_PAD, window.innerWidth - mailwin.offsetWidth - WIN_PAD);
  const maxY = Math.max(WIN_PAD, window.innerHeight - mailwin.offsetHeight - WIN_PAD);
  let x, y;
  if (randomize) {
    x = WIN_PAD + Math.random() * (maxX - WIN_PAD);
    y = WIN_PAD + Math.random() * (maxY - WIN_PAD);
  } else {
    x = Math.min(parseFloat(mailwin.style.left) || WIN_PAD, maxX);
    y = Math.min(parseFloat(mailwin.style.top) || WIN_PAD, maxY);
  }
  mailwin.style.left = Math.round(Math.max(WIN_PAD, x)) + 'px';
  mailwin.style.top = Math.round(Math.max(WIN_PAD, y)) + 'px';
}

function openOrder() {
  stopFiring();
  modalOpen = true;
  overlay.hidden = false;
  sentPane.hidden = true;
  formErr.textContent = '';
  placeWindow(true);
  document.getElementById('fFrom').focus({ preventScroll: true });
}

window.addEventListener('resize', () => { if (modalOpen) placeWindow(false); });

function closeOrder() {
  overlay.hidden = true;
  modalOpen = false;
}

orderBtn.addEventListener('click', openOrder);
document.getElementById('mailClose').addEventListener('click', closeOrder);
document.getElementById('sentClose').addEventListener('click', closeOrder);
document.getElementById('sendBtn').addEventListener('click', () => submitOrder());
document.getElementById('sentPane').addEventListener('click', (e) => e.stopPropagation());

overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOrder(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay.hidden) closeOrder();
  if (!overlay.hidden && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    submitOrder();
  }
});

orderForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitOrder();
});

function buildOrderMailto() {
  const get = (id) => document.getElementById(id).value.trim();
  const lines = [
    `Name: ${get('fName')}`,
    `Email: ${get('fFrom')}`,
    `Shipping address: ${get('fAddr')}`,
    `Size: ${get('fSize')}`,
    `Quantity: ${get('fQty')}`,
    '',
    'Why I need a YS Solutions T Shirt:',
    get('fBody') || '(no reason given)'
  ];
  // Build the query by hand: URLSearchParams encodes spaces as "+", which mail
  // clients do not decode in a mailto body (RFC 6068 wants %20).
  const q = [
    `subject=${encodeURIComponent(get('fSubject') || 'T-Shirt Order')}`,
    `body=${encodeURIComponent(lines.join('\n'))}`
  ];
  const cc = get('fCc');
  if (cc) q.push(`cc=${encodeURIComponent(cc)}`);
  return `mailto:${ORDER_TO}?${q.join('&')}`;
}

function submitOrder() {
  const get = (id) => document.getElementById(id).value.trim();
  const required = ['fFrom', 'fName', 'fAddr', 'fSize', 'fQty'];
  let firstBad = null;
  for (const id of required) {
    const el = document.getElementById(id);
    el.classList.add('touched');
    if (!el.value.trim() || !el.checkValidity()) firstBad = firstBad || el;
  }
  if (firstBad) {
    formErr.textContent = 'Please fill in your email, name, address, size and quantity.';
    firstBad.focus();
    return;
  }

  window.location.href = buildOrderMailto();

  document.getElementById('sentMsg').textContent =
    `Thanks, ${get('fName').split(' ')[0]} — your order is on its way to ${ORDER_TO}. ` +
    `We'll reply to ${get('fFrom')} with a secure payment link.`;
  sentPane.hidden = false;
}

Promise.all([
  loadImage('yardstick.png'),
  loadImage('bulletholes.jpg'),
  loadImage('paper-patch.png'),
  loadImage('contact-phone.png'),
  loadImage('contact-email.png')
]).then(([posterImg, holesImg, patchImg, phoneImg, emailImg]) => {
  poster = posterImg;
  contactPhone = phoneImg;
  contactEmail = emailImg;
  buildFeatheredPoster(posterImg);
  buildPaperTile(patchImg);
  buildSprites(holesImg);
  resize();
});
