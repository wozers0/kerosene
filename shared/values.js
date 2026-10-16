// Item values from Octomons (octomons.wtf, Octane's Rolimons) plus the trade
// maths shared by the popup's calculator and the on-site trade helpers.
//
// Octomons embeds every limited in its /catalog page as
//   var item_details = { "1:<id>": [ ...26 fields... ], ... }
// Field positions (from Octomons' own catalog12.js):
//   0 name · 5 best price · 8 RAP · 11 copies · 12 copies unavailable
//   15 acronym · 16 value (when the item has one) · 17 demand (0-4)
//   18 trend (0-4) · 19 projected · 21 rare · 22 value, falling back to RAP
//   23 thumbnail · 24 item type (1 asset, 2 bundle) · 25 id
(() => {
  const OCTOMONS = "https://octomons.wtf";
  const TTL = 10 * 60 * 1000;
  const FEE = 0.3; // Octane's trade/marketplace fee (marketplaceFee in its trades bundle)
  const DEMAND = ["Terrible", "Low", "Normal", "High", "Amazing"];
  const TREND = ["Lowering", "Unstable", "Stable", "Raising", "Fluctuating"];

  // Find `var item_details = {...}` and parse just that object literal.
  function extractItemDetails(html) {
    const at = html.indexOf("var item_details");
    if (at < 0) throw new Error("no item data on Octomons");
    const start = html.indexOf("{", at);
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < html.length; j++) {
      const ch = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return JSON.parse(html.slice(start, j + 1));
    }
    throw new Error("couldn't read Octomons item data");
  }

  function parseCatalog(html) {
    const items = {};
    for (const [key, d] of Object.entries(extractItemDetails(html))) {
      if (!Array.isArray(d)) continue;
      if (d[24] === 2) continue; // bundles can't be traded
      const id = Number(d[25] ?? key.split(":")[1]);
      if (!id) continue;
      const rap = Number(d[8]) || 0;
      const valued = Number(d[16]) > 0;
      items[id] = {
        id,
        name: String(d[0] ?? "").trim(),
        acronym: d[15] ? String(d[15]) : "",
        value: Number(d[22]) || (valued ? Number(d[16]) : rap),
        valued,
        rap,
        demand: Number.isInteger(d[17]) ? d[17] : -1,
        trend: Number.isInteger(d[18]) ? d[18] : -1,
        projected: Number(d[19]) > 0,
        rare: Number(d[21]) > 0,
        bestPrice: Number(d[5]) || 0,
        copies: d[11] == null ? null : Number(d[11]),
        thumb: d[23] ? String(d[23]) : "",
      };
    }
    return items;
  }

  async function fetchValues() {
    const res = await fetch(`${OCTOMONS}/catalog`, { credentials: "omit" });
    if (!res.ok) throw new Error(`Octomons HTTP ${res.status}`);
    return parseCatalog(await res.text());
  }

  const fmt = (n) => Math.round(n || 0).toLocaleString("en-US");
  const afterFee = (robux) => (robux > 0 ? Math.round(robux * (1 - FEE)) : 0);
  const demandLabel = (d) => DEMAND[d] || "";
  const trendLabel = (t) => TREND[t] || "";

  // items: [{ assetId, rap }]  (rap: what the page shows, used when Octomons
  // doesn't track the item). robuxNet: Robux in the offer after the fee.
  function offerTotals(items, robuxNet, values) {
    let value = 0, rap = 0, unknown = 0;
    const flags = { projected: [], lowDemand: [], rare: [] };
    for (const it of items) {
      const v = values[it.assetId];
      const r = v?.rap || it.rap || 0;
      rap += r;
      value += v ? v.value : r;
      if (!v) { unknown++; continue; }
      if (v.projected) flags.projected.push(v.name);
      if (v.demand >= 0 && v.demand <= 1) flags.lowDemand.push(v.name);
      if (v.rare) flags.rare.push(v.name);
    }
    const robux = Math.max(0, Math.round(robuxNet || 0));
    return { value: value + robux, rap: rap + robux, robux, count: items.length, unknown, flags };
  }

  function verdict(give, get) {
    const diff = get.value - give.value;
    const pct = give.value ? (diff / give.value) * 100 : get.value ? 100 : 0;
    const kind = !give.count && !get.count && !give.robux && !get.robux ? "empty"
      : Math.abs(pct) < 2 ? "fair" : diff > 0 ? "win" : "loss";
    return { diff, pct, kind };
  }

  function search(values, query, limit = 8) {
    const q = query.trim().toLowerCase();
    const all = Object.values(values);
    if (!q) return all.sort((a, b) => b.value - a.value).slice(0, limit);
    return all
      .map((v) => {
        const name = v.name.toLowerCase(), acr = v.acronym.toLowerCase();
        const score = acr === q ? 0 : name.startsWith(q) ? 1 : acr.startsWith(q) ? 2 : name.includes(q) ? 3 : -1;
        return [score, v];
      })
      .filter(([s]) => s >= 0)
      .sort((a, b) => a[0] - b[0] || b[1].value - a[1].value)
      .slice(0, limit)
      .map(([, v]) => v);
  }

  globalThis.KeroseneValues = {
    OCTOMONS, TTL, FEE, DEMAND, TREND,
    parseCatalog, fetchValues, fmt, afterFee, demandLabel, trendLabel, offerTotals, verdict, search,
  };
})();
