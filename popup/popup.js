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
  { label: "Avatar", path: "/my/avatar", ico: "🧍" },
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
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith(S.SITE)) await ext.tabs.update(tab.id, { url });
  else await ext.tabs.create({ url });
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
  const live = S.effective(settings); // without the perks: Original, no background
  const theme = T.THEMES[live.theme] || T.THEMES.original;
  const bgOn = live.bg.mode !== "none";
  $("active-pill").textContent = settings.enabled ? `${theme.year}${bgOn ? " + bg" : ""}` : "off";
  $("theme-meta").textContent = `${theme.label} · ${theme.year}`;
  $("bg-meta").textContent = live.bg.mode === "none"
    ? "none"
    : live.bg.mode === "image" ? "custom" : T.BG_PRESETS[live.bg.preset]?.label || "";
  $("font-meta").textContent = live.customFont.source ? live.customFont.family : "theme font";
  document.body.classList.toggle("off", !settings.enabled);
}

// ---------- themes ----------
function renderThemes() {
  const grid = $("theme-grid");
  grid.replaceChildren();
  for (const theme of T.ORDER.map((id) => T.THEMES[id])) {
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
  const { cssBlocked = [] } = await ext.storage.local.get("cssBlocked");
  const origins = [];
  for (const o of cssBlocked) {
    if (!(await ext.permissions.contains({ origins: [`${o}/*`] }))) origins.push(o);
  }
  $("css-notice").hidden = origins.length === 0;
  $("css-origins").textContent = origins.map((o) => o.replace(/^https?:\/\//, "")).join(", ");
  $("css-allow").onclick = async () => {
    const ok = await ext.permissions.request({ origins: origins.map((o) => `${o}/*`) });
    if (ok) {
      await ext.storage.local.set({ cssBlocked: [], cssRetry: Date.now() });
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
    else pickFile();
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

// Firefox closes the popup when a file picker opens, so uploads happen in
// the same page opened as a tab.
const IN_TAB = new URLSearchParams(location.search).has("tab");
const IS_FIREFOX = /firefox/i.test(navigator.userAgent);
function pickFile(input = "bg-file", section = "backgrounds") {
  if (IS_FIREFOX && !IN_TAB) {
    ext.tabs.create({ url: ext.runtime.getURL(`popup/popup.html?tab=1&open=${section}`) });
    window.close();
    return;
  }
  $(input).click();
}

function wireBackgrounds() {
  document.querySelector('label[for="bg-file"]').addEventListener("click", (e) => {
    e.preventDefault();
    pickFile("bg-file", "backgrounds");
  });
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

// ---------- custom font (Supa Games) ----------
// Presets are Google Fonts; you can also name any Google Font or a font on
// your computer, or upload a font file (kept in customFontFile).
const FONT_PRESETS = [
  "Poppins", "Nunito", "Fredoka", "Rubik", "Lexend", "Space Grotesk",
  "Comic Neue", "Bangers", "Orbitron", "Press Start 2P", "VT323", "Silkscreen",
];
const MAX_FONT = 4 * 1024 * 1024;
const CUSTOM_FAMILY = "Kerosene Custom";
let fontFile = null; // { name, data, size }
let fontFace = null; // the uploaded font, loaded into this page for previews

function fontNote(text, isErr = false) {
  const n = $("font-note");
  n.textContent = text;
  n.classList.toggle("err", isErr);
}

// Google Fonts for the previews, once the Font section is open
function loadPreviewFonts() {
  if (document.getElementById("font-previews")) return;
  const families = FONT_PRESETS.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&");
  document.head.append(el("link", { id: "font-previews", rel: "stylesheet", href: `https://fonts.googleapis.com/css2?${families}&display=swap` }));
}
function previewGoogle(family) {
  if (FONT_PRESETS.includes(family)) return loadPreviewFonts();
  let link = document.getElementById("font-preview-link");
  if (!link) document.head.append(link = el("link", { id: "font-preview-link", rel: "stylesheet" }));
  link.href = S.googleFontUrl(family);
}
async function previewFile() {
  if (fontFace || !fontFile || !S.FONT_DATA.test(fontFile.data)) return;
  try {
    fontFace = await new FontFace(CUSTOM_FAMILY, `url(${fontFile.data})`).load();
    document.fonts.add(fontFace);
  } catch { fontFace = null; }
}

function fontCss(f) {
  if (f.source === "file") return `"${CUSTOM_FAMILY}", system-ui, sans-serif`;
  if (f.source && S.FONT_NAME.test(f.family)) return `"${f.family}", system-ui, sans-serif`;
  return "";
}

function renderFonts() {
  const grid = $("font-grid");
  grid.replaceChildren();
  const cur = settings.customFont;
  const tile = (label, family, pressed, onClick, extra = "") => {
    const b = el("button", { className: `font-tile${extra}`, type: "button", title: label }, [
      el("span", { className: "font-sample", textContent: "Aa" }),
      el("span", { className: "font-label", textContent: label }),
    ]);
    if (family) b.querySelector(".font-sample").style.fontFamily = family;
    b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    grid.append(b);
  };
  tile("Theme font", "", !cur.source, () => setFont({ source: "", family: "" }));
  for (const name of FONT_PRESETS) {
    tile(name, `"${name}"`, cur.source === "google" && cur.family === name, () => setFont({ source: "google", family: name }));
  }
  if (cur.source && cur.source !== "file" && !(cur.source === "google" && FONT_PRESETS.includes(cur.family))) {
    tile(cur.family, `"${cur.family}"`, true, () => {}, " custom");
  }
  if (fontFile) {
    tile(fontFile.name, `"${CUSTOM_FAMILY}"`, cur.source === "file", () => setFont({ source: "file", family: fontFile.name }), " custom");
  }
  if (cur.source === "google") previewGoogle(cur.family);
  if (cur.source === "file") previewFile();
  const preview = $("font-preview");
  preview.style.fontFamily = fontCss(cur);
}

async function setFont(f) {
  await update({ customFont: f });
  renderFonts();
  fontNote(f.source ? `Octane now uses ${f.family}.` : "Back to the theme's own font.");
}

// "press start 2p" -> also try "Press Start 2P"; Google's names are case-sensitive
function fontNameGuesses(name) {
  const cap = name.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const caps = name.split(" ").map((w) => (/\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(" ");
  return [...new Set([name, cap, caps])];
}

async function onGoogleFonts(name) {
  for (const guess of fontNameGuesses(name)) {
    try {
      const res = await fetch(S.googleFontUrl(guess), { credentials: "omit" });
      if (res.ok) return guess;
    } catch { /* offline: try this computer */ }
  }
  return null;
}

// A font installed on this computer draws text at a different width than
// the generic fallbacks do
function installedFont(name) {
  const ctx = document.createElement("canvas").getContext("2d");
  const sample = "mmmmmmmmmwwwwwww iiiiil 0123456789";
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    ctx.font = `48px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `48px "${name}", ${generic}`;
    return Math.abs(ctx.measureText(sample).width - base) > 0.5;
  });
}

async function useFontName(raw) {
  const name = S.cleanFontName(raw);
  if (!name) return fontNote("Type a font's name.", true);
  if (!S.FONT_NAME.test(name)) return fontNote("Font names can use letters, numbers, spaces and dashes.", true);
  fontNote(`Looking for ${name}…`);
  const google = await onGoogleFonts(name);
  if (google) {
    await setFont({ source: "google", family: google });
    return fontNote(`Using ${google} from Google Fonts.`);
  }
  if (installedFont(name)) {
    await setFont({ source: "local", family: name });
    return fontNote(`Using ${name} from this computer. It only shows on computers that have it.`);
  }
  fontNote(`Couldn't find "${name}" on Google Fonts or this computer.`, true);
}

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function useFontFile(file) {
  if (file.size > MAX_FONT) return fontNote(`That file is ${fmtBytes(file.size)}. Fonts can be up to 4 MB.`, true);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = S.fontFormat(bytes);
  if (!format) return fontNote("That isn't a font file. Use .ttf, .otf, .woff or .woff2.", true);
  try {
    await new FontFace("Kerosene Check", bytes.buffer).load();
  } catch {
    return fontNote("Couldn't read that font file.", true);
  }
  const name = S.cleanFontName(file.name.replace(/\.[^.]+$/, "")).slice(0, 48) || "Uploaded font";
  fontFile = { name, data: `data:font/${format};base64,${toBase64(bytes)}`, size: file.size };
  if (fontFace) document.fonts.delete(fontFace);
  fontFace = null;
  await ext.storage.local.set({ customFontFile: fontFile });
  await setFont({ source: "file", family: name });
  fontNote(`Using ${name} (${fmtBytes(file.size)}).`);
}

async function wireFonts() {
  ({ customFontFile: fontFile = null } = await ext.storage.local.get("customFontFile"));
  renderFonts();
  const section = document.querySelector('details[data-key="fonts"]');
  if (section.open) loadPreviewFonts();
  section.addEventListener("toggle", () => { if (section.open) loadPreviewFonts(); });
  $("font-form").addEventListener("submit", (e) => {
    e.preventDefault();
    useFontName($("font-name").value).catch((err) => fontNote(String(err?.message || err), true));
  });
  document.querySelector('label[for="font-file"]').addEventListener("click", (e) => {
    e.preventDefault();
    pickFile("font-file", "fonts");
  });
  $("font-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) useFontFile(file).catch(() => fontNote("Couldn't read that font file.", true));
  });
}

// ---------- friends ----------
const STATUS_ORDER = { ingame: 0, studio: 1, online: 2, offline: 3 };

function statusText(u) {
  if (u.error) return "couldn't check";
  if (u.status === "ingame") return `playing ${u.location}${u.since && Date.now() - u.since >= 60000 ? ` · ${fmtDur(Date.now() - u.since)}` : ""}`;
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
    await ext.storage.local.get(["friendStatus", "avatars", "friendsMeta", "viewer"]);
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
        const { friendStatus: fs = {} } = await ext.storage.local.get("friendStatus");
        delete fs[u.id];
        await ext.storage.local.set({ friendStatus: fs });
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
  const { friendStatus = {} } = await ext.storage.local.get("friendStatus");
  if (friendStatus[user.id]?.friend) throw new Error(`${user.name} is already on your friends list`);
  friendStatus[user.id] = user;
  await ext.storage.local.set({ friendStatus });
  await update({ friends: [...settings.friends, user.id] });
  renderFriends();
  return user;
}

async function renderViewer() {
  const { viewer = null } = await ext.storage.local.get("viewer");
  const line = $("viewer-line");
  line.replaceChildren("fuel for ", el("b", { textContent: "octane" }));
  if (viewer) line.append(el("span", { className: "viewer-name", textContent: ` · ${viewer.displayName || viewer.name}` }));
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
    await ext.runtime.sendMessage({ type: "refresh-friends" });
    renderFriends();
  });
  ext.storage.onChanged.addListener((changes, area) => {
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
      const { friendStatus = {} } = await ext.storage.local.get("friendStatus");

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

// ---------- item values ----------
const V = globalThis.KeroseneValues;
let values = {};
let valuesInfo = {};
let worthCache = null;

async function loadValues(force = false) {
  const res = await ext.runtime.sendMessage({ type: "get-values", force }).catch(() => null);
  values = res?.items || {};
  valuesInfo = res || {};
  renderValuesNote();
  renderValueResults();
  renderCalc();
  renderWorth();
  renderAlerts();
}

function itemRow(v, actions = [], compact = false) {
  const thumb = el("div", { className: "item-thumb" });
  if (v.thumb) thumb.style.backgroundImage = `url("${v.thumb}")`;
  const name = el("span", { className: "item-name", title: v.name }, [el("span", { className: "item-name-text", textContent: v.name })]);
  if (v.acronym) name.append(el("span", { className: "tag", textContent: v.acronym, style: "background:rgba(255,255,255,.08)" }));
  if (v.projected) name.append(el("span", { className: "tag proj", textContent: "PROJ", title: "Projected: RAP is inflated" }));
  if (v.rare) name.append(el("span", { className: "tag rare", textContent: "RARE" }));
  const sub = el("span", { className: "item-sub" });
  sub.append(el("span", { className: "v", textContent: v.valued ? `V ${V.fmt(v.value)}` : `RAP ${V.fmt(v.rap)}` }));
  const extra = [];
  if (v.valued) extra.push(`RAP ${V.fmt(v.rap)}`);
  if (!compact && V.demandLabel(v.demand)) extra.push(V.demandLabel(v.demand));
  if (!compact && V.trendLabel(v.trend)) extra.push(V.trendLabel(v.trend));
  if (extra.length) sub.append(` · ${extra.join(" · ")}`);
  return el("li", { className: "item-row" }, [thumb, el("div", { className: "item-text" }, [name, sub]), ...actions]);
}

function renderValuesNote() {
  const n = Object.keys(values).length;
  const note = $("values-note");
  note.classList.toggle("err", Boolean(valuesInfo.error));
  note.textContent = valuesInfo.error && !n ? `Couldn't load Octomons (${valuesInfo.error})`
    : n ? `${n} limiteds · updated ${timeAgo(valuesInfo.updated)}` : "loading values…";
  $("values-meta").textContent = n ? `${n} items` : "";
}

function renderValueResults() {
  const list = $("value-results");
  const results = V.search(values, $("value-search").value, 8);
  list.replaceChildren();
  for (const v of results) {
    list.append(itemRow(v, [
      iconBtn("Give", "Add to “You give” in the trade calculator", () => calcAdd("give", v.id), "btn ghost small"),
      iconBtn("Get", "Add to “You get” in the trade calculator", () => calcAdd("get", v.id), "btn ghost small"),
      iconBtn("↗", "Open on Octane", () => openSite(`/catalog/${v.id}/item`)),
    ]));
  }
  if (!results.length && Object.keys(values).length) {
    list.append(el("li", { className: "empty-note", textContent: "// no limiteds match that" }));
  }
}

async function renderWorth() {
  const box = $("worth");
  const { viewer = null } = await ext.storage.local.get("viewer");
  if (!viewer || !Object.keys(values).length) { box.hidden = true; return; }
  box.hidden = false;
  try {
    worthCache ??= await S.fetchCollectibles(viewer.id);
    let value = 0, rap = 0;
    for (const it of worthCache) {
      const v = values[it.assetId];
      rap += it.rap;
      value += v ? v.value : it.rap;
    }
    const stat = (label, num) => el("div", {}, [el("span", { textContent: label }), el("b", { textContent: num })]);
    box.replaceChildren(
      el("div", { className: "cap", textContent: `${viewer.displayName || viewer.name}'s limiteds` }),
      stat("Items", V.fmt(worthCache.length)),
      stat("Value", V.fmt(value)),
      stat("RAP", V.fmt(rap)),
    );
  } catch (err) {
    box.replaceChildren(el("div", { className: "note-line", textContent: /403/.test(err.message) ? "Your inventory is private, so worth can't be counted." : `Couldn't load your limiteds (${err.message})` }));
  }
}

function wireValues() {
  $("value-search").addEventListener("input", renderValueResults);
}

// ---------- trade calculator ----------
const MAX_ITEMS = 4; // Octane trades hold up to 4 items a side

function calcTotals(side) {
  const ids = settings.calc[side] || [];
  const robux = Number(settings.calc[`${side}Robux`]) || 0;
  return V.offerTotals(ids.map((id) => ({ assetId: id, rap: values[id]?.rap || 0 })), V.afterFee(robux), values);
}

async function saveCalc(patch) {
  await update({ calc: { ...settings.calc, ...patch } });
  renderCalc();
}

async function calcAdd(side, id) {
  const list = [...(settings.calc[side] || [])];
  const label = side === "give" ? "You give" : "You get";
  const name = values[id]?.name || "Item";
  if (list.length >= MAX_ITEMS) {
    $("values-note").textContent = `“${label}” already has ${MAX_ITEMS} items.`;
    return;
  }
  list.push(id);
  await saveCalc({ [side]: list });
  $("values-note").textContent = `Added ${name} to “${label}”.`;
  const d = document.querySelector('details[data-key="calc"]');
  if (d && !d.open) d.open = true;
  d?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderCalc() {
  for (const side of ["give", "get"]) {
    const ul = $(`${side}-items`);
    ul.replaceChildren();
    (settings.calc[side] || []).forEach((id, idx) => {
      const v = values[id] || { id, name: `Item #${id}`, value: 0, rap: 0, demand: -1, trend: -1 };
      ul.append(itemRow(v, [iconBtn("×", "Remove", () => {
        const next = [...settings.calc[side]];
        next.splice(idx, 1);
        saveCalc({ [side]: next });
      })], true));
    });
    const t = calcTotals(side);
    $(`${side}-total`).textContent = t.count || t.robux ? `V ${V.fmt(t.value)} · RAP ${V.fmt(t.rap)}` : "";
    const robuxInput = document.querySelector(`.calc-robux[data-side="${side}"]`);
    if (document.activeElement !== robuxInput) robuxInput.value = settings.calc[`${side}Robux`] || "";
    document.querySelector(`.calc-add[data-side="${side}"]`).disabled = (settings.calc[side] || []).length >= MAX_ITEMS;
  }

  const give = calcTotals("give"), get = calcTotals("get");
  const vd = V.verdict(give, get);
  const box = $("calc-verdict");
  box.className = `calc-verdict ${vd.kind}`;
  if (vd.kind === "empty") {
    box.replaceChildren();
    $("calc-meta").textContent = "";
    return;
  }
  const sign = vd.diff > 0 ? "+" : vd.diff < 0 ? "−" : "±";
  const word = vd.kind === "win" ? "WIN" : vd.kind === "loss" ? "LOSS" : "FAIR";
  const pct = Number.isFinite(vd.pct) ? ` (${sign}${Math.abs(vd.pct).toFixed(1)}%)` : "";
  const warns = [];
  if (get.flags.projected.length) warns.push(`projected: ${get.flags.projected.join(", ")}`);
  if (get.flags.lowDemand.length) warns.push(`low demand: ${get.flags.lowDemand.join(", ")}`);
  box.replaceChildren(`${word} ${sign}${V.fmt(Math.abs(vd.diff))}${pct}`);
  if (warns.length) box.append(el("small", { textContent: `⚠ ${warns.join(" · ")}` }));
  $("calc-meta").textContent = `${word} ${sign}${Math.abs(vd.pct).toFixed(0)}%`;
}

function wireCalc() {
  for (const input of document.querySelectorAll(".calc-add")) {
    const side = input.dataset.side;
    const box = input.nextElementSibling;
    const show = () => {
      const q = input.value.trim();
      box.replaceChildren();
      if (!q) { box.hidden = true; return; }
      for (const v of V.search(values, q, 6)) {
        const b = el("button", { type: "button" }, [
          el("span", { textContent: v.name }),
          el("span", { textContent: v.valued ? `V ${V.fmt(v.value)}` : `R ${V.fmt(v.rap)}` }),
        ]);
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus for keyboard users
        b.addEventListener("click", () => {
          input.value = "";
          box.hidden = true;
          calcAdd(side, v.id);
        });
        box.append(b);
      }
      box.hidden = box.childElementCount === 0;
    };
    input.addEventListener("input", show);
    input.addEventListener("focus", show);
    input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") box.querySelector("button")?.click();
      if (e.key === "Escape") box.hidden = true;
    });
  }
  for (const input of document.querySelectorAll(".calc-robux")) {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d]/g, "").slice(0, 9);
      saveCalc({ [`${input.dataset.side}Robux`]: Number(input.value) || 0 });
    });
  }
  $("calc-clear").addEventListener("click", () => saveCalc({ give: [], get: [], giveRobux: 0, getRobux: 0 }));
}

// ---------- playtime ----------
// Counted by the background from your presence (see recordPlay there)
const PT_SHOWN = 8;
let ptAll = false;
const gameIcons = {};

function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return ms > 0 ? "<1m" : "0m";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(ts) {
  const days = Math.round((new Date(dayKey(Date.now())) - new Date(dayKey(ts))) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

async function renderPlaytime() {
  const { playtime = {}, viewer = null } = await ext.storage.local.get(["playtime", "viewer"]);
  const rec = viewer?.id ? playtime[viewer.id] : null;
  const now = Date.now();
  const list = $("pt-games");
  const games = Object.entries(rec?.games || {}).map(([universeId, g]) => ({ universeId, ...g }))
    .sort((a, b) => b.total - a.total || b.last - a.last);
  const today = rec?.days?.[dayKey(now)] || 0;
  let week = 0;
  const day = new Date(now);
  for (let i = 0; i < 7; i++) { // calendar days, so 23- and 25-hour days count once
    week += rec?.days?.[dayKey(day)] || 0;
    day.setDate(day.getDate() - 1);
  }
  const total = games.reduce((n, g) => n + g.total, 0);
  const cur = rec?.current && now - rec.current.last < 3 * 60 * 1000 ? rec.current : null;

  const nowBox = $("pt-now");
  nowBox.hidden = !cur;
  if (cur) {
    nowBox.replaceChildren(
      el("span", { className: "pt-dot" }),
      el("span", { className: "pt-now-text" }, ["Playing ", el("b", { textContent: cur.name }), ` · ${fmtDur(now - cur.start)}`]),
    );
  }
  const stat = (label, ms) => el("div", {}, [el("span", { textContent: label }), el("b", { textContent: fmtDur(ms) })]);
  $("pt-stats").replaceChildren(stat("Today", today), stat("Last 7 days", week), stat("All time", total));
  $("playtime-meta").textContent = cur ? "playing now" : today ? `${fmtDur(today)} today` : "";

  list.replaceChildren();
  for (const g of ptAll ? games : games.slice(0, PT_SHOWN)) {
    const thumb = el("div", { className: "item-thumb" });
    if (gameIcons[g.universeId]) thumb.style.backgroundImage = `url("${gameIcons[g.universeId]}")`;
    const row = el("li", { className: "item-row clickable", title: `Open ${g.name}` }, [
      thumb,
      el("div", { className: "item-text" }, [
        el("span", { className: "item-name" }, [el("span", { className: "item-name-text", textContent: g.name })]),
        el("span", { className: "item-sub", textContent: `${g.sessions} session${g.sessions === 1 ? "" : "s"} · ${cur?.universeId === g.universeId ? "playing now" : `last played ${daysAgo(g.last)}`}` }),
      ]),
      el("b", { className: "pt-time", textContent: fmtDur(g.total) }),
    ]);
    if (g.placeId) row.addEventListener("click", () => openSite(`/games/${g.placeId}/`));
    list.append(row);
  }
  if (games.length > PT_SHOWN) {
    const more = el("li", { className: "empty-note" }, [iconBtn(ptAll ? "Show fewer" : `Show all ${games.length}`, "", () => { ptAll = !ptAll; renderPlaytime(); }, "btn ghost small")]);
    list.append(more);
  }
  if (!games.length) {
    list.append(el("li", {
      className: "empty-note",
      textContent: !viewer?.id ? "// open octane.wtf while signed in, so Kerosene knows who you are"
        : !settings.trackPlaytime ? "// counting is off (Settings → Count playtime)"
        : "// play a game on Octane and it shows up here within a minute",
    }));
  }
  $("pt-note").textContent = games.length ? "Counted every minute while your browser is open." : "";
  $("pt-reset").hidden = !games.length;

  // icons for the games on show
  const missing = games.slice(0, ptAll ? 50 : PT_SHOWN).map((g) => g.universeId).filter((u) => !(u in gameIcons));
  if (missing.length) {
    for (const u of missing) gameIcons[u] = "";
    const icons = await S.fetchGameIcons(missing);
    if (Object.keys(icons).length) {
      Object.assign(gameIcons, icons);
      renderPlaytime();
    }
  }
}

function wirePlaytime() {
  const reset = $("pt-reset");
  let armed = null;
  reset.addEventListener("click", async () => {
    if (!armed) {
      reset.textContent = "Reset all playtime?";
      reset.classList.add("danger");
      armed = setTimeout(() => { armed = null; reset.textContent = "Reset"; reset.classList.remove("danger"); }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    reset.textContent = "Reset";
    reset.classList.remove("danger");
    const { viewer = null } = await ext.storage.local.get("viewer");
    if (viewer?.id) await ext.runtime.sendMessage({ type: "playtime-reset", userId: viewer.id }).catch(() => {});
    renderPlaytime();
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.playtime || changes.viewer)) renderPlaytime();
  });
  // the "playing now" clock
  setInterval(() => { if (!$("pt-now").hidden) renderPlaytime(); }, 30000);
}

// ---------- Supa Games perks ----------
// Themes, backgrounds, custom fonts, hide ads, price alerts and "can I afford
// it" alerts unlock for members of the Supa Games group on Octane.
async function renderPerks(justUnlocked = false) {
  const { groupAccess = null, viewer = null } = await ext.storage.local.get(["groupAccess", "viewer"]);
  const locked = !settings.perks;
  for (const d of document.querySelectorAll("details.drop[data-perk]")) {
    d.classList.toggle("locked", locked);
    d.querySelector(".perk-lock")?.remove();
    d.querySelector(".perk-pill")?.remove();
    if (justUnlocked) d.querySelector(".drop-body").prepend(el("div", { className: "perk-lock unlocked", textContent: "Unlocked. Thanks for joining Supa Games!" }));
    if (!locked) continue;
    d.querySelector("summary").append(el("span", { className: "perk-pill", textContent: "Supa Games" }));
    d.querySelector(".drop-body").prepend(lockCard(groupAccess, viewer));
  }
  for (const row of document.querySelectorAll(".row[data-perk]")) {
    row.classList.toggle("locked", locked);
    row.querySelector("input").disabled = locked;
    row.querySelector(".perk-pill")?.remove();
    if (locked) row.querySelector(".row-title").append(el("span", { className: "perk-pill", textContent: "Supa Games" }));
  }
}

function lockCard(access, viewer) {
  const card = el("div", { className: "perk-lock" });
  const title = el("div", { className: "perk-title", textContent: "Supa Games members only" });
  const text = el("p", { className: "perk-text" });
  const actions = el("div", { className: "inline" });
  if (!viewer?.id) {
    text.textContent = "Open octane.wtf while you're signed in, so Kerosene knows who you are.";
    actions.append(button("Open Octane", () => openSite("/home"), true));
  } else {
    text.textContent = "Themes, backgrounds, custom fonts, hide ads and price alerts are for members of the Supa Games group. Joining is free.";
    actions.append(
      button("Join Supa Games", () => ext.tabs.create({ url: S.GROUP.url }), true),
      button("I've joined", async (e) => {
        e.target.disabled = true;
        e.target.textContent = "Checking…";
        await refreshPerks(true);
        if (!settings.perks) {
          e.target.disabled = false;
          e.target.textContent = "I've joined";
          text.textContent = "Not in the group yet. Join it on Octane, then press this again.";
        }
      }),
    );
  }
  card.append(title, text, actions);
  return card;
}

// Ask the background to check membership (cached for a while unless forced)
async function refreshPerks(force = false) {
  const before = settings.perks;
  await ext.runtime.sendMessage({ type: "check-access", force }).catch(() => null);
  settings.perks = (await S.load()).perks;
  if (settings.perks !== before || force) renderPerks(settings.perks && !before);
}

// ---------- favourite games ----------
async function renderGames(refresh = false) {
  const bar = $("games-bar");
  const { viewer = null, favGames = null, playtime = {} } = await ext.storage.local.get(["viewer", "favGames", "playtime"]);
  const played = (viewer?.id && playtime[viewer.id]?.games) || {};
  const draw = (games) => {
    bar.replaceChildren();
    bar.hidden = !games.length;
    for (const g of games) {
      const icon = el("span", { className: "game-icon" });
      if (g.icon) icon.style.backgroundImage = `url("${g.icon}")`;
      const mine = played[g.universeId]?.total;
      const b = el("button", { className: "game", type: "button", title: `${g.name}${g.playing != null ? ` · ${g.playing} playing` : ""}${mine ? ` · you've played ${fmtDur(mine)}` : ""}` }, [
        icon,
        el("span", { className: "game-name", textContent: g.name }),
        el("span", { className: `game-count${g.playing ? " live" : ""}`, textContent: g.playing != null ? `${g.playing} playing` : "" }),
      ]);
      b.addEventListener("click", () => openSite(g.url));
      bar.append(b);
    }
  };
  if (favGames?.userId === viewer?.id && favGames?.games) draw(favGames.games);
  if (!viewer?.id) return;
  const stale = !favGames || favGames.userId !== viewer.id || Date.now() - favGames.at > 60 * 1000;
  if (!stale && !refresh) return;
  try {
    const games = await S.fetchFavoriteGames(viewer.id);
    const ids = games.map((g) => g.universeId);
    const [stats, icons] = await Promise.all([S.fetchGameStats(ids).catch(() => ({})), S.fetchGameIcons(ids)]);
    const full = games.map((g) => ({ ...g, playing: stats[g.universeId]?.playing ?? null, icon: icons[g.universeId] || "" }))
      .sort((a, b) => (b.playing || 0) - (a.playing || 0));
    await ext.storage.local.set({ favGames: { userId: viewer.id, games: full, at: Date.now() } });
    draw(full);
  } catch { /* keep the cached row */ }
}

// ---------- price alerts (Supa Games) ----------
let alertState = {}; // what the background last saw per item (priceAlertState)
function renderAlerts() {
  const list = $("alert-list");
  list.replaceChildren();
  const alerts = settings.priceAlerts || [];
  $("alerts-meta").textContent = alerts.length ? `${alerts.length} watching` : "";
  if (!alerts.length) {
    list.append(el("li", { className: "empty-note", textContent: "Nothing watched yet. Add a limited below." }));
    return;
  }
  for (const alert of alerts) {
    const a = { ...alert, ...(alertState[alert.assetId] || {}) };
    const v = values[a.assetId] || { id: a.assetId, name: a.name, value: 0, rap: 0, valued: false };
    const row = itemRow(v, [iconBtn("×", "Stop watching", () => saveAlerts(alerts.filter((x) => x.assetId !== a.assetId)))], true);
    const want = [a.max > 0 ? `≤ ${V.fmt(a.max)}` : "", a.belowValue ? "below value" : ""].filter(Boolean).join(" or ");
    const now = a.lowest != null ? ` · lowest now ${V.fmt(a.lowest)}` : a.checkedAt ? " · no sellers" : "";
    row.querySelector(".item-sub").textContent = `${want}${now}`;
    if (a.lowest != null && ((a.max > 0 && a.lowest <= a.max) || (a.belowValue && v.value && a.lowest < v.value))) row.classList.add("hit");
    list.append(row);
  }
}

async function saveAlerts(alerts) {
  await update({ priceAlerts: alerts });
  renderAlerts();
}

function wireAlerts() {
  const input = $("alert-add");
  const box = input.nextElementSibling;
  const add = (v) => {
    input.value = "";
    box.hidden = true;
    const max = Number($("alert-max").value.replace(/[^\d]/g, "")) || 0;
    const belowValue = $("alert-below").checked || !max;
    const alerts = (settings.priceAlerts || []).filter((a) => a.assetId !== v.id);
    alerts.unshift({ assetId: v.id, name: v.name, max, belowValue });
    $("alert-max").value = "";
    saveAlerts(alerts.slice(0, 20));
  };
  const show = () => {
    const q = input.value.trim();
    box.replaceChildren();
    if (!q) { box.hidden = true; return; }
    for (const v of V.search(values, q, 6)) {
      const b = el("button", { type: "button" }, [el("span", { textContent: v.name }), el("span", { textContent: v.valued ? `V ${V.fmt(v.value)}` : `R ${V.fmt(v.rap)}` })]);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => add(v));
      box.append(b);
    }
    box.hidden = box.childElementCount === 0;
  };
  input.addEventListener("input", show);
  input.addEventListener("focus", show);
  input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.querySelector("button")?.click();
    if (e.key === "Escape") box.hidden = true;
  });
  $("alert-max").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^\d]/g, "").slice(0, 9); });
  // the background records the latest prices as it checks
  ext.storage.local.get("priceAlertState").then(({ priceAlertState = {} }) => { alertState = priceAlertState; renderAlerts(); });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.priceAlertState) alertState = changes.priceAlertState.newValue || {};
    if (changes.priceAlerts) settings.priceAlerts = changes.priceAlerts.newValue || [];
    if (changes.priceAlertState || changes.priceAlerts) renderAlerts();
  });
}

