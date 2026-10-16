// Demo-only stand-in for the WebExtension API and the octane.wtf / Octomons
// network, so the real popup and content scripts run inside a web page.
// Each demo frame gets its own copy; storage writes are mirrored to the
// other frame through the demo shell with postMessage.
(() => {
  const init = window.__keroInit || {};
  const DATA = window.__keroData || {};
  const shell = window.parent !== window ? window.parent : null;
  const post = (msg) => shell && shell.postMessage({ kero: 1, ...msg }, "*");
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // ---------- storage ----------
  const store = clone(init.storage || {});
  const listeners = [];
  function fire(changes) {
    for (const fn of listeners) {
      try { fn(changes, "local"); } catch (e) { console.error(e); }
    }
  }
  function applyPatch(patch, broadcast) {
    const changes = {};
    for (const [k, v] of Object.entries(patch)) {
      changes[k] = { oldValue: store[k], newValue: clone(v) };
      store[k] = clone(v);
    }
    fire(changes);
    if (broadcast) post({ type: "storage", patch: clone(patch) });
  }
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d && d.kero === 1 && d.type === "storage") applyPatch(d.patch, false);
  });

  const local = {
    async get(keys) {
      if (keys == null) return clone(store);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (k in store) out[k] = clone(store[k]);
        return out;
      }
      const out = {};
      for (const [k, def] of Object.entries(keys)) out[k] = k in store ? clone(store[k]) : clone(def);
      return out;
    },
    async set(patch) { applyPatch(patch, true); },
    async remove(keys) {
      const patch = {};
      for (const k of [].concat(keys)) patch[k] = undefined;
      applyPatch(patch, true);
    },
  };

  // ---------- sample Octane data ----------
  const FRIENDS = DATA.friends || [];
  const USERS = DATA.users || {};
  let tick = 0;

  function presence(f) {
    // friends drift between states so refreshes show something happening
    const states = f.cycle || ["online"];
    return states[(tick + (f.offset || 0)) % states.length];
  }

  function friendStatus() {
    const out = {};
    for (const f of FRIENDS) {
      const s = presence(f);
      out[f.id] = {
        id: f.id, name: f.name, displayName: f.displayName, friend: true,
        status: s === "ingame" ? "ingame" : s,
        location: s === "ingame" ? f.game : s === "studio" ? "Studio" : "",
        placeId: s === "ingame" ? f.placeId : 0,
      };
    }
    return out;
  }

  // The demo always "finds" one newer version so the update button can be tried.
  const currentVersion = () => store.__demoVersion || DATA.version || "0.3.0";
  const nextVersion = () => {
    const p = String(DATA.version || "0.3.0").split(".").map(Number);
    p[2] = (p[2] || 0) + 1;
    return p.join(".");
  };

  async function background(msg) {
    if (msg?.type === "apply-update") {
      await local.set({ justUpdated: { from: currentVersion(), to: msg.info.version, at: Date.now() }, __demoVersion: msg.info.version });
      post({ type: "demo-reload", version: msg.info.version });
      return { mode: "xpi" };
    }
    if (msg?.type === "get-values") {
      return { items: clone(DATA.values || {}), updated: Date.now() - 2 * 60 * 1000 };
    }
    if (msg?.type === "refresh-friends") {
      const s = await globalThis.KeroseneSettings.load();
      const prev = store.friendStatus || {};
      tick++;
      const next = s.syncFriends ? friendStatus() : {};
      for (const id of s.friends || []) {
        if (!next[id] && USERS[id]) next[id] = { id: Number(id), name: USERS[id].name, displayName: USERS[id].name, status: USERS[id].online ? "online" : "offline" };
      }
      // same alert rules as background.js
      if (s.enabled) {
        for (const f of Object.values(next)) {
          const p = prev[f.id];
          if (!p) continue;
          if (s.notifyGames && f.status === "ingame" && (p.status !== "ingame" || p.placeId !== f.placeId)) {
            post({ type: "toast", title: `${f.displayName} is playing`, message: f.location });
          } else if (s.notifyOnline && p.status === "offline" && f.status !== "offline") {
            post({ type: "toast", title: `${f.displayName} is online`, message: "Your Octane friend just came online." });
          }
        }
      }
      await local.set({
        friendStatus: next,
        friendsMeta: { checked: Date.now(), syncError: null, synced: true },
        avatars: DATA.avatars || {},
      });
      return next;
    }
    return null;
  }

  const ext = {
    runtime: {
      id: "kerosene-demo",
      getManifest: () => ({ version: currentVersion() }),
      onUpdateAvailable: { addListener() {} },
      getURL: (p) => p,
      sendMessage: (msg) => background(msg),
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: {
      async query() { return [{ id: 1, url: "https://octane.wtf/home" }]; },
      async update(_id, { url }) { post({ type: "navigate", url }); },
      async create({ url }) { post({ type: "navigate", url }); },
    },
    permissions: { async contains() { return true; }, async request() { return true; } },
    management: { async getSelf() { return { installType: "normal" }; } },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    notifications: {
      create(_id, opts) { post({ type: "toast", title: opts.title, message: opts.message }); },
      onClicked: { addListener() {} },
      clear() {},
    },
    alarms: { get() {}, create() {}, onAlarm: { addListener() {} } },
  };
  globalThis.browser = ext;

  // ---------- network: octane.wtf APIs answered from sample data ----------
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://octane.wtf/");
    if (url.hostname === "raw.githubusercontent.com" && url.pathname.endsWith("/version.json")) {
      await new Promise((r) => setTimeout(r, 500));
      const v = store.__demoVersion ? currentVersion() : nextVersion();
      return json({ version: v, notes: "Demo update", page: "https://github.com/wozers0/kerosene" });
    }
    if (!/octane\.wtf$|octomons\.wtf$/.test(url.hostname)) return realFetch(input, opts);
    const p = url.pathname;
    let m;
    if ((m = p.match(/^\/users\/(\d+)$/))) {
      const u = USERS[m[1]];
      return u ? json({ Id: Number(m[1]), Username: u.name, AvatarUri: null, IsOnline: Boolean(u.online) }) : json({ errors: [{ message: "Not found" }] }, 404);
    }
    if (p === "/apisite/users/v1/users/search") {
      const k = (url.searchParams.get("keyword") || "").toLowerCase();
      return json({ data: Object.entries(USERS).filter(([, u]) => u.name.toLowerCase().includes(k)).slice(0, 10).map(([id, u]) => ({ id: Number(id), name: u.name, displayName: u.name })) });
    }
    if (p === "/apisite/thumbnails/v1/users/avatar-headshot") {
      const ids = (url.searchParams.get("userIds") || "").split(",").filter(Boolean);
      return json({ data: ids.map((id) => ({ targetId: Number(id), state: "Completed", imageUrl: (DATA.avatars || {})[id] || "" })) });
    }
    if (/^\/apisite\/inventory\/v1\/users\/\d+\/assets\/collectibles$/.test(p)) {
      return json({ nextPageCursor: null, data: DATA.inventory || [] });
    }
    if (/^\/apisite\/friends\/v1\/users\/\d+\/friends$/.test(p)) {
      return json({ data: [] });
    }
    return json({ errors: [{ message: "Not available in the demo" }] }, 404);
  };
})();
