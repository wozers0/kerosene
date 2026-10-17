// Background: keeps the friends list fresh (your Octane friends plus any
// extra watched users), shows the online count on the toolbar badge, sends
// online / joined-a-game alerts, caches Octomons item values, and fetches
// cross-origin stylesheets for the theme engine.
// Chrome/Brave run this as a service worker; Firefox/Zen load the shared
// scripts first via manifest "background.scripts".
if (typeof importScripts === "function") {
  importScripts("shared/compat.js", "shared/settings.js", "shared/values.js");
}

const S = globalThis.KeroseneSettings;
const V = globalThis.KeroseneValues;
const ALARM = "kerosene-friends";
const AVATAR_TTL = 60 * 60 * 1000;

function ensureAlarm() {
  ext.alarms.get(ALARM, (a) => {
    if (!a) ext.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
  });
}

function notify(id, title, message) {
  ext.notifications.create(`kerosene-${id}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 0,
  });
}

let polling = null;
function pollFriends() {
  // one poll at a time; the popup and the alarm can both ask
  polling ??= doPoll().finally(() => { polling = null; });
  return polling;
}

async function doPoll() {
  const settings = await S.load();
  const { viewer = null, friendStatus = {}, avatars = {}, avatarsAt = 0 } =
    await ext.storage.local.get(["viewer", "friendStatus", "avatars", "avatarsAt"]);
  const next = {};
  let syncError = null;

  if (settings.syncFriends && viewer?.id) {
    try {
      for (const f of await S.fetchFriends(viewer.id)) next[f.id] = f;
    } catch (err) {
      syncError = String(err.message || err);
    }
  }

  await Promise.all(settings.friends.filter((id) => !next[id]).map(async (id) => {
    try {
      next[id] = await S.fetchUser(id);
    } catch (err) {
      next[id] = { ...(friendStatus[id] || { id, name: `#${id}`, displayName: `#${id}`, status: "offline" }), error: String(err.message || err) };
    }
  }));

  // avatars: refresh hourly, and fetch any we don't have yet
  const ids = Object.keys(next).map(Number);
  const stale = Date.now() - avatarsAt > AVATAR_TTL;
  const missing = stale ? ids : ids.filter((id) => !avatars[id]);
  let avatarMap = avatars;
  if (missing.length) {
    avatarMap = { ...avatars, ...(await S.fetchHeadshots(missing)) };
  }

  if (settings.enabled) {
    for (const f of Object.values(next)) {
      const prev = friendStatus[f.id];
      if (!prev || prev.error || f.error) continue; // first sighting: no alert
      const name = f.displayName || f.name;
      if (settings.notifyGames && f.status === "ingame" && (prev.status !== "ingame" || prev.placeId !== f.placeId)) {
        notify(f.placeId ? `game-${f.placeId}` : `user-${f.id}`, `${name} is playing`, f.location);
      } else if (settings.notifyOnline && prev.status === "offline" && f.status !== "offline") {
        notify(`user-${f.id}`, `${name} is online`, "Your Octane friend just came online.");
      }
    }
  }

  const checked = Date.now();
  await ext.storage.local.set({
    friendStatus: next,
    friendsMeta: { checked, syncError, synced: Boolean(settings.syncFriends && viewer?.id) },
    avatars: avatarMap,
    ...(stale && missing.length ? { avatarsAt: checked } : {}),
  });

  const online = Object.values(next).filter((f) => f.status !== "offline").length;
  await ext.action.setBadgeBackgroundColor({ color: "#4fa3e0" });
  await ext.action.setBadgeText({ text: settings.enabled && online ? String(online) : "" });
  return next;
}

// ---------- item values (Octomons) ----------
let valuesLoading = null;
async function getValues(force = false) {
  const { itemValues = null, itemValuesAt = 0 } = await ext.storage.local.get(["itemValues", "itemValuesAt"]);
  if (!force && itemValues && Date.now() - itemValuesAt < V.TTL) {
    return { items: itemValues, updated: itemValuesAt };
  }
  valuesLoading ??= V.fetchValues()
    .then(async (items) => {
      const updated = Date.now();
      await ext.storage.local.set({ itemValues: items, itemValuesAt: updated, itemValuesError: null });
      return { items, updated };
    })
    .catch(async (err) => {
      const error = String(err.message || err);
      await ext.storage.local.set({ itemValuesError: error });
      return { items: itemValues || {}, updated: itemValuesAt, error };
    })
    .finally(() => { valuesLoading = null; });
  return valuesLoading;
}

