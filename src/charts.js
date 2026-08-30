// Tiny canvas charts for the session ledger. Felt/gold palette.

const GOLD = '#e7bd5c';
const WIN = '#4ce08a';
const LOSS = '#ff6b6b';
const GRID = 'rgba(255,255,255,.06)';
const DIM = 'rgba(255,255,255,.3)';

function prep(canvas) {
  const W = canvas.parentElement.offsetWidth || canvas.offsetWidth;
  if (!W) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = W + 'px';
  canvas.style.height = '150px';
  canvas.width = W * dpr;
  canvas.height = 150 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = '10px Inter, -apple-system, sans-serif';
  return { ctx, W, H: 150 };
}

function empty(ctx, W, H, msg) {
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  ctx.font = '12px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}

/** points: cumulative values. sym: currency symbol for axis labels. */
export function drawLineChart(canvas, points, sym = '') {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, W, H } = p;
  if (points.length < 2) return empty(ctx, W, H, 'Add sessions to see the trend');
  const PAD = { t: 12, r: 12, b: 20, l: 52 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;
  const minY = Math.min(...points, 0);
  const maxY = Math.max(...points, 0);
  const range = maxY - minY || 1;
  const px = (i) => PAD.l + (i / (points.length - 1)) * cW;
  const py = (v) => PAD.t + cH - ((v - minY) / range) * cH;
  ctx.textAlign = 'right';
  [minY, 0, maxY].filter((v, i, a) => a.indexOf(v) === i).forEach((v) => {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, py(v));
    ctx.lineTo(W - PAD.r, py(v));
    ctx.stroke();
    ctx.fillStyle = DIM;
    ctx.fillText((v >= 0 ? '+' : '−') + sym + Math.abs(v).toFixed(0), PAD.l - 5, py(v) + 3);
  });
  ctx.strokeStyle = 'rgba(255,255,255,.2)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(PAD.l, py(0));
  ctx.lineTo(W - PAD.r, py(0));
  ctx.stroke();
  ctx.setLineDash([]);
  const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
  grad.addColorStop(0, 'rgba(231,189,92,.25)');
  grad.addColorStop(1, 'rgba(231,189,92,0)');
  ctx.beginPath();
  ctx.moveTo(px(0), py(points[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(px(i), py(points[i]));
  ctx.lineTo(px(points.length - 1), py(minY));
  ctx.lineTo(px(0), py(minY));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.moveTo(px(0), py(points[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(px(i), py(points[i]));
  ctx.stroke();
  points.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(px(i), py(v), 3, 0, Math.PI * 2);
    ctx.fillStyle = v >= 0 ? WIN : LOSS;
    ctx.fill();
  });
}

/** values: per-session profit. */
export function drawBarChart(canvas, values, sym = '') {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, W, H } = p;
  if (!values.length) return empty(ctx, W, H, 'No sessions yet');
  const PAD = { t: 12, r: 12, b: 20, l: 52 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;
  const minY = Math.min(...values, 0);
  const maxY = Math.max(...values, 0);
  const range = maxY - minY || 1;
  const py = (v) => PAD.t + cH - ((v - minY) / range) * cH;
  const zeroY = py(0);
  const step = cW / values.length;
  const barW = Math.max(2, step * 0.65);
  ctx.textAlign = 'right';
  [minY, maxY].filter((v, i, a) => a.indexOf(v) === i).forEach((v) => {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, py(v));
    ctx.lineTo(W - PAD.r, py(v));
    ctx.stroke();
    ctx.fillStyle = DIM;
    ctx.fillText((v >= 0 ? '+' : '−') + sym + Math.abs(v).toFixed(0), PAD.l - 5, py(v) + 3);
  });
  ctx.strokeStyle = 'rgba(255,255,255,.2)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(PAD.l, zeroY);
  ctx.lineTo(W - PAD.r, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);
  values.forEach((v, i) => {
    const x = PAD.l + i * step + (step - barW) / 2;
    const top = v >= 0 ? py(v) : zeroY;
    const hgt = Math.max(1, Math.abs(py(v) - zeroY));
    ctx.fillStyle = v >= 0 ? 'rgba(76,224,138,.6)' : 'rgba(255,107,107,.6)';
    ctx.fillRect(x, top, barW, hgt);
  });
}
