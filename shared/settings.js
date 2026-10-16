// Settings and Octane API helpers shared by the popup, the content script
// and the service worker. Everything lives in chrome.storage.local (custom
// background images can be several MB, far beyond storage.sync quotas).
(() => {
  const SITE = "https://octane.wtf";
  const API = `${SITE}/apisite`;

  const DEFAULTS = {
    enabled: true,
    // popup
    animatedBg: true,
    fieldColor: "blue",
    openSections: ["themes"],
    // site
    theme: "original",
    themeFonts: true,
    seasonal: true,
    bg: { mode: "none", preset: "field", image: "", dim: 0.35, blur: 0 },
    // friends
    syncFriends: true,
    friends: [], // extra user IDs to watch (people who aren't on your friends list)
    notifyOnline: true,
    notifyGames: true,
  };

  async function load() {
    const got = await chrome.storage.local.get(DEFAULTS);
    return { ...DEFAULTS, ...got, bg: { ...DEFAULTS.bg, ...(got.bg || {}) } };
  }

  function save(patch) {
    return chrome.storage.local.set(patch);
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(res.status === 404 ? "not found" : `HTTP ${res.status}`);
    return res.json();
  }

  // userPresenceType: 0 offline, 1 website, 2 in game, 3 in Studio
  function presenceOf(p, isOnline) {
    const type = p?.userPresenceType ?? (isOnline ? 1 : 0);
    if (type === 2) return { status: "ingame", location: p.lastLocation || "a game", placeId: p.rootPlaceId || p.placeId || 0 };
    if (type === 3) return { status: "studio", location: p.lastLocation || "Studio", placeId: 0 };
    if (type === 1 || isOnline) return { status: "online", location: "", placeId: 0 };
    return { status: "offline", location: "", placeId: 0 };
  }

  // Everyone on a user's friends list, with presence: /friends/v1/users/{id}/friends
  async function fetchFriends(userId) {
    const { data = [] } = await getJson(`${API}/friends/v1/users/${encodeURIComponent(userId)}/friends`);
    return data
      .filter((f) => !f.isDeleted)
      .map((f) => ({
        id: f.id,
        name: f.name,
        displayName: f.displayName || f.name,
        ...presenceOf(f.presence, f.isOnline),
        friend: true,
      }));
  }

  // A single user (name + online flag): /users/{id}
  async function fetchUser(id) {
    const data = await getJson(`${SITE}/users/${encodeURIComponent(id)}`);
    if (!data || typeof data.Id !== "number") throw new Error("not found");
    return { id: data.Id, name: data.Username, displayName: data.Username, ...presenceOf(null, Boolean(data.IsOnline)) };
  }

  // Profile details: /users/v1/users/{id}
  function fetchProfile(id) {
    return getJson(`${API}/users/v1/users/${encodeURIComponent(id)}`);
  }

  // Username search: /users/v1/users/search?keyword=
  async function searchUsers(keyword) {
    const { data = [] } = await getJson(`${API}/users/v1/users/search?keyword=${encodeURIComponent(keyword)}&limit=10`);
    return data.map((u) => ({ id: u.id, name: u.name, displayName: u.displayName || u.name }));
  }

  // "123" -> id 123; "builderman" -> exact (or first) username match
  async function resolveUser(query) {
    query = String(query).trim().replace(/^@/, "");
    if (!query) throw new Error("Enter a username or ID");
    if (/^\d+$/.test(query)) return fetchUser(query);
    const hits = await searchUsers(query);
    const hit = hits.find((u) => u.name.toLowerCase() === query.toLowerCase()) || hits[0];
    if (!hit) throw new Error(`No user called "${query}"`);
    return fetchUser(hit.id);
  }

  // Avatar headshots in batches: /thumbnails/v1/users/avatar-headshot
  async function fetchHeadshots(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const { data = [] } = await getJson(`${API}/thumbnails/v1/users/avatar-headshot?userIds=${chunk.join(",")}&size=48x48&format=png`);
        for (const t of data) if (t.state === "Completed" && t.imageUrl) out[t.targetId] = t.imageUrl;
      } catch { /* avatars are cosmetic */ }
    }
    return out;
  }

  globalThis.KeroseneSettings = {
    SITE, API, DEFAULTS, load, save,
    fetchFriends, fetchUser, fetchProfile, searchUsers, resolveUser, fetchHeadshots,
  };
})();