// ---------- Supa Games perks ----------
// Membership of the Supa Games group unlocks themes, backgrounds, hide ads,
// price alerts and "can I afford it" alerts. Checked every 30 minutes, when
// the signed-in user changes, and when the popup asks.
let accessCheck = null;
function checkAccess(force = false) {
  accessCheck ??= (async () => {
    const { viewer = null, groupAccess = null } = await ext.storage.local.get(["viewer", "groupAccess"]);
    if (!viewer?.id) return groupAccess;
    const fresh = groupAccess?.userId === viewer.id && Date.now() - groupAccess.checkedAt < S.ACCESS_TTL;
    if (fresh && !force) return groupAccess;
    try {
      const next = { userId: viewer.id, member: await S.fetchGroupMember(viewer.id), checkedAt: Date.now() };
      if (next.member !== groupAccess?.member || next.userId !== groupAccess?.userId || Date.now() - (groupAccess?.checkedAt || 0) > 5 * 60 * 1000) {
        await ext.storage.local.set({ groupAccess: next });
      }
      return next;
    } catch {
      return groupAccess; // offline / rate limited: keep what we knew
    }
  })().finally(() => { accessCheck = null; });
  return accessCheck;
}

// ---------- trade alerts (everyone) ----------
const TRADE_SEEN_MAX = 300;
async function pollTrades(settings, viewer) {
  if (!settings.enabled || !settings.notifyTrades || !viewer?.id) return;
  let list;
  try {
    list = await S.fetchTrades("Inbound", 25);
  } catch {
    return; // signed out, or Octane is busy
  }
  const { tradeSeen = null } = await ext.storage.local.get("tradeSeen");
  const ids = list.map((t) => t.id);
  // first look (or another account): remember what's there, no alerts
  if (!tradeSeen || tradeSeen.userId !== viewer.id) {
    await ext.storage.local.set({ tradeSeen: { userId: viewer.id, ids } });
    return;
  }
  const seen = new Set(tradeSeen.ids);
  const fresh = list.filter((t) => !seen.has(t.id) && t.isActive !== false);
  if (!fresh.length) return;
  await ext.storage.local.set({ tradeSeen: { userId: viewer.id, ids: [...ids, ...tradeSeen.ids.filter((id) => !ids.includes(id))].slice(0, TRADE_SEEN_MAX) } });
  const { items: values = {} } = await getValues();
  for (const t of fresh.slice(0, 5)) {
    const from = t.user?.displayName || t.user?.name || "someone";
    try {
      const d = await S.fetchTrade(t.id);
      const offers = d.offers || [];
      const mine = offers.find((o) => o.user?.id === viewer.id) || offers[0];
      const theirs = offers.find((o) => o !== mine) || offers[1];
      const side = (o) => V.offerTotals((o?.userAssets || []).map((a) => ({ assetId: a.assetId, rap: a.recentAveragePrice || 0 })), V.afterFee(o?.robux || 0), values);
      const give = side(mine), get = side(theirs);
      const v = V.verdict(give, get);
      const word = { win: "WIN", loss: "LOSS", fair: "FAIR" }[v.kind] || "New trade";
      const sign = v.diff > 0 ? "+" : v.diff < 0 ? "−" : "±";
      notify(`trade-${t.id}`, `${word}: trade from ${from}`,
        `You give ${V.fmt(give.value)} · you get ${V.fmt(get.value)} (${sign}${V.fmt(Math.abs(v.diff))} value)`);
    } catch {
      notify(`trade-${t.id}`, `New trade from ${from}`, "Open your trades to see it.");
    }
  }
}

