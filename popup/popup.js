const S = globalThis.KeroseneSettings;
const T = globalThis.KeroseneThemes;
const F = globalThis.KeroseneField;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of [].concat(children)) node.append(c);
  return node;
};

const LINKS = [
  { label: "Home", path: "/home", ico: "🏠" },
  { label: "Games", path: "/games", ico: "🎮" },
  { label: "Catalog", path: "/catalog", ico: "🛒" },
  { label: "Avatar", path: "/avatar", ico: "🧍" },
  { label: "Friends", path: "/friends", ico: "👥" },
  { label: "Trades", path: "/trades", ico: "🔁" },
  { label: "Groups", path: "/groups", ico: "🛡️" },
  { label: "Forum", path: "/forum", ico: "💬" },
  { label: "Develop", path: "/develop", ico: "🛠️" },
];

const MAX_UPLOAD = 25 * 1024 * 1024;

let settings;
let field;

// ---------- helpers ----------
function setAccent(name) {
  const rgb = F.rgb[name] || F.rgb.blue;
  document.documentElement.style.setProperty("--accent", rgb.join(", "));
}

async function update(patch) {
  Object.assign(settings, patch);
  await S.save(patch);
  renderStatus();
}

async function openSite(path) {
  const url = S.SITE + path;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith(S.SITE)) await chrome.tabs.update(tab.id, { url });
  else await chrome.tabs.create({ url });
  window.close();
}

