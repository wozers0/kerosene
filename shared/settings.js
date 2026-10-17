// Settings and Octane API helpers shared by the popup, the content script
// and the service worker. Everything lives in ext.storage.local (custom
// background images can be several MB, far beyond storage.sync quotas).
(() => {
  const SITE = "https://octane.wtf";
  const API = `${SITE}/apisite`;
  // Releases: the update button reads version.json from the repo's main branch
  const REPO = "wozers0/kerosene";
  const VERSION_URL = `https://raw.githubusercontent.com/${REPO}/main/version.json`;

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
    // trading
    showValues: true,
    avatarSandbox: true,
    calc: { give: [], get: [], giveRobux: 0, getRobux: 0 },
    notifyTrades: true,
    // Supa Games perks
    hideAds: true,
    priceAlerts: [], // [{ assetId, name, max, belowValue, last }]
    notifyAfford: true,
  };

  // Themes, backgrounds, hide ads, price alerts and "can I afford it" alerts
  // are perks for members of this Octane group.
  const GROUP = { id: 428, name: "Supa Games", url: `${SITE}/groups/428/supa-games` };
  const ACCESS_TTL = 30 * 60 * 1000;

  // groupAccess: { userId, member, checkedAt } (kept fresh by the background)
  const hasPerks = (access, viewer) => Boolean(access?.member && viewer?.id && access.userId === viewer.id);

  async function load() {
    const got = await ext.storage.local.get({ ...DEFAULTS, groupAccess: null, viewer: null });
    const { groupAccess, viewer, ...rest } = got;
    return {
      ...DEFAULTS, ...rest,
      bg: { ...DEFAULTS.bg, ...(got.bg || {}) },
      calc: { ...DEFAULTS.calc, ...(got.calc || {}) },
      perks: hasPerks(groupAccess, viewer),
    };
  }

  // The settings as they take effect: without the perks, member-only
  // features fall back to off (the choices stay saved for later).
  function effective(s) {
    if (s.perks) return s;
    return { ...s, theme: "original", bg: { ...s.bg, mode: "none" }, hideAds: false, notifyAfford: false, priceAlerts: [] };
  }

  function save(patch) {
    return ext.storage.local.set(patch);
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) throw Object.assign(new Error(res.status === 404 ? "not found" : `HTTP ${res.status}`), { status: res.status });
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

  // A user's limiteds: /inventory/v1/users/{id}/assets/collectibles (paged)
  async function fetchCollectibles(userId) {
    const items = [];
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const data = await getJson(`${API}/inventory/v1/users/${encodeURIComponent(userId)}/assets/collectibles?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      items.push(...(data.data || []));
      if (!data.nextPageCursor) break;
      cursor = data.nextPageCursor;
    }
    return items.map((i) => ({ assetId: i.assetId, name: i.name, rap: i.recentAveragePrice || 0, serial: i.serialNumber }));
  }

  // ---------- Supa Games membership ----------
  async function fetchGroupMember(userId) {
    const { data = [] } = await getJson(`${API}/groups/v2/users/${encodeURIComponent(userId)}/groups/roles`);
    return data.some((g) => g.group?.id === GROUP.id);
  }

  // ---------- games ----------
  // Favourited games: the legacy favourites list (public)
  async function fetchFavoriteGames(userId) {
    const { Data } = await getJson(`${SITE}/users/favorites/list-json?assetTypeId=9&itemsPerPage=24&pageNumber=1&userId=${encodeURIComponent(userId)}`);
    return (Data?.Items || []).map((i) => ({
      universeId: i.Item?.UniverseId, placeId: i.Item?.AssetId, name: i.Item?.Name || "Game",
      url: i.Item?.AbsoluteUrl || `/games/${i.Item?.AssetId}/`,
    })).filter((g) => g.universeId && g.placeId);
  }

  // { universeId: { playing, visits } }
  async function fetchGameStats(universeIds) {
    const out = {};
    if (!universeIds.length) return out;
    const { data = [] } = await getJson(`${API}/games/v1/games?universeIds=${universeIds.slice(0, 50).join(",")}`);
    for (const g of data) out[g.id] = { playing: g.playing || 0, visits: g.visits || 0 };
    return out;
  }

  async function fetchGameIcons(universeIds) {
    const out = {};
    if (!universeIds.length) return out;
    try {
      const { data = [] } = await getJson(`${API}/thumbnails/v1/games/icons?universeIds=${universeIds.slice(0, 50).join(",")}&size=150x150&format=Png`);
      for (const t of data) if (t.state === "Completed" && t.imageUrl) out[t.targetId] = t.imageUrl;
    } catch { /* icons are cosmetic */ }
    return out;
  }

  // ---------- economy & trades (trades and balance need the Octane login) ----------
  // Cheapest listing not by `viewerId`: { price, userAssetId, seller } or null
  async function fetchLowestResale(assetId, viewerId) {
    const { data = [] } = await getJson(`${API}/economy/v1/assets/${encodeURIComponent(assetId)}/resellers?limit=25`);
    const best = data.filter((l) => String(l.seller?.id) !== String(viewerId))
      .sort((a, b) => a.price - b.price || a.userAssetId - b.userAssetId)[0];
    return best ? { price: best.price, userAssetId: best.userAssetId, seller: best.seller?.name || "" } : null;
  }

  async function fetchBalance(userId) {
    const d = await getJson(`${API}/economy/v1/users/${encodeURIComponent(userId)}/currency`);
    return { robux: d.robux || 0, tickets: d.tickets || 0 };
  }

  // type: Inbound | Outbound | Completed | Inactive
  async function fetchTrades(type = "Inbound", limit = 25) {
    const { data = [] } = await getJson(`${API}/trades/v1/trades/${type}?limit=${limit}&sortOrder=Desc`);
    return data;
  }

  const fetchTrade = (id) => getJson(`${API}/trades/v1/trades/${encodeURIComponent(id)}`);

  // Every wearable asset the user owns (public inventories), as a Set of ids
  async function fetchOwnedAssets(userId) {
    const types = [2, 8, 11, 12, 17, 18, 19, 27, 28, 29, 30, 31, 32, 41, 42, 43, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 56, 61];
    const owned = new Set();
    let cursor = "";
    for (let page = 0; page < 100; page++) {
      const d = await getJson(`${API}/inventory/v2/users/${encodeURIComponent(userId)}/inventory?assetTypes=${types.join(",")}&limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const it of d.data || []) owned.add(it.assetId);
      cursor = d.nextPageCursor;
      if (!cursor) break;
      await new Promise((r) => setTimeout(r, 300)); // gentle on Octane (a 403 throws out of here)
    }
    return owned;
  }

  // "0.10.1" > "0.9.9"
  function newerVersion(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  async function fetchLatestRelease() {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store", credentials: "omit" });
    if (!res.ok) throw new Error(res.status === 404 ? "release info not found (is the repo public?)" : `HTTP ${res.status}`);
    const info = await res.json();
    if (!info?.version) throw new Error("bad release info");
    return info;
  }

  globalThis.KeroseneSettings = {
    SITE, API, REPO, VERSION_URL, DEFAULTS, GROUP, ACCESS_TTL, load, save, effective, hasPerks, newerVersion, fetchLatestRelease,
    fetchFriends, fetchUser, fetchProfile, searchUsers, resolveUser, fetchHeadshots, fetchCollectibles,
    fetchGroupMember, fetchFavoriteGames, fetchGameStats, fetchGameIcons, fetchLowestResale, fetchBalance,
    fetchTrades, fetchTrade, fetchOwnedAssets,
  };
})();
