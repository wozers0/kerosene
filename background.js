// Service worker: polls Octane for watched friends, keeps the toolbar badge
// showing how many are online and notifies when someone comes online.
importScripts("shared/settings.js");

const S = globalThis.KeroseneSettings;
const ALARM = "kerosene-friends";

function ensureAlarm() {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
  });
}

async function pollFriends() {
  const settings = await S.load();
  const { friendStatus = {} } = await chrome.storage.local.get("friendStatus");
  const next = {};

  await Promise.all(settings.friends.map(async (id) => {
    const prev = friendStatus[id];
    try {
      const user = await S.fetchUser(id);
      next[id] = { ...user, checked: Date.now() };
      if (settings.enabled && settings.notifyOnline && prev && !prev.online && user.online) {
        chrome.notifications.create(`kerosene-online-${id}`, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: `${user.name} is online`,
          message: "Your Octane friend just came online.",
          priority: 0,
        });
      }
    } catch (err) {
      next[id] = { ...(prev || { id: Number(id), name: `#${id}`, online: false }), error: String(err.message || err), checked: Date.now() };
    }
  }));

  await chrome.storage.local.set({ friendStatus: next });
  const online = Object.values(next).filter((f) => f.online).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#4fa3e0" });
  await chrome.action.setBadgeText({ text: settings.enabled && online ? String(online) : "" });
  return next;
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); pollFriends(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); pollFriends(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) pollFriends(); });

chrome.notifications.onClicked.addListener((nid) => {
  const id = nid.replace("kerosene-online-", "");
  chrome.tabs.create({ url: `${S.SITE}/users/${id}/profile` });
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