function fmtBytes(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

// ---------- header / status ----------
function renderStatus() {
  const theme = T.THEMES[settings.theme] || T.THEMES.original;
  const bgOn = settings.bg.mode !== "none";
  $("active-pill").textContent = settings.enabled ? `${theme.year}${bgOn ? " + bg" : ""}` : "off";
  $("theme-meta").textContent = `${theme.label} · ${theme.year}`;
  $("bg-meta").textContent = settings.bg.mode === "none"
    ? "none"
    : settings.bg.mode === "image" ? "custom" : T.BG_PRESETS[settings.bg.preset]?.label || "";
  document.body.classList.toggle("off", !settings.enabled);
  $("status-text").textContent = settings.enabled ? "ready" : "disabled";
}

// ---------- themes ----------
function renderThemes() {
  const grid = $("theme-grid");
  grid.replaceChildren();
  for (const theme of Object.values(T.THEMES)) {
    const sw = theme.swatch;
    const topBar = el("div", { className: "mini-bar" });
    topBar.style.background = sw.bar;
    const card = el("div", { className: "mini-card" }, [
      el("div", { className: "mini-line" }),
      el("div", { className: "mini-line" }),
      el("div", { className: "mini-btn" }),
    ]);
    card.style.background = sw.card;
    card.children[0].style.cssText = `background:${sw.text};width:70%`;
    card.children[1].style.cssText = `background:${sw.text};width:45%;opacity:.45`;
    card.children[2].style.background = sw.accent;
    const mini = el("div", { className: "mini" }, [topBar, card]);
    mini.style.background = sw.page;

    const btn = el("button", { className: "theme-card", title: theme.blurb }, [
      mini,
      el("div", { className: "theme-label" }, [el("b", { textContent: theme.label }), el("span", { textContent: theme.year })]),
    ]);
    btn.setAttribute("aria-pressed", String(settings.theme === theme.id));
    btn.addEventListener("click", async () => {
      await update({ theme: theme.id });
      renderThemes();
    });
    grid.append(btn);
  }
}

// Some revivals serve CSS from a CDN; reading it needs the user's OK.
async function renderCssNotice() {
  const { cssBlocked = [] } = await chrome.storage.local.get("cssBlocked");
  const origins = [];
  for (const o of cssBlocked) {
    if (!(await chrome.permissions.contains({ origins: [`${o}/*`] }))) origins.push(o);
  }
  $("css-notice").hidden = origins.length === 0;
  $("css-origins").textContent = origins.map((o) => o.replace(/^https?:\/\//, "")).join(", ");
  $("css-allow").onclick = async () => {
    const ok = await chrome.permissions.request({ origins: origins.map((o) => `${o}/*`) });
    if (ok) {
      await chrome.storage.local.set({ cssBlocked: [], cssRetry: Date.now() });
      renderCssNotice();
    }
  };
}

// ---------- backgrounds ----------
function renderBackgrounds() {
  const grid = $("bg-grid");
  for (const c of grid.querySelectorAll("canvas")) c.__field?.destroy();
  grid.replaceChildren();
  const bg = settings.bg;

  const tile = (label, pressed, onClick, style) => {
    const b = el("button", { className: "bg-tile", title: label }, [el("span", { textContent: label })]);
    if (style) b.style.cssText = style;
    b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    grid.append(b);
    return b;
  };

  tile("None", bg.mode === "none", () => setBg({ mode: "none" }), "background:#0a0a0a");

  for (const [id, preset] of Object.entries(T.BG_PRESETS)) {
    const b = tile(preset.label, bg.mode === "preset" && bg.preset === id, () => setBg({ mode: "preset", preset: id }), preset.css + ";background-size:auto;");
    if (id === "field") {
      const c = el("canvas");
      b.prepend(c);
      requestAnimationFrame(() => {
        c.__field = F.create(c, { fontSize: 7, color: settings.fieldColor, interactive: false, animate: false, background: "#050505" });
      });
    }
  }

  const isVideo = /^data:video|\.(mp4|webm)(\?|#|$)/i.test(bg.image || "");
  const custom = tile(bg.image ? (isVideo ? "Video" : "Custom") : "+ Upload", bg.mode === "image", () => {
    if (bg.image) setBg({ mode: "image" });
    else $("bg-file").click();
  }, "background:#111");
  if (bg.image && !isVideo) custom.style.backgroundImage = `url("${bg.image.replace(/"/g, "%22")}")`;

  $("bg-dim").value = bg.dim;
  $("bg-blur").value = bg.blur;
  $("dim-val").textContent = `${Math.round(bg.dim * 100)}%`;
  $("blur-val").textContent = `${bg.blur}px`;
}

async function setBg(patch) {
  await update({ bg: { ...settings.bg, ...patch } });
  renderBackgrounds();
}

function note(text, isErr = false) {
  const n = $("bg-note");
  n.textContent = text;
  n.classList.toggle("err", isErr);
}

function wireBackgrounds() {
  $("bg-url-apply").addEventListener("click", () => {
    const url = $("bg-url").value.trim();
    if (!/^https?:\/\//i.test(url)) return note("Paste a full link starting with https://", true);
    note("Using image from link.");
    setBg({ mode: "image", image: url });
  });

  $("bg-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD) return note(`That file is ${fmtBytes(file.size)} — max is 25 MB.`, true);
    const reader = new FileReader();
    reader.onload = () => {
      note(`Using ${file.name} (${fmtBytes(file.size)}).`);
      setBg({ mode: "image", image: reader.result });
    };
    reader.onerror = () => note("Couldn't read that file.", true);
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  $("bg-dim").addEventListener("input", (e) => { $("dim-val").textContent = `${Math.round(e.target.value * 100)}%`; });
  $("bg-blur").addEventListener("input", (e) => { $("blur-val").textContent = `${e.target.value}px`; });
  $("bg-dim").addEventListener("change", (e) => setBg({ dim: Number(e.target.value) }));
  $("bg-blur").addEventListener("change", (e) => setBg({ blur: Number(e.target.value) }));
}

// ---------- friends ----------
const STATUS_ORDER = { ingame: 0, studio: 1, online: 2, offline: 3 };

function statusText(u) {
  if (u.error) return "couldn't check";
  if (u.status === "ingame") return `playing ${u.location}`;
  if (u.status === "studio") return "in Studio";
  return u.status === "online" ? "online" : "offline";
}

function userRow(u, avatars, actions) {
  const label = u.displayName || u.name || `#${u.id}`;
  const avatar = el("div", { className: "avatar", textContent: label.replace("#", "")[0]?.toUpperCase() || "?" });
  const img = avatars[u.id] || u.avatar;
  if (img) {
    avatar.style.backgroundImage = `url("${img}")`;
    avatar.textContent = "";
  }
  const handle = u.name && u.name !== label ? `@${u.name} · ` : "";
  const li = el("li", { className: `user ${u.error ? "offline" : u.status || "offline"}`, title: `${label} (#${u.id})` }, [
    avatar,
    el("div", { className: "user-text" }, [
      el("span", { className: "user-name", textContent: label }),
      el("span", { className: "user-sub", textContent: `${handle}${statusText(u)}` }),
    ]),
    ...actions,
  ]);
  return li;
}

function iconBtn(text, title, onClick, cls = "btn ghost icon") {
  const b = el("button", { className: cls, title, textContent: text, type: "button" });
  b.addEventListener("click", onClick);
  return b;
}

async function renderFriends() {
  const { friendStatus = {}, avatars = {}, friendsMeta = {}, viewer = null } =
    await chrome.storage.local.get(["friendStatus", "avatars", "friendsMeta", "viewer"]);
  const list = $("friend-list");
  const filter = $("friend-filter").value.trim().toLowerCase();

  $("sync-desc").textContent = viewer
    ? `Signed in as ${viewer.displayName || viewer.name}`
    : "Open octane.wtf while signed in to link your account";

  let people = Object.values(friendStatus);
  // watched users that haven't been checked yet
  for (const id of settings.friends) {
    if (!friendStatus[id]) people.push({ id, name: `#${id}`, status: "offline" });
  }
  people.sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
    String(a.displayName || a.name).localeCompare(String(b.displayName || b.name)));

  const total = people.length;
  const online = people.filter((u) => u.status && u.status !== "offline").length;
  $("friend-filter").hidden = total < 8;
  if (filter) {
    people = people.filter((u) => `${u.displayName} ${u.name} ${u.id}`.toLowerCase().includes(filter));
  }

  list.replaceChildren();
  let lastGroup = null;
  for (const u of people) {
    const group = u.status === "offline" || !u.status ? "Offline" : "Online";
    if (group !== lastGroup && total >= 4) {
      list.append(el("li", { className: "group-label", textContent: group === "Online" ? `Online — ${online}` : `Offline — ${total - online}` }));
      lastGroup = group;
    }
    const actions = [];
    if (u.status === "ingame" && u.placeId) {
      actions.push(iconBtn("Join", `Open ${u.location}`, () => openSite(`/games/${u.placeId}`), "btn small"));
    }
    actions.push(iconBtn("↗", "Open profile", () => openSite(`/users/${u.id}/profile`)));
    if (!u.friend) {
      actions.push(iconBtn("×", "Stop watching", async () => {
        await update({ friends: settings.friends.filter((f) => f !== u.id) });
        const { friendStatus: fs = {} } = await chrome.storage.local.get("friendStatus");
        delete fs[u.id];
        await chrome.storage.local.set({ friendStatus: fs });
        renderFriends();
      }));
    }
    list.append(userRow(u, avatars, actions));
  }
  if (!people.length) {
    list.append(el("li", {
      className: "empty-note",
      textContent: filter ? "// nobody matches that filter"
        : settings.syncFriends && viewer ? "// your Octane friends list is empty"
        : "// sync your Octane friends, or watch someone by username / ID",
    }));
  }

  $("friends-meta").textContent = total ? `${online}/${total} online` : "";
  const note = friendsMeta.syncError ? `sync failed (${friendsMeta.syncError})`
    : friendsMeta.checked ? `checked ${timeAgo(friendsMeta.checked)} · every minute` : "";
  $("friends-checked").textContent = note;
  $("friends-checked").classList.toggle("err", Boolean(friendsMeta.syncError));
}

async function watchUser(query) {
  const user = await S.resolveUser(query);
  if (settings.friends.includes(user.id)) throw new Error(`Already watching ${user.name}`);
  const { friendStatus = {} } = await chrome.storage.local.get("friendStatus");
  if (friendStatus[user.id]?.friend) throw new Error(`${user.name} is already on your friends list`);
  friendStatus[user.id] = user;
  await chrome.storage.local.set({ friendStatus });
  await update({ friends: [...settings.friends, user.id] });
  renderFriends();
  return user;
}

async function renderViewer() {
  const { viewer = null } = await chrome.storage.local.get("viewer");
  const line = $("viewer-line");
  line.replaceChildren("fuel for ", el("b", { textContent: "octane" }));
  if (viewer) line.append(` · ${viewer.displayName || viewer.name}`);
}

function wireFriends() {
  $("friend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("friend-id");
    const note = $("friends-checked");
    note.classList.remove("err");
    note.textContent = "looking up…";
    try {
      const u = await watchUser(input.value);
      input.value = "";
      note.textContent = `watching ${u.name}`;
    } catch (err) {
      note.textContent = err.message;
      note.classList.add("err");
    }
  });
  $("friend-filter").addEventListener("input", renderFriends);
  $("friends-refresh").addEventListener("click", async () => {
    $("friends-checked").textContent = "checking…";
    await chrome.runtime.sendMessage({ type: "refresh-friends" });
    renderFriends();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.friendStatus || changes.friendsMeta || changes.avatars) renderFriends();
    if (changes.viewer) { renderViewer(); renderFriends(); }
  });
}

// ---------- quick links & lookup ----------
function renderLinks() {
  const grid = $("link-grid");
  for (const l of LINKS) {
    const b = el("button", { className: "link" }, [el("span", { className: "ico", textContent: l.ico }), l.label]);
    b.addEventListener("click", () => openSite(l.path));
    grid.append(b);
  }
}

function wireLookup() {
  $("lookup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("lookup-result");
    const query = $("lookup-id").value.trim().replace(/^@/, "");
    if (!query) return;
    out.replaceChildren(el("p", { className: "note", textContent: "looking up…" }));
    try {
      let users;
      if (/^\d+$/.test(query)) users = [await S.fetchUser(query)];
      else {
        const hits = await S.searchUsers(query);
        users = await Promise.all(hits.slice(0, 6).map((h) => S.fetchUser(h.id).then((u) => ({ ...u, displayName: h.displayName }), () => ({ ...h, status: "offline" }))));
      }
      if (!users.length) throw new Error("no matches");
      const avatars = await S.fetchHeadshots(users.map((u) => u.id));
      const { friendStatus = {} } = await chrome.storage.local.get("friendStatus");

      const rows = users.map((u) => {
        const known = settings.friends.includes(u.id) || friendStatus[u.id]?.friend;
        const watch = iconBtn(known ? "✓" : "+", known ? "Already in your list" : "Watch", async () => {
          try {
            await watchUser(u.id);
            watch.textContent = "✓";
            watch.disabled = true;
          } catch (err) {
            watch.title = err.message;
            watch.textContent = "!";
          }
        });
        watch.disabled = Boolean(known);
        return userRow(u, avatars, [iconBtn("↗", "Open profile", () => openSite(`/users/${u.id}/profile`)), watch]);
      });
      out.replaceChildren(el("ul", { className: "friend-list" }, rows));
    } catch (err) {
      out.replaceChildren(el("p", { className: "note err", textContent: `Couldn't find "${query}" (${err.message}).` }));
    }
  });
}

// ---------- settings ----------
function wireToggles() {
  for (const input of document.querySelectorAll("[data-setting]")) {
    const key = input.dataset.setting;
    input.checked = Boolean(settings[key]);
    input.addEventListener("change", async () => {
      await update({ [key]: input.checked });
      if (key === "animatedBg") field.setRunning(input.checked);
      if (key === "syncFriends") renderFriends();
    });
  }
}

function renderSwatches() {
  const wrap = $("color-swatches");
  wrap.replaceChildren();
  for (const name of F.colors) {
    const rgb = `rgb(${F.rgb[name].join(",")})`;
    const b = el("button", { className: "swatch", title: name });
    b.style.background = rgb;
    b.style.color = rgb;
    b.setAttribute("aria-pressed", String(settings.fieldColor === name));
    b.addEventListener("click", async () => {
      await update({ fieldColor: name });
      setAccent(name);
      field.setColor(name);
      renderSwatches();
      renderBackgrounds();
    });
    wrap.append(b);
  }
}

function wireSections() {
  const drops = document.querySelectorAll("details.drop");
  for (const d of drops) {
    d.open = settings.openSections.includes(d.dataset.key);
    d.addEventListener("toggle", () => {
      update({ openSections: [...drops].filter((x) => x.open).map((x) => x.dataset.key) });
    });
  }
}

// ---------- boot ----------
async function init() {
  settings = await S.load();
  setAccent(settings.fieldColor);
  field = F.create($("field"), { color: settings.fieldColor, animate: settings.animatedBg });

  $("version").textContent = "v" + chrome.runtime.getManifest().version;
  renderStatus();
  renderThemes();
  renderCssNotice();
  renderBackgrounds();
  wireBackgrounds();
  renderViewer();
  renderFriends();
  wireFriends();
  renderLinks();
  wireLookup();
  wireToggles();
  renderSwatches();
  wireSections();
}

init();
