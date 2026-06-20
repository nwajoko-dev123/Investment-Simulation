const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
let currentData = null;
let animStart = null;

function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtMoneyShort(v) {
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'K';
  return '$' + Math.round(v);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function randNormal(mean, stdev) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return z * stdev + mean;
}

function percentile(sortedArr, p) {
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

const sliderConfigs = [
  { id: 'starting', format: v => fmtMoney(v) },
  { id: 'contribution', format: v => fmtMoney(v) + '/mo' },
  { id: 'years', format: v => v + ' yrs' },
  { id: 'meanReturn', format: v => v + '%' },
  { id: 'volatility', format: v => '\u00B1' + v + '%' },
  { id: 'expenses', format: v => fmtMoney(v) + '/yr' },
  { id: 'numSims', format: v => v }
];

function refreshSliderLabels() {
  sliderConfigs.forEach(cfg => {
    const el = document.getElementById(cfg.id);
    const out = document.getElementById(cfg.id + '-out');
    out.textContent = cfg.format(Number(el.value));
  });
}

function readParams() {
  return {
    startingAmount: Number(document.getElementById('starting').value),
    monthlyContribution: Number(document.getElementById('contribution').value),
    years: Number(document.getElementById('years').value),
    meanReturn: Number(document.getElementById('meanReturn').value),
    volatility: Number(document.getElementById('volatility').value),
    annualExpenses: Number(document.getElementById('expenses').value),
    numSimulations: Number(document.getElementById('numSims').value)
  };
}

function runSimulations(params) {
  const paths = [];
  const annualContribution = params.monthlyContribution * 12;
  for (let s = 0; s < params.numSimulations; s++) {
    let balance = params.startingAmount;
    const path = [balance];
    for (let y = 0; y < params.years; y++) {
      const annualReturn = randNormal(params.meanReturn, params.volatility) / 100;
      balance = Math.max(0, balance * (1 + annualReturn) + annualContribution);
      path.push(balance);
    }
    paths.push(path);
  }
  return paths;
}

function computePercentiles(paths, years) {
  const out = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  for (let y = 0; y <= years; y++) {
    const vals = paths.map(p => p[y]).sort((a, b) => a - b);
    out.p10.push(percentile(vals, 10));
    out.p25.push(percentile(vals, 25));
    out.p50.push(percentile(vals, 50));
    out.p75.push(percentile(vals, 75));
    out.p90.push(percentile(vals, 90));
  }
  return out;
}

function animateNumber(id, target, formatFn) {
  const el = document.getElementById(id);
  const start = parseFloat(el.dataset.raw || '0');
  const duration = 600;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = start + (target - start) * eased;
    el.textContent = formatFn(current);
    if (t < 1) requestAnimationFrame(step); else el.dataset.raw = target;
  }
  requestAnimationFrame(step);
}

