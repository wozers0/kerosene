// Small SVG charts for the admin dashboard: a line chart over time, columns,
// horizontal bars, a stacked bar and sparklines. Thin marks, hairline grid,
// a hover tooltip on every chart, and a table view as the readable twin.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const h = (tag, props = {}, children = []) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const c of [].concat(children)) if (c != null) n.append(c);
    return n;
  };

  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (a >= 1e4) return `${Math.round(n / 1e3)}K`;
    if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
    return String(Math.round(n));
  };
  // a clean axis top and step: 0 / 5 / 10 / 15 ... (or the first fitting step from `steps`)
  function niceScale(max, ticks = 4, steps = null) {
    if (!(max > 0)) return { top: steps ? steps[0] * ticks : ticks, step: steps ? steps[0] : 1 };
    const raw = max / ticks;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = steps?.find((s) => s >= raw) || [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    return { top: Math.ceil(max / step) * step, step };
  }

  // One tooltip per chart card; text only (labels come from Octane)
  function tooltip(card) {
    let tip = card.querySelector(":scope > .tip");
    if (!tip) card.append(tip = h("div", { className: "tip", role: "status", hidden: true }));
    return {
      show(x, y, value, label) {
        tip.replaceChildren(h("b", { textContent: value }), h("span", { textContent: label }));
        tip.hidden = false;
        const r = card.getBoundingClientRect();
        const w = tip.offsetWidth;
        tip.style.left = `${Math.min(Math.max(x - w / 2, 4), r.width - w - 4)}px`;
        tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 4)}px`;
      },
      hide() { tip.hidden = true; },
    };
  }

  // The chart's table twin
  function table(headers, rows) {
    const t = h("table", { className: "data-table" });
    t.append(h("thead", {}, h("tr", {}, headers.map((x) => h("th", { textContent: x })))));
    const body = h("tbody");
    for (const r of rows) body.append(h("tr", {}, r.map((x) => h("td", { textContent: String(x) }))));
    t.append(body);
    return t;
  }

  // ---------- line over time ----------
  // points: [[t, v], ...]; a gap longer than `gap` ms breaks the line
  function line(host, { points, format = compact, timeLabel, gap = 30 * 60 * 1000, height = 190 }) {
    host.replaceChildren();
    const card = host.closest(".card") || host;
    const W = Math.max(host.clientWidth, 260), H = height, L = 36, R = 44, T = 10, B = 24;
    if (points.length < 2) {
      host.append(h("p", { className: "empty", textContent: "Collecting data: the first points show up within 10 minutes of opening Octane." }));
      return;
    }
    const t0 = points[0][0], t1 = points[points.length - 1][0];
    const { top, step } = niceScale(Math.max(...points.map((p) => p[1])));
    const x = (t) => L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }));
      const lab = svgEl("text", { x: L - 6, y: y(v) + 3.5, class: "tick", "text-anchor": "end" });
      lab.textContent = format(v);
      svg.append(lab);
    }
    const maxTicks = Math.max(2, Math.min(7, Math.floor((W - L - R) / 80)));
    let ticks = [];
    if (t1 - t0 > 36 * 3600000) {
      // one label per day, at midnight (every few days on long ranges)
      const d = new Date(t0);
      d.setHours(24, 0, 0, 0);
      for (; d.getTime() <= t1; d.setDate(d.getDate() + 1)) ticks.push(d.getTime());
      const every = Math.ceil(ticks.length / maxTicks);
      ticks = ticks.filter((_, i) => i % every === 0);
    } else {
      for (let i = 0; i <= maxTicks; i++) ticks.push(t0 + ((t1 - t0) * i) / maxTicks);
    }
    for (const t of ticks) {
      const px = x(t);
      const anchor = px - L < 24 ? "start" : W - R - px < 24 ? "end" : "middle";
      const lab = svgEl("text", { x: px, y: H - 6, class: "tick", "text-anchor": anchor });
      lab.textContent = timeLabel(t, t1 - t0);
      svg.append(lab);
    }
    // segments split at gaps (the browser was closed)
    const segs = [[points[0]]];
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] - points[i - 1][0] > gap) segs.push([]);
      segs[segs.length - 1].push(points[i]);
    }
    for (const seg of segs) {
      const d = seg.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
      if (seg.length > 1) {
        svg.append(svgEl("path", { d: `${d}L${x(seg[seg.length - 1][0]).toFixed(1)},${y(0)}L${x(seg[0][0]).toFixed(1)},${y(0)}Z`, class: "area" }));
        svg.append(svgEl("path", { d, class: "line" }));
      } else {
        svg.append(svgEl("circle", { cx: x(seg[0][0]), cy: y(seg[0][1]), r: 2.5, class: "lone" }));
      }
    }
    const last = points[points.length - 1];
    svg.append(svgEl("circle", { cx: x(last[0]), cy: y(last[1]), r: 4, class: "dot" }));
    const endLab = svgEl("text", { x: x(last[0]) + 8, y: y(last[1]) + 4, class: "end-label" });
    endLab.textContent = format(last[1]);
    svg.append(endLab);
    // crosshair: snaps to the nearest point
    const cross = svgEl("line", { y1: T, y2: H - B, class: "cross", visibility: "hidden" });
    const hot = svgEl("circle", { r: 4, class: "dot", visibility: "hidden" });
    const hit = svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent", tabindex: 0 });
    svg.append(cross, hot, hit);
    const tip = tooltip(card);
    const showAt = (i) => {
      const p = points[i];
      cross.setAttribute("x1", x(p[0])); cross.setAttribute("x2", x(p[0]));
      cross.setAttribute("visibility", "visible");
      hot.setAttribute("cx", x(p[0])); hot.setAttribute("cy", y(p[1]));
      hot.setAttribute("visibility", "visible");
      const sr = svg.getBoundingClientRect(), cr = card.getBoundingClientRect();
      tip.show(sr.left - cr.left + x(p[0]), sr.top - cr.top + y(p[1]), format(p[1]), timeLabel(p[0], 0, true));
    };
    let focusI = points.length - 1;
    hit.addEventListener("pointermove", (e) => {
      const px = e.clientX - svg.getBoundingClientRect().left;
      const t = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - t) < Math.abs(points[best][0] - t)) best = i;
      showAt(focusI = best);
    });
    const hide = () => { cross.setAttribute("visibility", "hidden"); hot.setAttribute("visibility", "hidden"); tip.hide(); };
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => showAt(focusI));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") showAt(focusI = Math.max(0, focusI - 1));
      if (e.key === "ArrowRight") showAt(focusI = Math.min(points.length - 1, focusI + 1));
    });
    host.append(svg);
  }

  // ---------- columns ----------
  // rows: [{ label, value, title }]; labels: indexes to label on the caps
  // format: axis ticks; valueFormat: cap labels and tooltips
  function columns(host, { rows, format = compact, valueFormat = format, labelled = [], steps = null, height = 170 }) {
    host.replaceChildren();
    const card = host.closest(".card") || host;
    const W = Math.max(host.clientWidth, 260), H = height, L = 40, R = 8, T = 16, B = 22;
    const { top, step } = niceScale(Math.max(...rows.map((r) => r.value), 0), 4, steps);
    const band = (W - L - R) / rows.length;
    const bw = Math.min(24, band * 0.6);
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }));
      const lab = svgEl("text", { x: L - 6, y: y(v) + 3.5, class: "tick", "text-anchor": "end" });
      lab.textContent = format(v);
      svg.append(lab);
    }
    const tip = tooltip(card);
    rows.forEach((r, i) => {
      const cx = L + band * i + band / 2;
      const hgt = Math.max(0, y(0) - y(r.value));
      const rad = Math.min(4, hgt, bw / 2);
      if (hgt > 0) {
        // rounded top, square at the baseline
        const x0 = cx - bw / 2, x1 = cx + bw / 2, yt = y(r.value), yb = y(0);
        svg.append(svgEl("path", { class: "bar", d: `M${x0},${yb}V${yt + rad}Q${x0},${yt} ${x0 + rad},${yt}H${x1 - rad}Q${x1},${yt} ${x1},${yt + rad}V${yb}Z` }));
      }
      if (labelled.includes(i) && r.value > 0) {
        const lab = svgEl("text", { x: cx, y: y(r.value) - 5, class: "cap-label", "text-anchor": "middle" });
        lab.textContent = valueFormat(r.value);
        svg.append(lab);
      }
      const step2 = Math.ceil(rows.length / Math.max(1, Math.floor((W - L - R) / 46)));
      if (i % step2 === 0 || i === rows.length - 1) {
        const lab = svgEl("text", { x: cx, y: H - 6, class: "tick", "text-anchor": "middle" });
        lab.textContent = r.label;
        svg.append(lab);
      }
      const hit = svgEl("rect", { x: L + band * i, y: T, width: band, height: H - T - B, fill: "transparent", tabindex: 0 });
      const show = () => {
        const sr = svg.getBoundingClientRect(), cr = card.getBoundingClientRect();
        tip.show(sr.left - cr.left + cx, sr.top - cr.top + y(r.value), valueFormat(r.value), r.title || r.label);
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("pointerleave", () => tip.hide());
      hit.addEventListener("blur", () => tip.hide());
      svg.append(hit);
    });
    host.append(svg);
  }

  // ---------- horizontal bars ----------
  // rows: [{ label, value, sub, onClick }]; every bar carries its value at the tip
  function bars(host, { rows, format = compact, empty = "Nothing to show" }) {
    host.replaceChildren();
    if (!rows.length) {
      host.append(h("p", { className: "empty", textContent: empty }));
      return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    const list = h("ol", { className: "hbars" });
    for (const r of rows) {
      const fill = h("span", { className: "hbar-fill" });
      fill.style.width = `${Math.max(1.5, (r.value / max) * 100)}%`;
      const item = h(r.onClick ? "button" : "div", { className: "hbar", type: r.onClick ? "button" : undefined, title: `${r.label}: ${format(r.value)}${r.sub ? ` · ${r.sub}` : ""}` }, [
        h("span", { className: "hbar-label", textContent: r.label }),
        h("span", { className: "hbar-track" }, [fill, h("span", { className: "hbar-value", textContent: format(r.value) })]),
      ]);
      if (r.onClick) item.addEventListener("click", r.onClick);
      list.append(h("li", {}, item));
    }
    host.append(list);
  }

  // ---------- stacked bar (part of a whole) ----------
  // parts: [{ label, value, cls }]
  function stacked(host, { parts, total }) {
    host.replaceChildren();
    const sum = total ?? parts.reduce((n, p) => n + p.value, 0);
    const bar = h("div", { className: "stack", role: "img" });
    const legend = h("ul", { className: "legend" });
    for (const p of parts) {
      if (p.value > 0) {
        const seg = h("span", { className: `stack-seg ${p.cls}`, title: `${p.label}: ${p.value}` });
        seg.style.flexGrow = String(p.value);
        bar.append(seg);
      }
      legend.append(h("li", {}, [h("span", { className: `swatch ${p.cls}` }), h("b", { textContent: String(p.value) }), h("span", { textContent: ` ${p.label}` })]));
    }
    bar.setAttribute("aria-label", parts.map((p) => `${p.value} ${p.label}`).join(", ") + ` of ${sum}`);
    host.append(bar, legend);
  }

  // ---------- sparkline (stat tiles) ----------
  function spark(host, points) {
    host.replaceChildren();
    if (points.length < 2) return;
    const W = 76, H = 26;
    const t0 = points[0][0], t1 = points[points.length - 1][0];
    const max = Math.max(...points.map((p) => p[1]), 1);
    const x = (t) => ((t - t0) / Math.max(t1 - t0, 1)) * (W - 6) + 1;
    const y = (v) => 3 + (1 - v / max) * (H - 6);
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    svg.append(svgEl("path", { class: "spark", d: points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("") }));
    const last = points[points.length - 1];
    svg.append(svgEl("circle", { class: "spark-dot", cx: x(last[0]), cy: y(last[1]), r: 3 }));
    host.append(svg);
  }

  globalThis.KeroseneCharts = { line, columns, bars, stacked, spark, table, compact, niceScale };
})();
