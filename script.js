const art = document.getElementById('art');
const stage = document.getElementById('stage');

let targetX = 0, targetY = 0, curX = 0, curY = 0;
const MAX_SHIFT = 18;
const start = performance.timeOrigin ? Date.now() : 0;

function setTarget(nx, ny) {
  targetX = nx * MAX_SHIFT;
  targetY = ny * MAX_SHIFT;
}

stage.addEventListener('mousemove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  setTarget(nx, ny);
});

stage.addEventListener('mouseleave', () => setTarget(0, 0));

window.addEventListener('deviceorientation', (e) => {
  if (e.gamma == null || e.beta == null) return;
  const nx = Math.max(-1, Math.min(1, e.gamma / 30));
  const ny = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
  setTarget(nx, ny);
});

function tick(now) {
  curX += (targetX - curX) * 0.06;
  curY += (targetY - curY) * 0.06;

  const t = now / 1000;
  const breathe = 1 + Math.sin(t * (2 * Math.PI / 22)) * 0.022;
  const rotate = Math.sin(t * (2 * Math.PI / 22)) * 0.3;

  art.style.transform =
    `translate(calc(-50% + ${-curX}px), calc(-50% + ${-curY}px)) scale(${breathe}) rotate(${rotate}deg)`;

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
