// Item values and trade helpers on octane.wtf. Runs in every frame: the
// catalog item, trades and limiteds pages are /theme2020/ iframes holding
// the Roblox 2020 pages (AngularJS trades app, item page, limiteds list).
//
//  - value / demand badges on limited item cards
//  - Value + RAP totals on both sides of a trade, and a WIN / LOSS banner
//  - a value panel on catalog item pages
//  - total value on limiteds pages
(() => {
  if (window.__keroseneValues) return;
  window.__keroseneValues = true;

  const S = globalThis.KeroseneSettings;
  const V = globalThis.KeroseneValues;
  const CATALOG_RE = /\/catalog\/(\d+)/;
  const ITEM_PAGE_RE = /\/(?:theme2020\/)?catalog\/(\d+)/;

  let values = {};
  let enabled = true;
  let timer = null;

  // ---------- styles ----------
  const CSS = `
    .kero-val { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; line-height: 1; }
    .kero-pill {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 3px 5px; border-radius: 4px;
      font: 600 10.5px/1 'Gotham SSm', 'HCo Gotham SSm', 'Source Sans Pro', system-ui, sans-serif;
      color: #fff; background: #4b5563; white-space: nowrap;
    }
    .kero-pill.v { background: #2563eb; }
    .kero-pill.v.rap { background: #4b5563; }
    .kero-pill.d0 { background: #b91c1c; } .kero-pill.d1 { background: #c2410c; }
    .kero-pill.d2 { background: #64748b; } .kero-pill.d3 { background: #15803d; }
    .kero-pill.d4 { background: #7e22ce; }
    .kero-pill.proj { background: #d97706; } .kero-pill.rare { background: #a16207; }
    .kero-summary {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      margin: 8px 0 4px; font: 500 12px/1.3 'Gotham SSm', 'HCo Gotham SSm', system-ui, sans-serif;
    }
    .kero-summary .kero-tag { opacity: 0.7; font-size: 11px; }
    .kero-verdict {
      clear: both; margin: 10px 0; padding: 10px 12px; border-radius: 8px;
      color: #fff; background: #475569;
      font: 500 13px/1.4 'Gotham SSm', 'HCo Gotham SSm', system-ui, sans-serif;
    }
    .kero-verdict.win { background: linear-gradient(135deg, #15803d, #16a34a); }
    .kero-verdict.loss { background: linear-gradient(135deg, #b91c1c, #dc2626); }
    .kero-verdict.fair { background: linear-gradient(135deg, #475569, #64748b); }
    .kero-verdict b.big { font-size: 16px; margin-right: 6px; letter-spacing: 0.3px; }
    .kero-verdict .row { display: block; opacity: 0.92; font-size: 12px; margin-top: 3px; }
    .kero-verdict .warn { display: block; font-size: 11.5px; margin-top: 4px; }
    .kero-verdict .src { float: right; opacity: 0.7; font-size: 10.5px; }
    .kero-item-panel {
      clear: both; margin: 12px 0; padding: 12px 14px; border-radius: 8px;
      border: 1px solid rgba(127, 127, 127, 0.3); background: rgba(127, 127, 127, 0.08);
      font: 500 13px/1.5 'Gotham SSm', 'HCo Gotham SSm', system-ui, sans-serif;
    }
    .kero-item-panel h4 { margin: 0 0 8px; font-size: 14px; font-weight: 700; display: flex; flex-wrap: wrap; gap: 2px 10px; justify-content: space-between; align-items: center; }
    .kero-item-panel h4 a { font-size: 11px; font-weight: 500; }
    .kero-item-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 8px 14px; }
    .kero-item-grid b { overflow-wrap: anywhere; }
    .kero-item-grid span { display: block; font-size: 10.5px; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.4px; }
    .kero-item-grid b { font-size: 14px; }
    .kero-total-value .kero-pill { font-size: 13px; padding: 4px 8px; vertical-align: middle; }
  `;

  function ensureCss() {
    if (document.getElementById("kerosene-values-css")) return;
    const style = document.createElement("style");
    style.id = "kerosene-values-css";
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------- helpers ----------
  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };

  function assetIdOf(el) {
    for (const a of el.querySelectorAll('a[href*="/catalog/"]')) {
      const m = a.getAttribute("href").match(CATALOG_RE);
      if (m) return Number(m[1]);
    }
    return null;
  }

  function rapOf(el) {
    const t = el.querySelector(".item-card-price .text-robux, .item-card-price .text-robux-tile, .item-value .text-robux, .text-robux, .text-robux-tile");
    return t ? Number(t.textContent.replace(/[^\d]/g, "")) || 0 : 0;
  }

  function valueBadges(v) {
    const wrap = h("div", "kero-val");
    wrap.title = v.valued ? `Octomons value ${V.fmt(v.value)}` : `No Octomons value yet; RAP ${V.fmt(v.rap)}`;
    wrap.append(h("span", `kero-pill v${v.valued ? "" : " rap"}`, `${v.valued ? "V" : "R"} ${V.fmt(v.value)}`));
    if (v.demand >= 0) wrap.append(h("span", `kero-pill d${v.demand}`, V.demandLabel(v.demand)));
    if (v.projected) wrap.append(h("span", "kero-pill proj", "⚠ Projected"));
    if (v.rare) wrap.append(h("span", "kero-pill rare", "★ Rare"));
    return wrap;
  }

  // ---------- item cards ----------
  function decorateCards() {
    const cards = document.querySelectorAll(".item-card-container, .trade-request-item[data-userassetid]");
    for (const card of cards) {
      const id = assetIdOf(card);
      const v = id && values[id];
      const existing = card.querySelector(":scope > .kero-val, :scope .kero-val");
      if (existing && existing.dataset.for === String(id)) continue;
      existing?.remove();
      // nothing to add beyond the RAP the card already shows
      if (!v || (!v.valued && v.demand < 0 && !v.projected && !v.rare)) continue;
      const badges = valueBadges(v);
      badges.dataset.for = String(id);
      const anchor = card.querySelector(".item-card-price, .item-value");
      if (anchor) anchor.after(badges);
      else (card.querySelector(".item-card-caption") || card).append(badges);
    }
  }

  // ---------- trades ----------
  function offerItems(offer) {
    const els = offer.querySelectorAll(".trade-item-card .item-card-container, .trade-request-item[data-userassetid]");
    return [...els].map((el) => ({ assetId: assetIdOf(el), rap: rapOf(el) })).filter((i) => i.assetId);
  }

  function offerRobuxNet(offer) {
    // trade window: raw Robux typed into the offer
    const input = offer.querySelector('input[name="robux"]');
    if (input) return V.afterFee(Number(input.value.replace(/[^\d]/g, "")) || 0);
    // trade details: the "Robux offered (after fee)" line, when shown
    for (const line of offer.querySelectorAll(".robux-line")) {
      if (line.classList.contains("ng-hide")) continue;
      const label = line.querySelector(".text-label.robux-line-value");
      if (label) return Number(label.textContent.replace(/[^\d]/g, "")) || 0;
    }
    return 0;
  }

  function summaryFor(offer, totals) {
    let el = offer.querySelector(":scope > .kero-summary");
    const sig = `${totals.value}:${totals.rap}:${totals.unknown}`;
    if (el?.dataset.sig === sig) return;
    if (!el) {
      el = h("div", "kero-summary");
      offer.append(el);
    }
    el.dataset.sig = sig;
    el.replaceChildren(
      h("span", "kero-pill v", `Value ${V.fmt(totals.value)}`),
      h("span", "kero-pill v rap", `RAP ${V.fmt(totals.rap)}`),
    );
    if (totals.unknown) el.append(h("span", "kero-tag", `${totals.unknown} not on Octomons (using RAP)`));
  }

  function renderVerdict(host, before, give, get) {
    let el = host.querySelector(":scope > .kero-verdict");
    const vd = V.verdict(give, get);
    if (vd.kind === "empty") { el?.remove(); return; }
    if (!el) el = h("div", "kero-verdict");
    if (before) { if (el.nextSibling !== before) host.insertBefore(el, before); }
    else if (el.parentNode !== host) host.prepend(el);

    const sig = `${give.value}:${give.rap}:${get.value}:${get.rap}:${give.flags.rare}:${get.flags.projected}:${get.flags.lowDemand}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.className = `kero-verdict ${vd.kind}`;
    const sign = vd.diff > 0 ? "+" : vd.diff < 0 ? "−" : "±";
    const pct = Number.isFinite(vd.pct) ? ` (${sign}${Math.abs(vd.pct).toFixed(1)}%)` : "";
    el.replaceChildren(
      h("span", "src", "Kerosene · Octomons values"),
      h("b", "big", vd.kind === "win" ? "WIN" : vd.kind === "loss" ? "LOSS" : "FAIR"),
      document.createTextNode(`${sign}${V.fmt(Math.abs(vd.diff))} value${pct}`),
      h("span", "row", `You give: value ${V.fmt(give.value)} · RAP ${V.fmt(give.rap)}  →  You get: value ${V.fmt(get.value)} · RAP ${V.fmt(get.rap)}`),
    );
    const warns = [];
    if (get.flags.projected.length) warns.push(`⚠ Projected (inflated RAP): ${get.flags.projected.join(", ")}`);
    if (get.flags.lowDemand.length) warns.push(`⚠ Low demand: ${get.flags.lowDemand.join(", ")}`);
    if (give.flags.rare.length) warns.push(`★ You're giving rare: ${give.flags.rare.join(", ")}`);
    for (const w of warns) el.append(h("span", "warn", w));
  }

  function decorateTrades() {
    // existing trade (inbound / outbound / completed): your offer is listed first
    const detail = document.querySelector(".trades-list-detail");
    if (detail) {
      const offers = [...detail.querySelectorAll(".trade-list-detail-offer")];
      if (offers.length === 2) {
        const [give, get] = offers.map((o) => {
          const t = V.offerTotals(offerItems(o), offerRobuxNet(o), values);
          summaryFor(o, t);
          return t;
        });
        renderVerdict(offers[0].parentNode, offers[0], give, get);
      }
    }
    // trade window (new trade / counter): your offer first, then theirs
    const windowOffers = document.querySelector(".trade-request-window-offers");
    if (windowOffers) {
      const offers = [...windowOffers.querySelectorAll(".trade-request-window-offer")];
      if (offers.length === 2) {
        const [give, get] = offers.map((o) => {
          const t = V.offerTotals(offerItems(o), offerRobuxNet(o), values);
          summaryFor(o, t);
          return t;
        });
        renderVerdict(windowOffers, windowOffers.querySelector(":scope > button, :scope > .btn-cta-md"), give, get);
      }
    }
  }

  // ---------- catalog item page ----------
  function decorateItemPage() {
    const m = location.pathname.match(ITEM_PAGE_RE);
    const details = document.getElementById("item-details");
    if (!m || !details) return;
    const v = values[Number(m[1])];
    let panel = details.querySelector(":scope > .kero-item-panel");
    if (!v) { panel?.remove(); return; }
    if (panel?.dataset.sig === `${v.id}:${v.value}:${v.rap}:${v.demand}:${v.trend}`) return;
    panel?.remove();
    panel = h("div", "kero-item-panel");
    panel.dataset.sig = `${v.id}:${v.value}:${v.rap}:${v.demand}:${v.trend}`;

    const head = h("h4", null, "Kerosene · item value");
    const link = h("a", "text-link", "View on Octomons ↗");
    link.href = `${V.OCTOMONS}/item/${v.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    head.append(link);

    const grid = h("div", "kero-item-grid");
    const cell = (label, value) => {
      const c = h("div");
      c.append(h("span", null, label), h("b", null, value));
      return c;
    };
    grid.append(
      cell("Value", v.valued ? V.fmt(v.value) : "—"),
      cell("RAP", V.fmt(v.rap)),
      cell("Best price", v.bestPrice ? V.fmt(v.bestPrice) : "—"),
      cell("Demand", V.demandLabel(v.demand) || "—"),
      cell("Trend", V.trendLabel(v.trend) || "—"),
      cell("Copies", v.copies == null ? "—" : V.fmt(v.copies)),
    );
    panel.append(head, grid);
    const flags = h("div", "kero-val");
    if (v.projected) flags.append(h("span", "kero-pill proj", "⚠ Projected — RAP is inflated"));
    if (v.rare) flags.append(h("span", "kero-pill rare", "★ Rare"));
    if (!v.valued) flags.append(h("span", "kero-pill v rap", "No value yet — trades at RAP"));
    if (flags.childElementCount) panel.append(flags);

    const price = details.querySelector(":scope > .price-container");
    if (price) price.after(panel);
    else details.prepend(panel);
  }

  // ---------- limiteds page: total value next to Octane's "Total RAP" ----------
  function decorateLimiteds() {
    if (!/\/limiteds/.test(location.pathname)) return;
    const totalRap = [...document.querySelectorAll("h3")].find((el) => /Total RAP/i.test(el.textContent));
    if (!totalRap) return;
    const cards = document.querySelectorAll(".item-cards-embed .item-card-container");
    let value = 0, valued = 0;
    for (const c of cards) {
      const v = values[assetIdOf(c)];
      value += v ? v.value : rapOf(c);
      if (v?.valued) valued++;
    }
    let el = totalRap.nextElementSibling?.classList.contains("kero-total-value") ? totalRap.nextElementSibling : null;
    const sig = `${value}:${valued}:${cards.length}`;
    if (el?.dataset.sig === sig) return;
    if (!el) {
      el = h("h3", "kero-total-value");
      totalRap.after(el);
    }
    el.dataset.sig = sig;
    el.replaceChildren(
      document.createTextNode("Total value "),
      h("span", "kero-pill v", V.fmt(value)),
      h("span", "kero-pill v rap", `${valued} of ${cards.length} valued on Octomons`),
    );
  }

  // ---------- run ----------
  function clearAll() {
    for (const el of document.querySelectorAll(".kero-val, .kero-summary, .kero-verdict, .kero-item-panel, .kero-total-value")) el.remove();
  }

  function run() {
    timer = null;
    if (!enabled) { clearAll(); return; }
    ensureCss();
    decorateCards();
    decorateTrades();
    decorateItemPage();
    decorateLimiteds();
  }
  const schedule = () => { timer ??= setTimeout(run, 150); };

  async function init() {
    const settings = await S.load();
    enabled = settings.enabled && settings.showValues;
    const res = await ext.runtime.sendMessage({ type: "get-values" }).catch(() => null);
    values = res?.items || {};

    const start = () => {
      run();
      const OURS = ".kero-val, .kero-summary, .kero-verdict, .kero-item-panel, .kero-total-value";
      const ours = (n) => {
        const el = n.nodeType === 1 ? n : n.parentElement;
        return Boolean(el?.closest?.(OURS));
      };
      new MutationObserver((muts) => {
        // ignore changes made by (or inside) our own badges and panels
        const foreign = muts.some((m) => {
          if (ours(m.target)) return false;
          if (m.type !== "childList") return true;
          return [...m.addedNodes, ...m.removedNodes].some((n) => !(n.nodeType === 1 && n.matches?.(OURS)));
        });
        if (foreign) schedule();
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      document.addEventListener("input", schedule, true);
      document.addEventListener("click", schedule, true);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();

    ext.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local") return;
      if (changes.itemValues) values = changes.itemValues.newValue || {};
      if (changes.enabled || changes.showValues) {
        const s = await S.load();
        enabled = s.enabled && s.showValues;
      }
      if (changes.itemValues || changes.enabled || changes.showValues) schedule();
    });
  }

  init();
})();
