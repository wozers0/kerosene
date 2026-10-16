// Settings shared by the popup, the content script and the service worker.
// Everything lives in chrome.storage.local (custom background images can be
// several MB, far beyond storage.sync quotas).
(() => {
  const SITE = "https://octane.wtf";

  const DEFAULTS = {
    enabled: true,
    // popup
    animatedBg: true,
    fieldColor: "blue",
    openSections: ["themes"],
    // site
    theme: "original",
    themeFonts: true,
    bg: { mode: "none", preset: "field", image: "", dim: 0.35, blur: 0 },
    // friends
    friends: [],
    notifyOnline: true,
  };

  async function load() {
    const got = await chrome.storage.local.get(DEFAULTS);
    return { ...DEFAULTS, ...got, bg: { ...DEFAULTS.bg, ...(got.bg || {}) } };
  }

  function save(patch) {
    return chrome.storage.local.set(patch);
  }

  // Octane's public user endpoint: /users/{id} -> { Id, Username, AvatarUri, IsOnline }
  async function fetchUser(id) {
    const res = await fetch(`${SITE}/users/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.Id !== "number") throw new Error("User not found");
    let avatar = data.AvatarUri || null;
    if (avatar && avatar.startsWith("/")) avatar = SITE + avatar;
    return { id: data.Id, name: data.Username, online: Boolean(data.IsOnline), avatar };
  }

  globalThis.KeroseneSettings = { SITE, DEFAULTS, load, save, fetchUser };
})();
