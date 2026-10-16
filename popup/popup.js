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
function userRow(u, actions) {
  const avatar = el("div", { className: "avatar", textContent: (u.name || "?").replace("#", "")[0]?.toUpperCase() || "?" });
  if (u.avatar) {
    avatar.style.backgroundImage = `url("${u.avatar}")`;
    avatar.textContent = "";
  }
  const sub = u.error ? `#${u.id} · couldn't check` : `#${u.id} · ${u.online ? "online" : "offline"}`;
  const li = el("li", { className: "user" + (u.online ? " online" : "") }, [
    avatar,
    el("div", { className: "user-text" }, [
      el("span", { className: "user-name", textContent: u.name }),
      el("span", { className: "user-sub", textContent: sub }),
    ]),
    ...actions,
  ]);
  return li;
}

async function renderFriends() {
  const { friendStatus = {} } = await chrome.storage.local.get("friendStatus");
  const list = $("friend-list");
  list.replaceChildren();

  const people = settings.friends.map((id) => friendStatus[id] || { id, name: `#${id}`, online: false });
  people.sort((a, b) => Number(b.online) - Number(a.online) || String(a.name).localeCompare(String(b.name)));

  for (const u of people) {
    const open = el("button", { className: "btn ghost icon", title: "Open profile", textContent: "↗" });
    open.addEventListener("click", () => openSite(`/users/${u.id}/profile`));
    const remove = el("button", { className: "btn ghost icon", title: "Stop watching", textContent: "×" });
    remove.addEventListener("click", async () => {
      await update({ friends: settings.friends.filter((f) => f !== u.id) });
      renderFriends();
      chrome.runtime.sendMessage({ type: "refresh-friends" });
    });
    list.append(userRow(u, [open, remove]));
  }

  const online = people.filter((u) => u.online).length;
  $("friends-meta").textContent = people.length ? `${online}/${people.length} online` : "";
  const last = Math.max(0, ...Object.values(friendStatus).map((f) => f.checked || 0));
  $("friends-checked").textContent = people.length ? `checked ${timeAgo(last)} · every minute` : "";
}

async function addFriend(raw) {
  const id = Number(String(raw).trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("Enter a numeric user ID");
  if (settings.friends.includes(id)) throw new Error("Already watching them");
  const user = await S.fetchUser(id);
  const { friendStatus = {} } = await chrome.storage.local.get("friendStatus");
  friendStatus[id] = { ...user, checked: Date.now() };
  await chrome.storage.local.set({ friendStatus });
  await update({ friends: [...settings.friends, id] });
  renderFriends();
  return user;
}

function wireFriends() {
  $("friend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("friend-id");
    try {
      await addFriend(input.value);
      input.value = "";
      $("friends-checked").textContent = "added";
    } catch (err) {
      $("friends-checked").textContent = err.message;
    }
  });
  $("friends-refresh").addEventListener("click", async () => {
    $("friends-checked").textContent = "checking…";
    await chrome.runtime.sendMessage({ type: "refresh-friends" });
    renderFriends();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.friendStatus) renderFriends();
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
    const id = $("lookup-id").value.trim();
    if (!/^\d+$/.test(id)) {
      out.replaceChildren(el("p", { className: "note err", textContent: "Enter a numeric user ID." }));
      return;
    }
    out.replaceChildren(el("p", { className: "note", textContent: "looking up…" }));
    try {
      const u = await S.fetchUser(id);
      const open = el("button", { className: "btn ghost small", textContent: "Profile" });
      open.addEventListener("click", () => openSite(`/users/${u.id}/profile`));
      const watch = el("button", { className: "btn small", textContent: settings.friends.includes(u.id) ? "Watching" : "Watch" });
      watch.disabled = settings.friends.includes(u.id);
      watch.addEventListener("click", async () => {
        try {
          await addFriend(u.id);
          watch.textContent = "Watching";
          watch.disabled = true;
        } catch (err) {
          watch.textContent = err.message;
        }
      });
      out.replaceChildren(el("ul", { className: "friend-list" }, [userRow(u, [open, watch])]));
    } catch (err) {
      out.replaceChildren(el("p", { className: "note err", textContent: `Couldn't find user ${id} (${err.message}).` }));
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
  renderFriends();
  wireFriends();
  renderLinks();
  wireLookup();
  wireToggles();
  renderSwatches();
  wireSections();
}

init();
