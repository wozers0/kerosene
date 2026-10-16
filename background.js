// Service worker: keeps the friends list fresh (your Octane friends plus any
// extra watched users), shows the online count on the toolbar badge, sends
// online / joined-a-game alerts, and fetches cross-origin stylesheets for
// the theme engine.
importScripts("shared/settings.js");

const S = globalThis.KeroseneSettings;
const ALARM = "kerosene-friends";
const AVATAR_TTL = 60 * 60 * 1000;

function ensureAlarm() {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
  });
}

function notify(id, title, message) {
  chrome.notifications.create(`kerosene-${id}-${Date.now()}`, {
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
    await chrome.storage.local.get(["viewer", "friendStatus", "avatars", "avatarsAt"]);
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
  await chrome.storage.local.set({
    friendStatus: next,
    friendsMeta: { checked, syncError, synced: Boolean(settings.syncFriends && viewer?.id) },
    avatars: avatarMap,
    ...(stale && missing.length ? { avatarsAt: checked } : {}),
  });

  const online = Object.values(next).filter((f) => f.status !== "offline").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#4fa3e0" });
  await chrome.action.setBadgeText({ text: settings.enabled && online ? String(online) : "" });
  return next;
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); pollFriends(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); pollFriends(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) pollFriends(); });

// a new signed-in user (or a settings change) should refresh straight away
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.viewer || changes.syncFriends || changes.friends)) pollFriends();
});

chrome.notifications.onClicked.addListener((nid) => {
  const m = nid.match(/^kerosene-(game|user)-(\d+)-/);
  if (m) chrome.tabs.create({ url: m[1] === "game" ? `${S.SITE}/games/${m[2]}` : `${S.SITE}/users/${m[2]}/profile` });
  chrome.notifications.clear(nid);
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "refresh-friends") {
    pollFriends().then(reply, () => reply(null));
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