function updateStats({ probability, medianFinal, p10Final, p90Final, medianYearToFI }) {
  animateNumber('stat-probability', probability, v => Math.round(v) + '%');
  animateNumber('stat-median', medianFinal, v => fmtMoney(v));
  animateNumber('stat-p10', p10Final, v => fmtMoney(v));
  animateNumber('stat-p90', p90Final, v => fmtMoney(v));

  document.getElementById('stat-fi-year').textContent =
    medianYearToFI !== null ? ('Year ' + medianYearToFI) : 'Not reached';

  const probStat = document.getElementById('stat-probability').parentElement;
  probStat.classList.remove('good', 'ok', 'bad');
  if (probability >= 70) probStat.classList.add('good');
  else if (probability >= 40) probStat.classList.add('ok');
  else probStat.classList.add('bad');
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawChart(progress, hoverYear) {
  if (!currentData) return;
  const { paths, percentiles, years, target, scaleMaxRaw } = currentData;
  const finalScaleMax = Math.max(scaleMaxRaw * 1.15, target * 1.2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const padding = { left: 64, right: 16, top: 16, bottom: 30 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(139,150,161,0.12)';
  ctx.fillStyle = '#8B96A1';
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const val = finalScaleMax * (i / gridLines);
    const y = padding.top + plotH - (val / finalScaleMax) * plotH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
    ctx.fillText(fmtMoneyShort(val), padding.left - 8, y);
  }

  const revealYears = years * progress;
  const xForYear = y => padding.left + (y / years) * plotW;
  const yForVal = v => padding.top + plotH - (Math.min(v, finalScaleMax) / finalScaleMax) * plotH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(padding.left, padding.top, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = 'rgba(91,156,149,0.10)';
  ctx.lineWidth = 1;
  const drawCount = Math.min(paths.length, 150);
  for (let i = 0; i < drawCount; i++) {
    const path = paths[i];
    ctx.beginPath();
    for (let y = 0; y <= years; y++) {
      if (y > revealYears) break;
      const x = xForYear(y), yy = yForVal(path[y]);
      if (y === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  ctx.beginPath();
  let started = false;
  for (let y = 0; y <= years; y++) {
    if (y > revealYears) break;
    const x = xForYear(y), yy = yForVal(percentiles.p90[y]);
    if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
  }
  for (let y = Math.floor(Math.min(revealYears, years)); y >= 0; y--) {
    ctx.lineTo(xForYear(y), yForVal(percentiles.p10[y]));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(212,162,78,0.12)';
  ctx.fill();

  ctx.beginPath();
  for (let y = 0; y <= years; y++) {
    if (y > revealYears) break;
    const x = xForYear(y), yy = yForVal(percentiles.p50[y]);
    if (y === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.strokeStyle = '#D4A24E';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const targetY = yForVal(target);
  ctx.beginPath();
  ctx.setLineDash([6, 5]);
  ctx.moveTo(padding.left, targetY);
  ctx.lineTo(padding.left + plotW * Math.min(progress * 1.3, 1), targetY);
  ctx.strokeStyle = '#C25B4A';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  if (hoverYear !== null && hoverYear !== undefined && hoverYear <= years) {
    const x = xForYear(hoverYear);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotH);
    ctx.strokeStyle = 'rgba(232,230,225,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();

  ctx.fillStyle = '#C25B4A';
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('FIRE number: ' + fmtMoneyShort(target), padding.left + 6, targetY - 4);

  ctx.fillStyle = '#8B96A1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const yrVal = Math.round((years / xTicks) * i);
    ctx.fillText('Yr ' + yrVal, xForYear(yrVal), h - padding.bottom + 8);
  }

  if (hoverYear !== null && hoverYear !== undefined && hoverYear <= years) {
    const x = xForYear(hoverYear);
    const medVal = percentiles.p50[hoverYear];
    const p10Val = percentiles.p10[hoverYear];
    const p90Val = percentiles.p90[hoverYear];
    const lines = [
      'Year ' + hoverYear,
      'Median: ' + fmtMoneyShort(medVal),
      '10th: ' + fmtMoneyShort(p10Val),
      '90th: ' + fmtMoneyShort(p90Val)
    ];
    const tw = 124, th = 70;
    let tx = x + 10; if (tx + tw > w - padding.right) tx = x - tw - 10;
    const ty = padding.top + 10;
    ctx.fillStyle = 'rgba(28,37,46,0.96)';
    ctx.strokeStyle = 'rgba(212,162,78,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx, ty, tw, th, 6); else ctx.rect(tx, ty, tw, th);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#E8E6E1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, tx + 10, ty + 8 + i * 15));
  }
}

function animateDraw(timestamp) {
  if (!animStart) animStart = timestamp;
  const elapsed = timestamp - animStart;
  const t = Math.min(elapsed / 900, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  drawChart(eased, null);
  if (t < 1) requestAnimationFrame(animateDraw);
}

function runSimulationAndDraw() {
  const params = readParams();
  const paths = runSimulations(params);
  const percentiles = computePercentiles(paths, params.years);
  const target = params.annualExpenses * 25;

  const finalValues = paths.map(p => p[p.length - 1]).sort((a, b) => a - b);
  const successYears = paths
    .map(p => p.findIndex(v => v >= target))
    .filter(idx => idx !== -1)
    .sort((a, b) => a - b);

  const probability = (successYears.length / paths.length) * 100;
  const medianFinal = percentile(finalValues, 50);
  const p10Final = percentiles.p10[percentiles.p10.length - 1];
  const p90Final = percentiles.p90[percentiles.p90.length - 1];
  const medianYearToFI = successYears.length > 0 ? Math.round(percentile(successYears, 50)) : null;

  let scaleMaxRaw = 0;
  for (let y = 0; y <= params.years; y++) {
    if (percentiles.p90[y] > scaleMaxRaw) scaleMaxRaw = percentiles.p90[y];
  }

  currentData = { paths, percentiles, years: params.years, target, scaleMaxRaw };

  updateStats({ probability, medianFinal, p10Final, p90Final, medianYearToFI });

  animStart = null;
  requestAnimationFrame(animateDraw);
}

const debouncedRun = debounce(runSimulationAndDraw, 250);

sliderConfigs.forEach(cfg => {
  document.getElementById(cfg.id).addEventListener('input', () => {
    refreshSliderLabels();
    debouncedRun();
  });
});

document.getElementById('run-btn').addEventListener('click', runSimulationAndDraw);

canvas.addEventListener('mousemove', (e) => {
  if (!currentData) return;
  const rect = canvas.getBoundingClientRect();
  const padding = { left: 64, right: 16 };
  const plotW = rect.width - padding.left - padding.right;
  const x = e.clientX - rect.left;
  const yearFrac = (x - padding.left) / plotW;
  const hoverYear = Math.round(yearFrac * currentData.years);
  if (hoverYear >= 0 && hoverYear <= currentData.years) drawChart(1, hoverYear);
});

canvas.addEventListener('mouseleave', () => {
  if (currentData) drawChart(1, null);
});

window.addEventListener('resize', debounce(() => {
  resizeCanvas();
  if (currentData) drawChart(1, null);
}, 150));

window.addEventListener('DOMContentLoaded', () => {
  refreshSliderLabels();
  resizeCanvas();
  runSimulationAndDraw();
});