// ---------- site access (Firefox can install without host access) ----------
const ORIGINS = ["https://octane.wtf/*", "https://*.octane.wtf/*", "https://octomons.wtf/*"];
async function checkAccess() {
  const ok = await ext.permissions.contains({ origins: ORIGINS }).catch(() => true);
  $("access-notice").hidden = ok;
  $("access-allow").onclick = async () => {
    if (await ext.permissions.request({ origins: ORIGINS })) {
      $("access-notice").hidden = true;
      ext.runtime.sendMessage({ type: "refresh-friends" });
      loadValues(true);
    }
  };
}

// ---------- update button ----------
function setUpdateState(state, label = "", title = "") {
  const b = $("update-btn");
  b.dataset.state = state;
  let span = b.querySelector(".label");
  if (!span) b.append(span = el("span", { className: "label" }));
  span.textContent = label;
  b.title = title || label || "Check for updates";
  b.setAttribute("aria-label", b.title);
}

// ---------- the update screen ----------
const screen = {
  el: () => $("update-screen"),
  show(from, to, title = "Updating Kerosene") {
    const s = this.el();
    s.hidden = false;
    s.classList.remove("done", "failed", "out");
    $("us-title").textContent = title;
    $("us-from").textContent = `v${from}  \u2192  v${to}`;
    $("us-to").textContent = `now on v${to}`;
    this.progress(null);
    this.actions();
  },
  // plain text; **this** comes out bold
  status(text) {
    $("us-status").replaceChildren(...String(text).split("**").map((part, i) => (i % 2 ? el("b", { textContent: part }) : part)));
  },
  // null = busy (indeterminate), 0..1 = known progress
  progress(f) {
    $("us-bar").classList.toggle("busy", f == null);
    $("us-bar-fill").style.width = f == null ? "" : `${Math.round(f * 100)}%`;
  },
  actions(...buttons) { $("us-actions").replaceChildren(...buttons); },
  fail(message, ...buttons) {
    this.el().classList.add("failed");
    $("us-title").textContent = "Update didn't finish";
    this.progress(0);
    this.status(message);
    this.actions(...buttons, button("Close", () => this.hide()));
    setUpdateState("error", "update failed", message);
  },
  hide() { this.el().hidden = true; },
};

