// Local simulation only: AI growth vs relative token price visualization
const canvas = document.getElementById('aiPriceChart');
const growthEl = document.getElementById('vizAiGrowth');
const priceEl = document.getElementById('vizSimPrice');
if (!canvas || !growthEl || !priceEl) {
  // not on this page
} else {
  const ctx = canvas.getContext('2d');
  let points = [];
  const maxPoints = 40;

  function simPrice(growth) {
    // Simple relative model: base 1.0 + log-ish growth, capped
    return Math.round((1 + Math.log1p(growth / 10) * 0.35) * 100) / 100;
  }

  function draw() {
    const w = canvas.width = canvas.offsetWidth * devicePixelRatio;
    const h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;
    ctx.clearRect(0, 0, cw, ch);

    if (points.length < 2) return;

    const minP = Math.min(...points.map(p => p.price));
    const maxP = Math.max(...points.map(p => p.price));
    const range = maxP - minP || 0.1;

    ctx.beginPath();
    ctx.strokeStyle = '#7ef0d0';
    ctx.lineWidth = 2;
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * cw;
      const y = ch - ((p.price - minP) / range) * (ch - 16) - 8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // fill under curve
    ctx.lineTo(cw, ch);
    ctx.lineTo(0, ch);
    ctx.closePath();
    ctx.fillStyle = 'rgba(126, 240, 208, 0.12)';
    ctx.fill();
  }

  function update(growth) {
    const price = simPrice(growth);
    growthEl.textContent = growth;
    priceEl.textContent = price.toFixed(2);
    points.push({ growth, price });
    if (points.length > maxPoints) points.shift();
    draw();
  }

  // Demo seed + listen for external updates if any
  let demo = 0;
  update(0);
  setInterval(() => {
    demo += Math.floor(Math.random() * 3);
    update(demo);
  }, 2200);

  // Expose for node page or others
  window.ZERONYTH_AI_PRICE = { update };
}

window.addEventListener('resize', () => {
  if (canvas) draw?.();
});
