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

function onTick() {
  pollFriends();
  getValues(); // refreshes when the cache is older than V.TTL
}

// ---------- updates ----------
const IS_FIREFOX = typeof globalThis.browser?.runtime?.getBrowserInfo === "function";

// A newer signed version is ready: apply it now instead of waiting for a restart.
ext.runtime.onUpdateAvailable?.addListener(() => ext.runtime.reload());

// After an update: remember it for the popup and refresh open Octane tabs so
// they load the new version.
async function afterUpdate(previousVersion) {
  await ext.storage.local.set({
    justUpdated: { from: previousVersion, to: ext.runtime.getManifest().version, at: Date.now() },
  });
  const tabs = await ext.tabs.query({ url: ["https://octane.wtf/*", "https://*.octane.wtf/*"] }).catch(() => []);
  for (const t of tabs) ext.tabs.reload(t.id).catch(() => {});
}

// Install a newer release. Store / signed installs update in place; a
// developer (unpacked or temporary) install can't replace its own files.
async function applyUpdate(info) {
  const self = await ext.management?.getSelf?.().catch(() => null);
  const dev = !self || self.installType === "development";
  if (!dev && !IS_FIREFOX && typeof ext.runtime.requestUpdateCheck === "function") {
    const res = await ext.runtime.requestUpdateCheck();
    const status = res?.status || res?.[0] || res; // promise form or [status, details]
    return { mode: "store", status }; // "update_available" -> onUpdateAvailable reloads us
  }
  if (!dev && IS_FIREFOX && info.firefox) {
    await ext.tabs.create({ url: info.firefox }); // Firefox shows its "update Kerosene?" prompt
    return { mode: "xpi" };
  }
  await ext.tabs.create({ url: info.page || `https://github.com/${S.REPO}/releases/latest` });
  return { mode: "manual" };
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
});

ext.notifications.onClicked.addListener((nid) => {
  const m = nid.match(/^kerosene-(game|user)-(\d+)-/);
  if (m) ext.tabs.create({ url: m[1] === "game" ? `${S.SITE}/games/${m[2]}` : `${S.SITE}/users/${m[2]}/profile` });
  ext.notifications.clear(nid);
});

ext.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "refresh-friends") {
    pollFriends().then(reply, () => reply(null));
    return true;
  }
  if (msg?.type === "apply-update") {
    applyUpdate(msg.info || {}).then(reply, (err) => reply({ mode: "error", error: String(err.message || err) }));
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