function button(label, onClick, primary = false) {
  const b = el("button", { className: `btn small${primary ? "" : " ghost"}`, textContent: label });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One port to the background for the whole update (it reports progress)
function updatePort() {
  const port = ext.runtime.connect({ name: "kerosene-update" });
  const waiters = [];
  port.onMessage.addListener((m) => {
    if (m.type === "progress") return port.onProgress?.(m.loaded, m.total);
    const w = waiters.findIndex((x) => x.type === m.type || m.type === "error");
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
  });
  port.ask = (msg, expect) => new Promise((resolve) => { waiters.push({ type: expect, resolve }); port.postMessage(msg); });
  return port;
}

async function checkForUpdate() {
  const b = $("update-btn");
  if (b.dataset.state === "checking" || b.dataset.state === "updating") return;
  // Firefox only installs from a click, and a click "lasts" about 5 seconds
  const clickedAt = Date.now();
  setUpdateState("checking", "checking…");
  let info, error;
  try { info = await S.fetchLatestRelease(); } catch (err) { error = err; }
  // let the spin read as a check even on a fast connection
  await sleep(Math.max(0, 700 - (Date.now() - clickedAt)));
  const current = ext.runtime.getManifest().version;
  if (error) return setUpdateState("error", "couldn't check", `Couldn't check for updates: ${error.message}`);
  if (!S.newerVersion(info.version, current)) {
    return setUpdateState("latest", "up to date", `Kerosene ${current} is the latest version`);
  }
  setUpdateState("updating", "updating…", `Updating to ${info.version}${info.notes ? ` — ${info.notes}` : ""}`);
  screen.show(current, info.version);
  screen.status(info.notes || "Getting the new version…");

  const port = updatePort();
  const { kind } = await port.ask({ type: "kind" }, "kind");

  if (kind === "manual") {
    screen.el().classList.add("failed");
    $("us-title").textContent = `Kerosene ${info.version} is out`;
    screen.progress(0);
    screen.status("This copy was loaded by hand, so the browser can't replace it by itself. Download the new version and load it the same way.");
    screen.actions(
      button(`Download ${info.version}`, () => ext.tabs.create({ url: info.page || `https://github.com/${S.REPO}/releases/latest` }), true),
      button("Later", () => { screen.hide(); setUpdateState("updating", `get ${info.version}`); }),
    );
    return;
  }

  if (kind === "store") {
    screen.status("Your browser is fetching it from the web store…");
    const res = await port.ask({ type: "store" }, "store");
    if (res.status === "update_available") return screen.status("Installing… Kerosene restarts in a moment.");
    screen.fail(`Version ${info.version} isn't through the web store yet. Your browser will update Kerosene by itself once it is.`);
    return;
  }

  // Firefox / Zen: download the signed file, then hand it to Firefox
  screen.status("Downloading…");
  screen.progress(0);
  port.onProgress = (loaded, total) => {
    screen.progress(total ? loaded / total : null);
    screen.status(`Downloading… **${Math.round(loaded / 1024)}**${total ? ` / ${Math.round(total / 1024)}` : ""} KB`);
  };
  const [here] = await ext.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const origin = { tabId: here?.id ?? null, windowId: here?.windowId ?? null };
  const res = await port.ask({ type: "stage", info, origin }, "staged");
  if (res.type === "error") return screen.fail(res.error, button("Try again", () => { screen.hide(); setUpdateState("idle"); checkForUpdate(); }, true));
  screen.progress(1);

  const open = () => {
    port.postMessage({ type: "opening", info });
    const w = window.open(res.url, "kerosene-update", "popup,width=460,height=640");
    if (!w) return screen.fail("Firefox blocked the update window. Allow pop-ups for Kerosene and try again.");
    screen.progress(null);
    screen.status("Firefox opens a small Kerosene window and asks twice: **Continue to Installation**, then **Add**.");
  };
  if (Date.now() - clickedAt < 4500) return open();
  // took too long: Firefox wants a fresh click
  screen.status(`Downloaded **${Math.round(res.size / 1024)} KB**. One more click to install.`);
  screen.actions(button(`Install ${info.version}`, open, true));
}

// Opened right after an update: the screen picks up where the old version
// left off and refreshes into the new one.
async function renderJustUpdated() {
  const { justUpdated } = await ext.storage.local.get("justUpdated");
  if (!justUpdated || justUpdated.popupShown || Date.now() - justUpdated.at > 10 * 60 * 1000) return;
  // (left in storage for a little while: reloading Octane tabs read it too)
  ext.storage.local.set({ justUpdated: { ...justUpdated, popupShown: true } });
  setUpdateState("latest", `updated to ${justUpdated.to}`, `Updated from ${justUpdated.from} to ${justUpdated.to}`);
  if (!justUpdated.asked || Date.now() - justUpdated.at > 2 * 60 * 1000) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  screen.show(justUpdated.from, justUpdated.to, "Updating Kerosene");
  screen.status("Installed. Loading the new version…");
  screen.progress(null);
  // what's new in this version (the release notes), if they arrive quickly
  const notes = Promise.race([
    S.fetchLatestRelease().then((info) => (info.version === justUpdated.to ? info.notes : ""), () => ""),
    sleep(1500).then(() => ""),
  ]);
  await sleep(reduced ? 200 : 650);
  const whatsNew = String(await notes).replace(/\s*\(v[\d.]+\)\s*$/, "").trim();
  screen.progress(1);
  screen.el().classList.add("done");
  $("us-title").textContent = `Kerosene ${justUpdated.to}`;
  screen.status(whatsNew ? `**What's new:** ${whatsNew}` : "Updated and ready.");
  field?.ripple?.();
  await sleep(reduced ? 300 : whatsNew ? 2600 : 1300);
  document.body.classList.add("refreshed");
  screen.el().classList.add("out");
  await sleep(reduced ? 0 : 600);
  screen.hide();
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
      if (key === "trackPlaytime") renderPlaytime();
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
  if (IN_TAB) {
    document.body.classList.add("in-tab");
    const open = new URLSearchParams(location.search).get("open") || "backgrounds";
    settings.openSections = [...new Set([...settings.openSections, open])];
  }
  setAccent(settings.fieldColor);
  field = F.create($("field"), { color: settings.fieldColor, animate: settings.animatedBg });

  $("version").textContent = "v" + ext.runtime.getManifest().version;
  renderStatus();
  renderThemes();
  renderCssNotice();
  renderBackgrounds();
  wireBackgrounds();
  wireFonts();
  renderViewer();
  renderFriends();
  wireFriends();
  renderLinks();
  wireLookup();
  wireValues();
  wireCalc();
  renderCalc();
  checkAccess();
  loadValues();
  wireAlerts();
  renderAlerts();
  renderPerks();
  refreshPerks();
  renderGames();
  wirePlaytime();
  renderPlaytime();
  $("update-btn").addEventListener("click", checkForUpdate);
  renderJustUpdated();
  wireToggles();
  renderSwatches();
  wireSections();
}

init();