// ---------- price-drop alerts (Supa Games) ----------
let lastPriceCheck = 0;
async function pollPriceAlerts(settings, viewer) {
  if (!settings.enabled || !settings.perks || !settings.priceAlerts.length) return;
  if (Date.now() - lastPriceCheck < 2 * 60 * 1000) return;
  lastPriceCheck = Date.now();
  const { items: values = {} } = await getValues();
  const alerts = settings.priceAlerts.slice(0, 20).map((a) => ({ ...a }));
  let changed = false;
  for (const a of alerts) {
    let best;
    try {
      best = await S.fetchLowestResale(a.assetId, viewer?.id);
    } catch {
      continue;
    }
    await new Promise((r) => setTimeout(r, 400)); // gentle on Octane
    a.lowest = best?.price ?? null;
    a.checkedAt = Date.now();
    changed = true;
    if (!best) continue;
    const value = values[a.assetId]?.value || 0;
    const underMax = a.max > 0 && best.price <= a.max;
    const underValue = a.belowValue && value > 0 && best.price < value;
    if (!underMax && !underValue) continue;
    if (a.last?.userAssetId === best.userAssetId && a.last?.price === best.price) continue; // already told you
    a.last = { userAssetId: best.userAssetId, price: best.price, at: Date.now() };
    const why = underMax ? `your alert: ${V.fmt(a.max)} or less` : `below its value of ${V.fmt(value)}`;
    notify(`item-${a.assetId}`, `${a.name} for ${V.fmt(best.price)} Robux`, `Listed by ${best.seller || "a reseller"} (${why}).`);
  }
  if (changed) {
    // keep alerts the popup added or removed meanwhile
    const { priceAlerts: now = [] } = await ext.storage.local.get("priceAlerts");
    const byId = new Map(alerts.map((a) => [a.assetId, a]));
    await ext.storage.local.set({ priceAlerts: now.map((a) => (byId.has(a.assetId) ? { ...a, ...pick(byId.get(a.assetId), ["lowest", "checkedAt", "last"]) } : a)) });
  }
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

// ---------- "can I afford it" alerts (Supa Games) ----------
let lastAffordCheck = 0;
let ownedCache = null; // { userId, ids: Set, at }
async function pollAfford(settings, viewer) {
  if (!settings.enabled || !settings.perks || !settings.notifyAfford || !viewer?.id) return;
  if (Date.now() - lastAffordCheck < 5 * 60 * 1000) return;
  lastAffordCheck = Date.now();
  const { sandboxOutfits = [], affordState = {} } = await ext.storage.local.get(["sandboxOutfits", "affordState"]);
  if (!sandboxOutfits.length) return;
  let balance;
  try {
    balance = await S.fetchBalance(viewer.id);
  } catch {
    return; // signed out
  }
  if (!ownedCache || ownedCache.userId !== viewer.id || Date.now() - ownedCache.at > 15 * 60 * 1000) {
    try {
      ownedCache = { userId: viewer.id, ids: await S.fetchOwnedAssets(viewer.id), at: Date.now() };
    } catch { /* keep the last list */ }
  }
  const owned = ownedCache?.ids || new Set();
  const next = {};
  for (const o of sandboxOutfits) {
    let cost = 0, toBuy = 0;
    for (const it of o.items || []) {
      if (owned.has(it.id) || it.price?.robux == null) continue;
      cost += it.price.robux;
      toBuy++;
    }
    const state = !toBuy ? "none" : cost <= balance.robux ? "ok" : "short";
    next[o.id] = state;
    if (state === "ok" && affordState[o.id] === "short") {
      notify(`outfit-${o.id}`, `You can afford "${o.name}" now`, `${V.fmt(cost)} Robux left to buy and you have ${V.fmt(balance.robux)}.`);
    }
  }
  await ext.storage.local.set({ affordState: next });
}

async function pollAlerts() {
  const { viewer = null } = await ext.storage.local.get("viewer");
  await checkAccess();
  const settings = await S.load(); // after the check: perks may have just changed
  await pollTrades(settings, viewer);
  await pollPriceAlerts(settings, viewer);
  await pollAfford(settings, viewer);
}

let alerting = null;
function onTick() {
  pollFriends();
  getValues(); // refreshes when the cache is older than V.TTL
  alerting ??= pollAlerts().catch(() => {}).finally(() => { alerting = null; });
}

// ---------- updates ----------
const IS_FIREFOX = typeof globalThis.browser?.runtime?.getBrowserInfo === "function";
const UPDATER_PAGE = "update/update.html";

// Firefox's own daily check found a signed update: apply it now instead of
// waiting for a browser restart.
ext.runtime.onUpdateAvailable?.addListener(() => ext.runtime.reload());

// How this copy can update itself:
//   firefox  signed install in Firefox/Zen: Kerosene downloads the signed .xpi
//            and hands it to Firefox's installer (Firefox asks the user twice)
//   store    installed from a web store: the browser fetches it
//   manual   loaded unpacked / temporarily: the user replaces the files
async function updateKind() {
  const self = await ext.management?.getSelf?.().catch(() => null);
  if (!self || self.installType === "development") return "manual";
  if (IS_FIREFOX) return "firefox";
  return typeof ext.runtime.requestUpdateCheck === "function" ? "store" : "manual";
}

// The signed .xpi of a release, downloaded and kept as an installable blob.
// It lives here rather than in the popup, which closes as soon as Firefox's
// installer window takes focus.
let staged = null; // { version, url, size, at }

async function sha256(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function download(url, onProgress) {
  const res = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body?.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

async function stageUpdate(info, onProgress) {
  if (staged && staged.version === info.version && Date.now() - staged.at < 30 * 60 * 1000) return staged;
  // the raw copy in the repo is the same signed file as the release asset, and
  // raw.githubusercontent.com allows extension fetches (release downloads don't)
  const base = info.firefox_xpi || `https://raw.githubusercontent.com/${S.REPO}/main/dist/kerosene-firefox.xpi`;
  let buf;
  for (let attempt = 0; attempt < 2; attempt++) {
    // a fresh query string per try gets past a stale CDN copy
    buf = await download(`${base}?v=${encodeURIComponent(info.version)}${attempt ? `&t=${Date.now()}` : ""}`, (l, t) => onProgress?.(l, t || info.firefox_size || 0));
    if (!info.firefox_sha256 || (await sha256(buf)) === info.firefox_sha256) break;
    if (attempt) throw new Error("the download didn't match the release; try again in a minute");
  }
  if (staged?.url) URL.revokeObjectURL(staged.url);
  staged = {
    version: info.version,
    url: URL.createObjectURL(new Blob([buf], { type: "application/x-xpinstall" })),
    size: buf.byteLength,
    at: Date.now(),
  };
  return staged;
}

// The popup opens the blob in a small window (a click is needed for Firefox
// to accept it). That window starts blank; once Firefox has picked up the
// file, it gets Kerosene's updater page instead.
let installer = null; // { tabId, windowId }
let expectInstaller = 0;
let pending = null; // what the new version needs to finish the job (also in storage)

// Firefox briefly refuses storage writes while its installer picks up the
// file, so keep trying for a few seconds.
async function persistPending() {
  for (let i = 0; i < 12; i++) {
    try {
      await (pending ? ext.storage.local.set({ pendingUpdate: pending }) : ext.storage.local.remove("pendingUpdate"));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

ext.tabs.onCreated.addListener(async (tab) => {
  if (!staged || Date.now() - expectInstaller > 20000) return;
  pending = pending || (await ext.storage.local.get("pendingUpdate").catch(() => ({}))).pendingUpdate || null;
  const win = await ext.windows.get(tab.windowId).catch(() => null);
  if (win?.type !== "popup") return; // not ours (e.g. a new tab the user opened)
  expectInstaller = 0;
  installer = { tabId: tab.id, windowId: tab.windowId };
  if (pending) { pending.windowId = tab.windowId; persistPending(); }
  const q = new URLSearchParams({ from: ext.runtime.getManifest().version, to: staged.version });
  setTimeout(() => ext.tabs.update(tab.id, { url: ext.runtime.getURL(`${UPDATER_PAGE}?${q}`) }).catch(() => {}), 700);
});

// Closing the installer window without updating: put the page back
ext.windows.onRemoved.addListener(async (windowId) => {
  if (installer?.windowId !== windowId) return;
  installer = null;
  const was = pending;
  pending = null;
  persistPending();
  if (was?.tabId != null) ext.tabs.sendMessage(was.tabId, { type: "kerosene-update-screen", state: "hide" }).catch(() => {});
});

// The popup talks to the updater over a port so it can show download progress
ext.runtime.onConnect.addListener((port) => {
  if (port.name !== "kerosene-update") return;
  port.onMessage.addListener(async (msg) => {
    const send = (m) => { try { port.postMessage(m); } catch { /* popup closed */ } };
    if (msg?.type === "kind") return send({ type: "kind", kind: await updateKind() });
    if (msg?.type === "stage") {
      // remember who asked (before Firefox's installer gets busy with storage)
      const o = msg.origin || {};
      pending = {
        from: ext.runtime.getManifest().version, to: msg.info.version, at: Date.now(),
        // only Octane pages (where Kerosene's page script runs) answer this tab's messages
        tabId: o.tabId ?? null,
        originWindowId: o.windowId ?? null,
      };
      persistPending();
      try {
        const s = await stageUpdate(msg.info, (loaded, total) => send({ type: "progress", loaded, total }));
        expectInstaller = Date.now();
        send({ type: "staged", url: s.url, size: s.size });
      } catch (err) {
        send({ type: "error", error: String(err?.message || err) });
      }
    }
    if (msg?.type === "opening") {
      expectInstaller = Date.now();
      // the page you're on turns into Kerosene's loading screen meanwhile
      if (pending?.tabId != null) {
        ext.tabs.sendMessage(pending.tabId, { type: "kerosene-update-screen", state: "installing", from: pending.from, to: pending.to }).catch(() => {});
      }
    }
    if (msg?.type === "store") {
      const res = await ext.runtime.requestUpdateCheck();
      send({ type: "store", status: res?.status || res?.[0] || res }); // "update_available" -> onUpdateAvailable reloads us
    }
  });
});

// After an update: tidy up, refresh open Octane tabs so they run the new
// version, and (when the user started it) reopen the popup for the reveal.
async function afterUpdate(previousVersion) {
  const to = ext.runtime.getManifest().version;
  const { pendingUpdate } = await ext.storage.local.get("pendingUpdate").catch(() => ({}));
  const asked = Boolean(pendingUpdate && pendingUpdate.to === to && Date.now() - pendingUpdate.at < 30 * 60 * 1000);
  for (let i = 0; i < 10; i++) {
    try {
      await ext.storage.local.set({ justUpdated: { from: previousVersion, to, at: Date.now(), asked } });
      await ext.storage.local.remove("pendingUpdate");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (asked && pendingUpdate.windowId != null) await ext.windows.remove(pendingUpdate.windowId).catch(() => {});
  const tabs = await ext.tabs.query({ url: ["https://octane.wtf/*", "https://*.octane.wtf/*"] }).catch(() => []);
  for (const t of tabs) ext.tabs.reload(t.id).catch(() => {});
  if (asked) {
    if (pendingUpdate.originWindowId != null) await ext.windows.update(pendingUpdate.originWindowId, { focused: true }).catch(() => {});
    setTimeout(() => { ext.action?.openPopup?.()?.catch?.(() => {}); }, 400);
  }
}

ext.runtime.onInstalled.addListener((details) => {
  ensureAlarm();
  onTick();
  if (details?.reason === "update") afterUpdate(details.previousVersion);
});
ext.runtime.onStartup.addListener(() => { ensureAlarm(); onTick(); });
ext.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) onTick(); });

// a new signed-in user (or a settings change) should refresh straight away
ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.viewer || changes.syncFriends || changes.friends)) pollFriends();
  if (area === "local" && changes.viewer && changes.viewer.newValue?.id !== changes.viewer.oldValue?.id) checkAccess(true);
});

ext.notifications.onClicked.addListener((nid) => {
  const m = nid.match(/^kerosene-(game|user|trade|item|outfit)-([\w]+)-/);
  const urls = {
    game: (id) => `${S.SITE}/games/${id}`,
    user: (id) => `${S.SITE}/users/${id}/profile`,
    trade: () => `${S.SITE}/trades`,
    item: (id) => `${S.SITE}/catalog/${id}/item`,
    outfit: () => `${S.SITE}/my/avatar`,
  };
  if (m) ext.tabs.create({ url: urls[m[1]](m[2]) });
  ext.notifications.clear(nid);
});

ext.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "refresh-friends") {
    pollFriends().then(reply, () => reply(null));
    return true;
  }
  if (msg?.type === "check-access") {
    checkAccess(Boolean(msg.force)).then(reply, () => reply(null));
    return true;
  }
  if (msg?.type === "update-staged") {
    reply(staged ? { url: staged.url, version: staged.version } : null);
    return false;
  }
  if (msg?.type === "update-restage") {
    stageUpdate(msg.info).then((s) => reply({ url: s.url, version: s.version }), (err) => reply({ error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "get-values") {
    getValues(Boolean(msg.force)).then(reply, (err) => reply({ items: {}, updated: 0, error: String(err) }));
    return true;
  }
  // Content scripts can't read cross-origin stylesheets; with host access the
  // service worker can fetch their text so themes can recolour them too.
  if (msg?.type === "fetch-css" && /^https?:\/\//.test(msg.url)) {
    fetch(msg.url, { credentials: "omit" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => reply({ text }), (err) => reply({ error: String(err.message || err) }));
    return true;
  }
});
