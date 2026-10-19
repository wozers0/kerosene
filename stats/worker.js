// Kerosene usage stats, a Cloudflare Worker.
//
// POST /v1/ping   one anonymous report a day from each install whose user
//                 said yes: a random install id, browser, OS, version and
//                 which settings are on. No Octane account, no IP is stored.
// POST /v1/forget  deletes an install's report (when its user says no).
// GET  /v1/stats  totals for dad's admin dashboard (needs the STATS_KEY).
// cron (daily)    saves the day's totals, so the dashboard can chart them.
//
// Storage: KV binding STATS. Each install is one key "i:<id>" whose metadata
// holds the report (so a key listing returns everything); it expires 40 days
// after the last report. Daily totals live under "h:<YYYY-MM-DD>".

const DAY = 86400000;
const KEEP_INSTALL = 40 * 86400; // seconds
const KEEP_HISTORY = 400 * 86400;

const BROWSERS = ["chrome", "brave", "edge", "opera", "firefox", "zen", "other"];
const SYSTEMS = ["windows", "mac", "linux", "chromeos", "android", "other"];
const BACKGROUNDS = /^(none|image|video|preset:[a-z0-9-]{1,20})$/;
const FONTS = ["theme", "preset", "google", "local", "file"];
const FEATURES = ["values", "sandbox", "playtime", "tradeAlerts", "friendAlerts", "syncFriends", "hideAds", "priceAlerts", "afford", "seasonal", "animatedBg", "themeFonts"];
const SLUG = /^[a-z0-9-]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

// The report as stored: short keys keep it inside KV's 1 KB metadata limit
export function cleanPing(p) {
  if (!p || typeof p !== "object" || !UUID.test(String(p.id))) return null;
  const features = {};
  for (const f of FEATURES) if (p.features?.[f] === true) features[f] = 1;
  return {
    id: String(p.id),
    rec: {
      b: pick(p.browser, BROWSERS, "other"),
      o: pick(p.os, SYSTEMS, "other"),
      v: VERSION.test(String(p.v)) ? String(p.v) : "?",
      t: SLUG.test(String(p.theme)) ? String(p.theme) : "?",
      g: BACKGROUNDS.test(String(p.bg)) ? String(p.bg) : "?",
      f: pick(p.font, FONTS, "theme"),
      c: SLUG.test(String(p.color)) ? String(p.color) : "?",
      p: p.perks === true ? 1 : 0,
      x: features,
    },
  };
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function listAll(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

// own keys only: a slug like "constructor" must count like any other
const count = (map, key) => { map[key] = (Object.hasOwn(map, key) ? map[key] : 0) + 1; };

// Totals over every install that reported in the last 30 days
export function aggregate(records, now) {
  const t = { at: now, active1: 0, active7: 0, active30: 0, new7: 0, browsers: {}, os: {}, versions: {}, themes: {}, backgrounds: {}, fonts: {}, colors: {}, perks: 0, features: {} };
  for (const r of records) {
    if (!r || now - r.seen > 30 * DAY) continue;
    t.active30++;
    if (now - r.seen <= 7 * DAY) t.active7++;
    if (now - r.seen <= DAY + 3600000) t.active1++;
    if (now - (r.first || r.seen) <= 7 * DAY) t.new7++;
    count(t.browsers, r.b);
    count(t.os, r.o);
    count(t.versions, r.v);
    count(t.themes, r.t);
    count(t.backgrounds, r.g.startsWith("preset:") ? r.g.slice(7) : r.g);
    count(t.fonts, r.f);
    count(t.colors, r.c);
    if (r.p) t.perks++;
    for (const f of Object.keys(r.x || {})) count(t.features, f);
  }
  return t;
}

async function ping(req, env, now) {
  const text = await req.text();
  if (text.length > 2048) return json({ error: "too big" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
  const clean = cleanPing(body);
  if (!clean) return json({ error: "bad report" }, 400);
  const key = `i:${clean.id}`;
  const old = await env.STATS.getWithMetadata(key);
  const prev = old?.metadata || null;
  const rec = { ...clean.rec, first: prev?.first || now, seen: now };
  // one write a day per install is plenty (and keeps inside KV's free writes)
  const same = prev && JSON.stringify({ ...prev, first: 0, seen: 0 }) === JSON.stringify({ ...rec, first: 0, seen: 0 });
  if (same && now - prev.seen < 20 * 3600000) return json({ ok: true, stored: false });
  await env.STATS.put(key, "", { metadata: rec, expirationTtl: KEEP_INSTALL });
  return json({ ok: true, stored: true });
}

async function forget(req, env) {
  let body;
  try { body = JSON.parse((await req.text()).slice(0, 512)); } catch { return json({ error: "bad json" }, 400); }
  if (!UUID.test(String(body?.id))) return json({ error: "bad id" }, 400);
  await env.STATS.delete(`i:${body.id}`);
  return json({ ok: true });
}

async function current(env, now) {
  const keys = await listAll(env.STATS, "i:");
  return aggregate(keys.map((k) => k.metadata), now);
}

async function stats(env, now) {
  const totals = await current(env, now);
  const hist = await listAll(env.STATS, "h:");
  totals.history = hist.map((k) => k.metadata).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1));
  return json(totals);
}

// The day's totals, small enough for KV metadata
async function snapshot(env, now) {
  const t = await current(env, now);
  const d = new Date(now).toISOString().slice(0, 10);
  const meta = { d, a1: t.active1, a7: t.active7, a30: t.active30, b: t.browsers };
  await env.STATS.put(`h:${d}`, "", { metadata: meta, expirationTtl: KEEP_HISTORY });
  return meta;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const now = Date.now();
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/v1/ping" && req.method === "POST") return ping(req, env, now);
    if (url.pathname === "/v1/forget" && req.method === "POST") return forget(req, env);
    if (url.pathname === "/v1/stats" && req.method === "GET") {
      const auth = req.headers.get("Authorization") || "";
      const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.STATS_KEY || !key || !timingSafeEqual(key, env.STATS_KEY)) return json({ error: "wrong key" }, 401);
      return stats(env, now);
    }
    if (url.pathname === "/") return json({ ok: true, service: "kerosene-stats" });
    return json({ error: "not found" }, 404);
  },
  async scheduled(_event, env) {
    await snapshot(env, Date.now());
  },
};
