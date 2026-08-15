(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const fmt1 = (n) => (n === null || n === undefined ? "—" : n.toFixed(1));
  const fmt2 = (n) => (n === null || n === undefined ? "—" : n.toFixed(2));

  const el = (tag, attrs = {}, ns) => {
    const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    return node;
  };

  const svgEl = (tag, attrs = {}) => el(tag, attrs, SVGNS);

  // ---------- theme toggle ----------

  function initTheme() {
    const root = document.documentElement;
    const stored = localStorage.getItem("prijspeil-theme");
    if (stored) root.setAttribute("data-theme", stored);

    const btn = document.getElementById("theme-toggle");
    btn.addEventListener("click", () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const current = root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("prijspeil-theme", next);
    });
  }

  // ---------- date/time helpers ----------

  const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
  const dayFmtFull = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

  function relativeUpdated(iso) {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const mins = Math.round((now - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    return `${days} d ago`;
  }

  // ---------- sparkline ----------

  function sparkline(svg, values, color) {
    const w = 300, h = 40, pad = 3;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!values.length) return;

    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const x = (i) => pad + (i / (values.length - 1 || 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);

    const linePoints = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const areaPoints = `${x(0)},${h} ${linePoints} ${x(values.length - 1)},${h}`;

    svg.appendChild(svgEl("polygon", { points: areaPoints, fill: color, opacity: "0.12", stroke: "none" }));
    svg.appendChild(svgEl("polyline", {
      points: linePoints, fill: "none", stroke: color, "stroke-width": "2",
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
    const lastX = x(values.length - 1), lastY = y(values[values.length - 1]);
    svg.appendChild(svgEl("circle", { cx: lastX, cy: lastY, r: "3", fill: color }));
  }

  // ---------- level bar ----------

  function levelBar(card, min, max, current) {
    const fill = card.querySelector(".level-fill");
    const marker = card.querySelector(".level-marker");
    const lo = card.querySelector(".level-label.lo");
    const hi = card.querySelector(".level-label.hi");
    const span = max - min || 1;
    const pct = Math.max(0, Math.min(100, ((current - min) / span) * 100));
    fill.style.width = pct + "%";
    marker.style.left = pct + "%";
    lo.textContent = fmt1(min);
    hi.textContent = fmt1(max);
  }

  // ---------- delta chip ----------

  function renderDelta(container, value, pctValue, unit) {
    container.innerHTML = "";
    if (value === null || value === undefined || Number.isNaN(value)) {
      container.classList.add("flat");
      container.textContent = "no prior value";
      return;
    }
    const dir = value > 0.005 ? "up" : value < -0.005 ? "down" : "flat";
    container.classList.add(dir);
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";
    const arrowClass = dir === "up" ? "arrow-up" : dir === "down" ? "arrow-down" : "";
    const pctStr = pctValue !== undefined && pctValue !== null ? ` (${pctValue > 0 ? "+" : ""}${pctValue.toFixed(1)}%)` : "";
    container.innerHTML =
      `<span class="${arrowClass}">${arrow}</span> ${value > 0 ? "+" : ""}${fmt2(value)} ${unit}${pctStr}`;
  }

  // ---------- generic line/area chart with hover ----------

  function buildAxisChart({ frame, xs, ys, color, softColor, yFormat, xTickLabel, annotations = [], baseline = null }) {
    const w = 1080, h = 320;
    const margin = { top: 16, right: 16, bottom: 26, left: 52 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" });
    frame.innerHTML = "";
    frame.appendChild(svg);

    const yMin = Math.min(...ys, baseline ?? Infinity);
    const yMax = Math.max(...ys, baseline ?? -Infinity);
    const yPad = (yMax - yMin) * 0.08 || 1;
    const yLo = yMin - yPad, yHi = yMax + yPad;

    const xScale = (i) => margin.left + (i / (xs.length - 1 || 1)) * innerW;
    const yScale = (v) => margin.top + innerH - ((v - yLo) / (yHi - yLo || 1)) * innerH;

    // gridlines (y) + labels
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const v = yLo + ((yHi - yLo) * i) / gridCount;
      const gy = yScale(v);
      svg.appendChild(svgEl("line", { class: "grid-line", x1: margin.left, x2: w - margin.right, y1: gy, y2: gy }));
      svg.appendChild(svgEl("text", {
        class: "axis-label", x: margin.left - 8, y: gy + 3, "text-anchor": "end", text: yFormat(v),
      }));
    }

    if (baseline !== null) {
      const by = yScale(baseline);
      svg.appendChild(svgEl("line", { class: "zero-line", x1: margin.left, x2: w - margin.right, y1: by, y2: by }));
    }

    // x labels: pick ~6 evenly spaced ticks
    const tickEvery = Math.max(1, Math.round(xs.length / 6));
    for (let i = 0; i < xs.length; i += tickEvery) {
      svg.appendChild(svgEl("text", {
        class: "axis-label", x: xScale(i), y: h - 6, "text-anchor": "middle", text: xTickLabel(i),
      }));
    }

    // area + line
    const linePoints = ys.map((v, i) => `${xScale(i)},${yScale(v)}`).join(" ");
    const baseY = baseline !== null ? yScale(baseline) : yScale(yLo);
    const areaPoints = `${xScale(0)},${baseY} ${linePoints} ${xScale(xs.length - 1)},${baseY}`;
    svg.appendChild(svgEl("polygon", { points: areaPoints, fill: softColor, stroke: "none" }));
    svg.appendChild(svgEl("polyline", {
      points: linePoints, fill: "none", stroke: color, "stroke-width": "2",
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));

    // annotations
    annotations.forEach((a) => {
      const ax = xScale(a.index), ay = yScale(a.value);
      svg.appendChild(svgEl("line", { class: "annotation-line", x1: ax, x2: ax, y1: margin.top, y2: ay }));
      svg.appendChild(svgEl("circle", { cx: ax, cy: ay, r: "4", fill: "var(--critical)" }));
      const labelX = Math.min(ax + 8, w - margin.right - 4);
      svg.appendChild(svgEl("text", {
        class: "annotation-label", x: labelX, y: margin.top + 10, "text-anchor": ax > w - 160 ? "end" : "start",
        text: a.label,
      }));
    });

    // hover layer
    const crosshair = svgEl("line", { class: "crosshair", x1: 0, x2: 0, y1: margin.top, y2: margin.top + innerH });
    const dot = svgEl("circle", { class: "hover-dot", r: "4.5", fill: color, stroke: "var(--surface)", "stroke-width": "2" });
    svg.appendChild(crosshair);
    svg.appendChild(dot);

    const tooltip = el("div", { class: "tooltip" });
    frame.appendChild(tooltip);

    const hitRect = svgEl("rect", {
      x: margin.left, y: margin.top, width: innerW, height: innerH, fill: "transparent",
    });
    svg.appendChild(hitRect);

    function showAt(clientX) {
      const rect = svg.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * w;
      let idx = Math.round(((px - margin.left) / innerW) * (xs.length - 1));
      idx = Math.max(0, Math.min(xs.length - 1, idx));
      const cx = xScale(idx), cy = yScale(ys[idx]);
      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.classList.add("visible");
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
      dot.classList.add("visible");

      tooltip.innerHTML = `<div class="t-title">${xs[idx].tooltipTitle}</div><div class="t-value">${yFormat(ys[idx], true)}</div>`;
      const frameRect = frame.getBoundingClientRect();
      const svgLeftInFrame = rect.left - frameRect.left;
      const svgScaleX = rect.width / w;
      tooltip.style.left = svgLeftInFrame + cx * svgScaleX + "px";
      tooltip.style.top = (rect.top - frameRect.top) + (cy * (rect.height / h)) + "px";
      tooltip.classList.add("visible");
    }

    function hide() {
      crosshair.classList.remove("visible");
      dot.classList.remove("visible");
      tooltip.classList.remove("visible");
    }

    svg.addEventListener("pointermove", (e) => showAt(e.clientX));
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("touchmove", (e) => {
      if (e.touches[0]) showAt(e.touches[0].clientX);
    }, { passive: true });
  }

  // ---------- hourly bar chart (today's curve) ----------

  function buildBarChart({ frame, values, labels, colorFor }) {
    const w = 1080, h = 220;
    const margin = { top: 16, right: 16, bottom: 26, left: 52 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" });
    frame.innerHTML = "";
    frame.appendChild(svg);

    const yMin = Math.min(0, ...values), yMax = Math.max(0, ...values);
    const yPad = (yMax - yMin) * 0.1 || 1;
    const yLo = yMin - yPad, yHi = yMax + yPad;
    const yScale = (v) => margin.top + innerH - ((v - yLo) / (yHi - yLo || 1)) * innerH;
    const zeroY = yScale(0);

    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const v = yLo + ((yHi - yLo) * i) / gridCount;
      const gy = yScale(v);
      svg.appendChild(svgEl("line", { class: "grid-line", x1: margin.left, x2: w - margin.right, y1: gy, y2: gy }));
      svg.appendChild(svgEl("text", { class: "axis-label", x: margin.left - 8, y: gy + 3, "text-anchor": "end", text: fmt1(v) }));
    }

    const bandW = innerW / values.length;
    const barW = Math.max(2, bandW * 0.6);

    const tooltip = el("div", { class: "tooltip" });
    frame.appendChild(tooltip);

    values.forEach((v, i) => {
      const cx = margin.left + bandW * (i + 0.5);
      const y1 = yScale(Math.max(0, v));
      const y2 = yScale(Math.min(0, v));
      const bar = svgEl("rect", {
        x: cx - barW / 2, y: Math.min(y1, zeroY), width: barW,
        height: Math.max(1, Math.abs(zeroY - (v >= 0 ? y1 : y2))),
        fill: colorFor(v), rx: "2",
      });
      svg.appendChild(bar);

      bar.addEventListener("pointerenter", () => {
        tooltip.innerHTML = `<div class="t-title">${labels[i]}</div><div class="t-value">${fmt2(v)} EUR/MWh</div>`;
        const frameRect = frame.getBoundingClientRect();
        const rect = svg.getBoundingClientRect();
        const scaleX = rect.width / w, scaleY = rect.height / h;
        tooltip.style.left = (rect.left - frameRect.left) + cx * scaleX + "px";
        tooltip.style.top = (rect.top - frameRect.top) + Math.min(y1, zeroY) * scaleY + "px";
        tooltip.classList.add("visible");
      });
      bar.addEventListener("pointerleave", () => tooltip.classList.remove("visible"));
    });

    if (yLo < 0) {
      svg.appendChild(svgEl("line", { class: "zero-line", x1: margin.left, x2: w - margin.right, y1: zeroY, y2: zeroY }));
    }

    const tickEvery = Math.max(1, Math.round(values.length / 8));
    values.forEach((_, i) => {
      if (i % tickEvery !== 0) return;
      svg.appendChild(svgEl("text", {
        class: "axis-label", x: margin.left + bandW * (i + 0.5), y: h - 6, "text-anchor": "middle", text: labels[i].split(" ")[0],
      }));
    });
  }

  // ---------- candlestick chart ----------

  function buildCandleChart({ frame, points }) {
    const w = 1080, h = 320;
    const margin = { top: 16, right: 16, bottom: 26, left: 52 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" });
    frame.innerHTML = "";
    frame.appendChild(svg);

    const highs = points.map((p) => p.high), lows = points.map((p) => p.low);
    const yMin = Math.min(...lows), yMax = Math.max(...highs);
    const yPad = (yMax - yMin) * 0.12 || 1;
    const yLo = yMin - yPad, yHi = yMax + yPad;
    const yScale = (v) => margin.top + innerH - ((v - yLo) / (yHi - yLo || 1)) * innerH;

    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const v = yLo + ((yHi - yLo) * i) / gridCount;
      const gy = yScale(v);
      svg.appendChild(svgEl("line", { class: "grid-line", x1: margin.left, x2: w - margin.right, y1: gy, y2: gy }));
      svg.appendChild(svgEl("text", { class: "axis-label", x: margin.left - 8, y: gy + 3, "text-anchor": "end", text: fmt1(v) }));
    }

    const bandW = innerW / points.length;
    const bodyW = Math.max(6, bandW * 0.5);

    const tooltip = el("div", { class: "tooltip" });
    frame.appendChild(tooltip);

    points.forEach((p, i) => {
      const cx = margin.left + bandW * (i + 0.5);
      const up = p.close >= p.open;
      const color = up ? "var(--good)" : "var(--critical)";

      svg.appendChild(svgEl("line", {
        x1: cx, x2: cx, y1: yScale(p.high), y2: yScale(p.low), stroke: "var(--gas)", "stroke-width": "1.5", opacity: "0.55",
      }));

      const bodyTop = yScale(Math.max(p.open, p.close));
      const bodyBottom = yScale(Math.min(p.open, p.close));
      const rect = svgEl("rect", {
        x: cx - bodyW / 2, y: bodyTop, width: bodyW, height: Math.max(2, bodyBottom - bodyTop),
        fill: color, stroke: "var(--gas)", "stroke-width": "1", rx: "2",
      });
      svg.appendChild(rect);

      const hit = svgEl("rect", { x: cx - bandW / 2, y: margin.top, width: bandW, height: innerH, fill: "transparent" });
      hit.addEventListener("pointerenter", () => {
        tooltip.innerHTML =
          `<div class="t-title">${dayFmtFull.format(new Date(p.date))}</div>` +
          `<div class="t-value">O ${fmt2(p.open)} · H ${fmt2(p.high)} · L ${fmt2(p.low)} · C ${fmt2(p.close)}</div>`;
        const frameRect = frame.getBoundingClientRect();
        const rect2 = svg.getBoundingClientRect();
        const scaleX = rect2.width / w, scaleY = rect2.height / h;
        tooltip.style.left = (rect2.left - frameRect.left) + cx * scaleX + "px";
        tooltip.style.top = (rect2.top - frameRect.top) + bodyTop * scaleY + "px";
        tooltip.classList.add("visible");
      });
      hit.addEventListener("pointerleave", () => tooltip.classList.remove("visible"));
      svg.appendChild(hit);
    });

    points.forEach((p, i) => {
      svg.appendChild(svgEl("text", {
        class: "axis-label", x: margin.left + bandW * (i + 0.5), y: h - 6, "text-anchor": "middle", text: dayFmt.format(new Date(p.date)),
      }));
    });
  }

  // ---------- data tables ----------

  function fillTable(tbody, rows) {
    tbody.innerHTML = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  }

  // ---------- main ----------

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function main() {
    initTheme();

    let entsoe, ttf;
    try {
      [entsoe, ttf] = await Promise.all([loadJSON("data/entsoe.json"), loadJSON("data/ttf.json")]);
    } catch (err) {
      document.getElementById("app").setAttribute("data-state", "error");
      document.getElementById("error-detail").textContent = String(err.message || err);
      return;
    }

    document.getElementById("app").setAttribute("data-state", "ready");

    // ----- last updated -----
    const generatedAt = entsoe.generated_at || ttf.generated_at;
    if (generatedAt) {
      document.getElementById("updated-relative").textContent = relativeUpdated(generatedAt);
      document.getElementById("updated-abs").textContent = dayFmtFull.format(new Date(generatedAt)) + ", " + timeFmt.format(new Date(generatedAt));
    }

    // ===== electricity hero meter =====
    const eSummary = entsoe.summary;
    const ePoints = entsoe.points;
    document.getElementById("e-value").textContent = fmt2(eSummary.latest_price);
    document.getElementById("e-sub").textContent =
      `Hour ${String(eSummary.latest_hour).padStart(2, "0")}:00–${String((eSummary.latest_hour + 1) % 24).padStart(2, "0")}:00 local, ${dayFmtFull.format(new Date(eSummary.latest_date))}`;
    renderDelta(
      document.getElementById("e-delta"),
      eSummary.today_avg !== null && eSummary.prev_day_avg !== null ? eSummary.today_avg - eSummary.prev_day_avg : null,
      eSummary.prev_day_avg ? ((eSummary.today_avg - eSummary.prev_day_avg) / Math.abs(eSummary.prev_day_avg)) * 100 : null,
      "vs yesterday's avg"
    );
    const eSparkVals = ePoints.slice(-48).map((p) => p.price);
    sparkline(document.getElementById("e-sparkline"), eSparkVals, "var(--electric)");
    levelBar(document.getElementById("e-meter-card"), eSummary.all_time_min, eSummary.all_time_max, eSummary.latest_price);

    // ===== gas hero meter =====
    const gSummary = ttf.summary;
    const gPoints = ttf.points;
    document.getElementById("g-value").textContent = fmt2(gSummary.latest_close);
    document.getElementById("g-sub").textContent = `Close, ${dayFmtFull.format(new Date(gSummary.latest_date))} · delayed quote`;
    renderDelta(document.getElementById("g-delta"), gSummary.change, gSummary.change_pct, "vs prior close");
    sparkline(document.getElementById("g-sparkline"), gPoints.map((p) => p.close), "var(--gas)");
    levelBar(document.getElementById("g-meter-card"), gSummary.period_min, gSummary.period_max, gSummary.latest_close);

    // ===== electricity section =====
    const negCount = ePoints.filter((p) => p.price < 0).length;
    document.getElementById("e-neg-count").textContent = negCount;
    document.getElementById("e-day-count").textContent = eSummary.day_count;

    document.getElementById("stat-today-avg").textContent = fmt2(eSummary.today_avg);
    document.getElementById("stat-prev-avg").textContent = fmt2(eSummary.prev_day_avg);
    document.getElementById("stat-window-low").textContent = fmt2(eSummary.all_time_min);
    document.getElementById("stat-window-high").textContent = fmt2(eSummary.all_time_max);

    const eXs = ePoints.map((p) => ({
      tooltipTitle: `${dayFmt.format(new Date(p.timestamp_utc))} · ${String(p.hour).padStart(2, "0")}:00`,
    }));
    const eYs = ePoints.map((p) => p.price);
    let minIdx = 0;
    ePoints.forEach((p, i) => { if (p.price < ePoints[minIdx].price) minIdx = i; });
    const annotations = ePoints[minIdx].price < 0
      ? [{ index: minIdx, value: ePoints[minIdx].price, label: `${fmt2(ePoints[minIdx].price)} — midday solar glut` }]
      : [];

    buildAxisChart({
      frame: document.getElementById("e-chart-frame"),
      xs: eXs,
      ys: eYs,
      color: "var(--electric)",
      softColor: "var(--electric-soft)",
      yFormat: (v, forTooltip) => (forTooltip ? `${fmt2(v)} EUR/MWh` : fmt1(v)),
      xTickLabel: (i) => dayFmt.format(new Date(ePoints[i].timestamp_utc)),
      annotations,
      baseline: 0,
    });

    // today's hourly bars
    const latestDate = eSummary.latest_date;
    const todaysPoints = ePoints.filter((p) => p.date === latestDate).sort((a, b) => a.hour - b.hour);
    buildBarChart({
      frame: document.getElementById("e-bars-frame"),
      values: todaysPoints.map((p) => p.price),
      labels: todaysPoints.map((p) => `${String(p.hour).padStart(2, "0")}:00`),
      colorFor: (v) => (v < 0 ? "var(--critical)" : "var(--electric)"),
    });
    document.getElementById("e-bars-caption").textContent = dayFmtFull.format(new Date(latestDate));

    fillTable(
      document.querySelector("#e-table tbody"),
      ePoints.map((p) => [`${p.date} ${String(p.hour).padStart(2, "0")}:00`, fmt2(p.price)])
    );

    // ===== gas section =====
    document.getElementById("stat-gas-close").textContent = fmt2(gSummary.latest_close);
    document.getElementById("stat-gas-change").textContent = (gSummary.change > 0 ? "+" : "") + fmt2(gSummary.change);
    document.getElementById("stat-gas-low").textContent = fmt2(gSummary.period_min);
    document.getElementById("stat-gas-high").textContent = fmt2(gSummary.period_max);

    buildCandleChart({ frame: document.getElementById("g-chart-frame"), points: gPoints });

    fillTable(
      document.querySelector("#g-table tbody"),
      gPoints.map((p) => [p.date, fmt2(p.open), fmt2(p.high), fmt2(p.low), fmt2(p.close), p.volume ?? "—"])
    );
  }

  main();
})();
