// Kerosene admin dashboard. Only for dad's account (S.ADMIN_ID): Octane-wide
// and Supa Games analytics, members with favourite / ban, favourites, bans,
// activity and Octane's audit log. History comes from the background
// (pollAdmin, every 10 minutes); everything else is fetched live here.
// Bans go through the background, using dad's own Octane session, so Octane
// decides whether they're allowed.
const S = globalThis.KeroseneSettings;
const V = globalThis.KeroseneValues;
const C = globalThis.KeroseneCharts;

const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, children = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const c of [].concat(children)) if (c != null) n.append(c);
  return n;
};

const RANGE_KEY = "kerosene-admin-range";
const LIVE_EVERY = 60 * 1000;
const FEED_STEP = 60;

let viewer = null;
let range = 7 * 86400000;
let showMode = "all";
let feedShown = FEED_STEP;
const tableView = new Set();
let liveAt = 0;
const state = {
  group: null, roles: [], members: [], presence: {}, avatars: {}, games: {}, top: null,
  worth: null, audit: null, history: { players: [], members: [] }, events: [], bans: {}, favs: [], playtime: null,
};

// ---------- small helpers ----------
const fmt = (n) => V.fmt(n);
function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return ms > 0 ? "<1m" : "0m";
  const hrs = Math.floor(m / 60);
  return hrs ? `${hrs}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
const fmtMin = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeLabel(t, span, full = false) {
  const d = new Date(t);
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (full) return `${day}, ${hm}`;
  return span <= 36 * 3600000 ? hm : day;
}
function toast(text, isErr = false) {
  const t = $("toast");
  t.textContent = text;
  t.classList.toggle("err", isErr);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
}
const openSite = (path) => ext.tabs.create({ url: S.SITE + path });
const loadStore = (keys) => ext.storage.local.get(keys);
function note(id, text, cls = "") {
  const n = $(id);
  n.textContent = text;
  n.className = `note ${cls}`;
}

function avatar(id, label) {
  const img = h("img", { className: "avatar", alt: "", loading: "lazy", referrerPolicy: "no-referrer" });
  if (state.avatars[id]) img.src = state.avatars[id];
  img.title = label;
  return img;
}
function statusOf(id) {
  const p = state.presence[id];
  if (!p) return { cls: "offline", text: "Unknown" };
  if (p.status === "ingame") return { cls: "ingame", text: `Playing ${state.games[p.universeId]?.name || (p.location !== "a game" && p.location) || "an unlisted game"}` };
  if (p.status === "studio") return { cls: "online", text: "In Studio" };
  if (p.status === "online") return { cls: "online", text: "On the website" };
  return { cls: "offline", text: "Offline" };
}
const STATUS_ORDER = { ingame: 0, online: 1, offline: 2 };

// ---------- live data ----------
async function loadLive() {
  const tasks = [
    S.fetchGroupInfo(S.GROUP.id).then((g) => { state.group = g; state.groupAt = Date.now(); }),
    S.fetchGroupRoles(S.GROUP.id).then((r) => { state.roles = r; }),
    S.fetchGroupMembers(S.GROUP.id).then((m) => { state.members = m; }),
    S.fetchTopGames(100).then((games) => {
      const active = games.filter((g) => g.playing);
      state.top = { at: Date.now(), total: games.reduce((n, g) => n + g.playing, 0), count: active.length, games: active };
      for (const g of games) state.games[g.universeId] = { name: g.name, placeId: g.placeId };
    }),
  ];
  await Promise.allSettled(tasks);
  await loadPresence();
  liveAt = Date.now();
  renderAll();
  // slower, independent pieces
  loadAvatars();
  loadWorth();
  loadAudit();
}

async function loadPresence() {
  const ids = [...new Set([...state.members.map((m) => m.id), ...state.favs.map((f) => f.id)])];
  if (!ids.length) return;
  try {
    state.presence = await S.fetchPresence(ids);
  } catch { /* keep the last look */ }
  // names for the games people are in
  const missing = [...new Set(Object.values(state.presence).filter((p) => p.status === "ingame" && p.universeId && !state.games[p.universeId]).map((p) => p.universeId))];
  if (missing.length) {
    try {
      const stats = await S.fetchGameStats(missing);
      for (const [u, g] of Object.entries(stats)) state.games[u] = { name: g.name, placeId: g.placeId };
    } catch { /* names are cosmetic */ }
  }
}

async function loadAvatars() {
  const ids = [...new Set([...state.members.map((m) => m.id), ...state.favs.map((f) => f.id), ...Object.keys(state.bans).map(Number)])].filter((id) => !state.avatars[id]);
  if (!ids.length) return;
  Object.assign(state.avatars, await S.fetchHeadshots(ids));
  renderMembers();
  renderFavs();
  renderBans();
}

async function loadWorth() {
  try {
    const [vals, items] = await Promise.all([
      ext.runtime.sendMessage({ type: "get-values" }).catch(() => null),
      S.fetchCollectibles(viewer.id),
    ]);
    const values = vals?.items || {};
    let value = 0, rap = 0;
    for (const it of items) {
      rap += it.rap;
      value += values[it.assetId]?.value || it.rap;
    }
    state.worth = { value, rap, count: items.length };
  } catch (err) {
    state.worth = { error: err.status === 403 ? "private inventory" : String(err.message || err) };
  }
  renderKpis();
}

async function loadAudit() {
  try {
    state.audit = { rows: await S.fetchAuditLog(S.GROUP.id, 25) };
  } catch (err) {
    state.audit = { error: err.status ? `HTTP ${err.status}` : String(err.message || err) };
  }
  renderAudit();
}

async function loadStored() {
  const got = await loadStore({ adminHistory: null, adminTop: null, adminEvents: [], adminBans: {}, adminFavs: [], playtime: {}, adminTimers: {} });
  state.history = { players: got.adminHistory?.players || [], members: got.adminHistory?.members || [] };
  state.events = got.adminEvents;
  state.bans = got.adminBans;
  state.favs = got.adminFavs;
  state.playtime = got.playtime?.[viewer.id] || null;
  if (got.adminTop && (!state.top || got.adminTop.at > state.top.at)) state.top = got.adminTop;
  return got;
}

// ---------- rendering ----------
function renderAll() {
  renderKpis();
  renderHistory();
  renderTop();
  renderStatusNow();
  renderMembers();
  renderFavs();
  renderBans();
  renderPlaytime();
  renderFeed();
  renderUpdated();
}

function inRange(points) {
  const from = Date.now() - range;
  return points.filter((p) => p[0] >= from);
}

// the newest member count we know: live group info or the background's last look
function currentMemberCount() {
  const last = state.history.members.at(-1);
  if (state.group?.memberCount != null && (!last || (state.groupAt || 0) >= last[0])) return state.group.memberCount;
  if (last) return last[1];
  return state.members.length || null;
}

function kpi(label, value, foot, sparkPoints) {
  const footEl = h("div", { className: "kpi-foot" }, [foot]);
  if (sparkPoints) {
    const sp = h("span");
    C.spark(sp, sparkPoints);
    footEl.append(sp);
  }
  return h("div", { className: "kpi" }, [h("span", { className: "kpi-label", textContent: label }), h("b", { className: "kpi-value", textContent: value }), footEl]);
}

function renderKpis() {
  const box = $("kpis");
  const players = inRange(state.history.players);
  const peak = players.length ? Math.max(...players.map((p) => p[1])) : null;
  const playersNow = state.top?.total;
  const memberCount = currentMemberCount();
  const membersHist = inRange(state.history.members);
  const change = membersHist.length && memberCount != null ? memberCount - membersHist[0][1] : null;
  const rangeName = range === 86400000 ? "24 hours" : range === 7 * 86400000 ? "7 days" : "30 days";
  const changeEl = memberCount == null ? h("span", { textContent: liveAt ? "couldn't reach Octane" : "loading" })
    : change == null ? h("span", { textContent: "no history yet" })
    : h("span", { className: change > 0 ? "delta-up" : change < 0 ? "delta-down" : "", textContent: `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)} in ${rangeName}` });
  const pres = state.members.map((m) => state.presence[m.id]?.status);
  const inGame = pres.filter((s) => s === "ingame").length;
  const online = pres.filter((s) => s === "online" || s === "studio").length;
  const today = state.playtime?.days?.[dayKey(Date.now())] || 0;
  let week = 0;
  const d = new Date();
  for (let i = 0; i < 7; i++) { week += state.playtime?.days?.[dayKey(d)] || 0; d.setDate(d.getDate() - 1); }
  const w = state.worth;
  box.replaceChildren(
    kpi("Players on Octane now", playersNow == null ? "—" : fmt(playersNow), h("span", { textContent: peak == null ? "collecting" : `peak ${fmt(peak)}`, title: `highest in the last ${rangeName}` }), players.slice(-144)),
    kpi("Supa Games members", memberCount == null ? "—" : fmt(memberCount), changeEl),
    kpi("Members online", fmt(inGame + online), h("span", { textContent: `${inGame} in a game` })),
    kpi("Your playtime today", fmtDur(today), h("span", { textContent: `${fmtDur(week)} in 7 days` })),
    kpi("Your limiteds", w?.value != null ? fmt(w.value) : w?.error ? "—" : "…", h("span", { textContent: w?.value != null ? `RAP ${fmt(w.rap)} · ${w.count} items` : w?.error || "loading" })),
    kpi("Banned", String(Object.keys(state.bans).length), h("span", { textContent: "kept out of Supa Games" })),
  );
}

function renderHistory() {
  const players = inRange(state.history.players);
  const members = inRange(state.history.members);
  // the group's size from the live look, when it's newer than the last stored point
  const last = members.at(-1);
  if (state.group?.memberCount != null && state.groupAt && (!last || state.groupAt - last[0] > 60000)) members.push([state.groupAt, state.group.memberCount]);
  drawOrTable("players", $("c-players"), () => C.line($("c-players"), { points: players, timeLabel }), ["Time", "Players"], players.map((p) => [timeLabel(p[0], 0, true), p[1]]));
  drawOrTable("members", $("c-members"), () => C.line($("c-members"), { points: members, timeLabel, gap: Infinity }), ["Time", "Members"], members.map((p) => [timeLabel(p[0], 0, true), p[1]]));
}

function drawOrTable(key, host, draw, headers, rows) {
  if (tableView.has(key)) {
    host.replaceChildren(h("div", { className: "table-scroll" }, C.table(headers, [...rows].reverse())));
  } else {
    draw();
  }
}

function renderTop() {
  const games = (state.top?.games || []).slice(0, 10);
  $("top-sub").textContent = state.top ? `${fmt(state.top.total)} players in ${state.top.count ?? state.top.games.length} games` : "Players in each game";
  C.bars($("c-top"), {
    rows: games.map((g) => ({ label: g.name, value: g.playing, onClick: () => openSite(`/games/${g.placeId}/`) })),
    empty: "Nobody is in a game right now.",
  });
}

function renderStatusNow() {
  const pres = state.members.map((m) => state.presence[m.id]?.status);
  const inGame = pres.filter((s) => s === "ingame").length;
  const online = pres.filter((s) => s === "online" || s === "studio").length;
  C.stacked($("c-status"), { parts: [
    { label: "in a game", value: inGame, cls: "ingame" },
    { label: "on the website", value: online, cls: "online" },
    { label: "offline", value: state.members.length - inGame - online, cls: "offline" },
  ] });
  const byGame = {};
  for (const m of state.members) {
    const p = state.presence[m.id];
    if (p?.status !== "ingame") continue;
    const key = p.universeId || p.location;
    byGame[key] ??= { label: state.games[p.universeId]?.name || (p.location !== "a game" && p.location) || "Unlisted game", value: 0, placeId: state.games[p.universeId]?.placeId || p.placeId, who: [] };
    byGame[key].value++;
    byGame[key].who.push(m.displayName);
  }
  C.bars($("c-member-games"), {
    rows: Object.values(byGame).sort((a, b) => b.value - a.value).slice(0, 8).map((g) => ({
      label: g.label, value: g.value, sub: g.who.slice(0, 5).join(", "), onClick: g.placeId ? () => openSite(`/games/${g.placeId}/`) : null,
    })),
    empty: "No members are in a game right now.",
  });
}

// ---------- members ----------
function isFav(id) { return state.favs.some((f) => f.id === id); }
async function toggleFav(user) {
  const { adminFavs = [] } = await loadStore("adminFavs");
  const next = adminFavs.some((f) => f.id === user.id) ? adminFavs.filter((f) => f.id !== user.id) : [...adminFavs, { id: user.id, name: user.name, displayName: user.displayName || user.name, at: Date.now() }];
  await ext.storage.local.set({ adminFavs: next });
}

let confirming = null; // user id whose ban is being confirmed
const banning = new Set(); // bans waiting for the background's answer
function closeConfirm() { confirming = null; }
function renderMembers() {
  const q = $("m-search").value.trim().toLowerCase();
  const sort = $("m-sort").value;
  let rows = state.members.map((m) => ({ ...m, p: state.presence[m.id], st: statusOf(m.id) }));
  const total = rows.length;
  if (q) rows = rows.filter((m) => `${m.displayName} ${m.name} ${m.id}`.toLowerCase().includes(q));
  if (showMode === "ingame") rows = rows.filter((m) => m.st.cls === "ingame");
  if (showMode === "online") rows = rows.filter((m) => m.st.cls !== "offline");
  if (showMode === "fav") rows = rows.filter((m) => isFav(m.id));
  const byName = (a, b) => a.displayName.localeCompare(b.displayName);
  const sorts = {
    status: (a, b) => STATUS_ORDER[a.st.cls] - STATUS_ORDER[b.st.cls] || (b.p?.lastOnline || 0) - (a.p?.lastOnline || 0) || byName(a, b),
    rank: (a, b) => b.rank - a.rank || byName(a, b),
    name: byName,
    seen: (a, b) => (b.st.cls !== "offline") - (a.st.cls !== "offline") || (b.p?.lastOnline || 0) - (a.p?.lastOnline || 0),
  };
  rows.sort(sorts[sort] || sorts.status);
  $("members-sub").textContent = `${total} members${rows.length !== total ? ` · ${rows.length} shown` : ""}`;

  const body = $("m-rows");
  const keep = focusKey(body);
  body.replaceChildren();
  for (const m of rows) {
    const fav = isFav(m.id);
    const star = h("button", { className: "star", type: "button", textContent: "★", ariaLabel: `${fav ? "Unfavourite" : "Favourite"} ${m.displayName}` });
    star.dataset.uid = m.id; star.dataset.act = "star";
    star.setAttribute("aria-pressed", String(fav));
    star.addEventListener("click", () => toggleFav(m));
    const who = h("div", { className: "who" }, [
      avatar(m.id, m.displayName),
      h("div", {}, [
        h("b", {}, [m.displayName, state.bans[m.id] ? h("span", { className: "tag-banned", textContent: "BANNED" }) : null]),
        h("span", { textContent: `@${m.name} · #${m.id}` }),
      ]),
    ]);
    const seen = m.st.cls !== "offline" ? "now" : timeAgo(m.p?.lastOnline);
    const tr = h("tr", {}, [
      h("td", {}, star),
      h("td", {}, who),
      h("td", { className: "rank", textContent: m.role || "" }),
      h("td", {}, h("span", { className: `status ${m.st.cls}`, textContent: m.st.text })),
      h("td", { className: "seen", textContent: seen, title: m.p?.lastOnline ? new Date(m.p.lastOnline).toLocaleString() : "" }),
      h("td", { className: "c-act" }, rowActions(m)),
    ]);
    if (confirming === m.id) tr.className = "confirm";
    body.append(tr);
  }
  if (!rows.length) body.append(h("tr", {}, h("td", { colSpan: 6, className: "empty", textContent: total ? "Nobody matches." : "Loading members…" })));
  restoreFocus(body, keep);
}

// re-renders replace the rows; put keyboard focus back on the same control
function focusKey(container) {
  const a = document.activeElement;
  return a && container.contains(a) && a.dataset.uid ? { uid: a.dataset.uid, act: a.dataset.act } : null;
}
function restoreFocus(container, key) {
  if (key) container.querySelector(`[data-uid="${key.uid}"][data-act="${key.act}"]`)?.focus();
}

function rowActions(m) {
  const box = h("div", { className: "row-actions" });
  const profile = h("button", { className: "btn ghost small", type: "button", textContent: "Profile ↗" });
  profile.dataset.uid = m.id; profile.dataset.act = "profile";
  profile.addEventListener("click", () => openSite(`/users/${m.id}/profile`));
  if (m.id === S.ADMIN_ID) {
    box.append(profile);
    return box;
  }
  if (confirming === m.id || banning.has(m.id)) {
    const busy = banning.has(m.id);
    const yes = h("button", { className: "btn danger small", type: "button", textContent: busy ? "Banning…" : "Ban", disabled: busy });
    const no = h("button", { className: "btn ghost small", type: "button", textContent: "Cancel", disabled: busy });
    yes.dataset.uid = m.id; yes.dataset.act = "confirm";
    no.dataset.uid = m.id; no.dataset.act = "cancel";
    yes.addEventListener("click", () => doBan(m.id, m.displayName));
    no.addEventListener("click", () => { closeConfirm(); renderMembers(); });
    box.append(h("div", { className: "confirm-box" }, [h("span", { textContent: `Ban ${m.displayName}? They're removed from Supa Games and kept out.` }), yes, no]));
    return box;
  }
  if (state.bans[m.id]) {
    const unban = h("button", { className: "btn ghost small", type: "button", textContent: "Unban" });
    unban.dataset.uid = m.id; unban.dataset.act = "unban";
    unban.addEventListener("click", () => doUnban(m.id, m.displayName));
    box.append(profile, unban);
  } else {
    const ban = h("button", { className: "btn danger small", type: "button", textContent: "Ban" });
    ban.dataset.uid = m.id; ban.dataset.act = "ban";
    ban.addEventListener("click", () => {
      confirming = m.id;
      renderMembers();
      // focus moves to the confirm once, when it opens (never on later re-renders)
      $("m-rows").querySelector(`[data-uid="${m.id}"][data-act="cancel"]`)?.focus();
    });
    box.append(profile, ban);
  }
  return box;
}

async function doBan(id, name) {
  if (banning.has(id)) return;
  banning.add(id);
  renderMembers();
  let res;
  try {
    res = await ext.runtime.sendMessage({ type: "admin-ban", userId: id, name }).catch((err) => ({ error: String(err?.message || err) }));
  } finally {
    banning.delete(id);
    if (confirming === id) closeConfirm();
  }
  if (res?.removed) {
    toast(`Banned ${name}. They're out of Supa Games.`);
    state.members = state.members.filter((m) => m.id !== id);
  } else if (res && "kickError" in res) {
    toast(`Banned ${name}, but Octane didn't remove them from the group (${res.kickError || "no reason given"}). Kerosene tries again every 10 minutes.`, true);
  } else {
    toast(`Couldn't ban ${name}: ${res?.error || "no answer from Kerosene"}`, true);
  }
  await refreshStored();
}

async function doUnban(id, name) {
  const res = await ext.runtime.sendMessage({ type: "admin-unban", userId: id }).catch((err) => ({ error: String(err?.message || err) }));
  if (res?.error) toast(`Couldn't unban ${name}: ${res.error}`, true);
  else toast(`Unbanned ${name}. They can join Supa Games again.`);
  await refreshStored();
}

// ---------- favourites & bans ----------
function personRow(user, extra = [], sub = null) {
  const st = statusOf(user.id);
  const p = state.presence[user.id];
  const line = sub ?? `${st.text}${st.cls === "offline" && p?.lastOnline ? ` · ${timeAgo(p.lastOnline)}` : ""}`;
  return h("li", {}, [
    h("div", { className: "who" }, [
      avatar(user.id, user.displayName || user.name),
      h("div", {}, [h("b", { textContent: user.displayName || user.name }), h("span", { className: sub ? "" : `status ${st.cls}`, textContent: line })]),
    ]),
    ...extra,
  ]);
}

function renderFavs() {
  const list = $("fav-list");
  const keep = focusKey(list);
  list.replaceChildren();
  for (const f of state.favs) {
    const p = state.presence[f.id];
    const extra = [];
    if (p?.status === "ingame" && (state.games[p.universeId]?.placeId || p.placeId)) {
      const join = h("button", { className: "btn small", type: "button", textContent: "Join" });
      join.addEventListener("click", () => openSite(`/games/${state.games[p.universeId]?.placeId || p.placeId}/`));
      extra.push(join);
    }
    const profile = h("button", { className: "btn ghost small", type: "button", textContent: "Profile ↗" });
    profile.dataset.uid = f.id; profile.dataset.act = "profile";
    profile.addEventListener("click", () => openSite(`/users/${f.id}/profile`));
    const star = h("button", { className: "star", type: "button", textContent: "★", ariaLabel: `Unfavourite ${f.displayName || f.name}` });
    star.dataset.uid = f.id; star.dataset.act = "star";
    star.setAttribute("aria-pressed", "true");
    star.addEventListener("click", () => toggleFav(f));
    list.append(personRow(f, [...extra, profile, star]));
  }
  if (!state.favs.length) list.append(h("li", { className: "empty", textContent: "Star someone in the members list, or add anyone by username." }));
  restoreFocus(list, keep);
}

function renderBans() {
  const list = $("ban-list");
  list.replaceChildren();
  const bans = Object.entries(state.bans).sort((a, b) => b[1].at - a[1].at);
  for (const [id, b] of bans) {
    const unban = h("button", { className: "btn ghost small", type: "button", textContent: "Unban" });
    unban.addEventListener("click", () => doUnban(Number(id), b.name));
    list.append(personRow({ id: Number(id), displayName: b.name }, [unban], `banned ${timeAgo(b.at)}`));
  }
  if (!bans.length) list.append(h("li", { className: "empty", textContent: "Nobody is banned." }));
}

// ---------- playtime, activity, audit ----------
function renderPlaytime() {
  const rows = [];
  const d = new Date();
  d.setDate(d.getDate() - 13);
  for (let i = 0; i < 14; i++) {
    const ms = state.playtime?.days?.[dayKey(d)] || 0;
    rows.push({
      label: i === 13 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" }),
      title: d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }),
      value: ms / 60000,
    });
    d.setDate(d.getDate() + 1);
  }
  if (!tableView.has("playtime") && rows.every((r) => !r.value)) {
    $("c-playtime").replaceChildren(h("p", { className: "empty", textContent: "No playtime counted yet. It's counted every minute while you're in a game and your browser is open." }));
    return;
  }
  const maxI = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
  drawOrTable("playtime", $("c-playtime"), () => C.columns($("c-playtime"), { rows, format: fmtMin, valueFormat: (m) => fmtDur(m * 60000), labelled: [...new Set([maxI, 13])], steps: [5, 10, 15, 30, 60, 90, 120, 180, 240, 360, 480, 720] }),
    ["Day", "Playtime"], [...rows].reverse().map((r) => [r.title, fmtDur(r.value * 60000)]));
}

const KINDS = { join: "Joined", leave: "Left", ban: "Banned", unban: "Unbanned", rekick: "Kicked again", "kick-failed": "Kick failed" };
function renderFeed() {
  const list = $("feed");
  list.replaceChildren();
  const events = [...state.events].reverse();
  for (const e of events.slice(0, feedShown)) {
    const what = h("span", { className: "what" }, [h("b", { textContent: e.name || `#${e.userId}` })]);
    if (e.type === "rekick") what.append(" rejoined while banned and was removed");
    if (e.detail) what.append(` · ${e.detail}`);
    list.append(h("li", {}, [
      h("span", { className: `kind ${e.type}`, textContent: KINDS[e.type] || e.type }),
      what,
      h("time", { textContent: timeAgo(e.t), title: new Date(e.t).toLocaleString(), dateTime: new Date(e.t).toISOString() }),
    ]));
  }
  if (events.length > feedShown) {
    const more = h("button", { className: "btn ghost small more", type: "button", textContent: `Show more (${events.length - feedShown})` });
    more.addEventListener("click", () => { feedShown += FEED_STEP; renderFeed(); });
    list.append(h("li", {}, more));
  }
  if (!events.length) list.append(h("li", { className: "empty", textContent: "Nothing yet. Joins and leaves show up here from the second check on (every 10 minutes)." }));
}

function renderAudit() {
  const list = $("audit");
  list.replaceChildren();
  if (!state.audit) return list.append(h("li", { className: "empty", textContent: "Loading…" }));
  if (state.audit.error) return list.append(h("li", { className: "empty", textContent: `Octane didn't let Kerosene read the audit log (${state.audit.error}).` }));
  for (const e of state.audit.rows) {
    const actor = e.actor?.user?.displayName || e.actor?.user?.username || e.actor?.user?.name || "someone";
    const bits = e.description && typeof e.description === "object"
      ? Object.entries(e.description).filter(([k, v]) => (typeof v === "string" || typeof v === "number") && !/id$/i.test(k)).map(([, v]) => String(v)).slice(0, 3)
      : [];
    const what = h("span", { className: "what" }, [h("b", { textContent: actor }), ` ${String(e.actionType || "changed something").toLowerCase()}`]);
    if (bits.length) what.append(` · ${bits.join(" · ")}`);
    const t = Date.parse(e.created) || 0;
    list.append(h("li", {}, [
      h("span", { className: "kind", textContent: e.actor?.role?.name || "" }),
      what,
      h("time", { textContent: t ? timeAgo(t) : "", title: t ? new Date(t).toLocaleString() : "" }),
    ]));
  }
  if (!state.audit.rows.length) list.append(h("li", { className: "empty", textContent: "No changes recorded yet." }));
}

function renderUpdated() {
  $("updated").textContent = liveAt ? `Updated ${timeAgo(liveAt)}` : "";
}

// ---------- wiring ----------
async function refreshStored() {
  await loadStored();
  renderAll();
}

function setRange(ms) {
  range = ms;
  try { localStorage.setItem(RANGE_KEY, String(ms)); } catch { /* fine */ }
  for (const c of document.querySelectorAll("[data-range]")) c.setAttribute("aria-pressed", String(Number(c.dataset.range) === ms));
  renderKpis();
  renderHistory();
}

function wire() {
  for (const c of document.querySelectorAll("[data-range]")) c.addEventListener("click", () => setRange(Number(c.dataset.range)));
  for (const c of document.querySelectorAll("[data-show]")) {
    c.addEventListener("click", () => {
      showMode = c.dataset.show;
      closeConfirm();
      for (const x of document.querySelectorAll("[data-show]")) x.setAttribute("aria-pressed", String(x === c));
      renderMembers();
    });
  }
  document.querySelector('[data-show="all"]').setAttribute("aria-pressed", "true");
  $("m-search").addEventListener("input", () => { closeConfirm(); renderMembers(); });
  $("m-sort").addEventListener("change", () => { closeConfirm(); renderMembers(); });
  $("m-rows").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirming != null && !banning.has(confirming)) {
      const id = confirming;
      closeConfirm();
      renderMembers();
      $("m-rows").querySelector(`[data-uid="${id}"][data-act="ban"]`)?.focus();
    }
  });
  for (const b of document.querySelectorAll("[data-table]")) {
    b.addEventListener("click", () => {
      const key = b.dataset.table;
      if (tableView.has(key)) tableView.delete(key); else tableView.add(key);
      b.textContent = tableView.has(key) ? "Chart" : "Table";
      if (key === "playtime") renderPlaytime(); else renderHistory();
    });
  }
  $("refresh").addEventListener("click", async () => {
    const btn = $("refresh");
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    await ext.runtime.sendMessage({ type: "admin-refresh" }).catch(() => null);
    await loadStored();
    await loadLive();
    btn.disabled = false;
    btn.textContent = "Refresh";
  });

  $("fav-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("fav-input");
    note("fav-note", "Looking up…");
    try {
      const user = await S.resolveUser(input.value);
      if (isFav(user.id)) throw new Error(`${user.name} is already a favourite`);
      await toggleFav(user);
      input.value = "";
      note("fav-note", `Added ${user.name}.`, "ok");
      loadPresence().then(renderFavs);
      loadAvatars();
    } catch (err) {
      note("fav-note", String(err.message || err), "err");
    }
  });

  let pendingBan = null;
  $("ban-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("ban-input");
    note("ban-note", "Looking up…");
    try {
      const user = await S.resolveUser(input.value);
      if (user.id === S.ADMIN_ID) throw new Error("You can't ban yourself");
      if (state.bans[user.id]) throw new Error(`${user.name} is already banned`);
      pendingBan = user;
      const n = $("ban-note");
      n.className = "note";
      const yes = h("button", { className: "btn danger small", type: "button", textContent: `Ban ${user.name}` });
      const no = h("button", { className: "btn ghost small", type: "button", textContent: "Cancel" });
      yes.addEventListener("click", async () => {
        await doBan(pendingBan.id, pendingBan.displayName || pendingBan.name, yes);
        pendingBan = null;
        input.value = "";
        note("ban-note", "");
      });
      no.addEventListener("click", () => { pendingBan = null; note("ban-note", ""); });
      n.replaceChildren(h("span", { className: "confirm-box" }, [h("span", { textContent: `Ban ${user.name} (#${user.id})? They're removed from Supa Games and kept out.` }), yes, no]));
    } catch (err) {
      note("ban-note", String(err.message || err), "err");
    }
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.viewer && !S.isAdmin(changes.viewer.newValue)) location.reload();
    const keys = Object.keys(changes);
    if (keys.length === 1 && keys[0] === "playtime") {
      state.playtime = changes.playtime.newValue?.[viewer.id] || null;
      renderKpis();
      renderPlaytime();
      return;
    }
    if (["adminHistory", "adminTop", "adminEvents", "adminBans", "adminFavs", "playtime"].some((k) => k in changes)) {
      const favsChanged = "adminFavs" in changes;
      refreshStored().then(() => {
        if (favsChanged) loadPresence().then(() => { renderFavs(); renderMembers(); loadAvatars(); });
      });
    }
  });

  // live statuses every minute while the tab is visible
  setInterval(async () => {
    renderUpdated();
    if (document.hidden || Date.now() - liveAt < LIVE_EVERY) return;
    await loadPresence();
    liveAt = Date.now();
    renderKpis();
    renderStatusNow();
    renderMembers();
    renderFavs();
    renderUpdated();
  }, 15000);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { renderHistory(); renderPlaytime(); }, 150);
  });
}

async function init() {
  ({ viewer = null } = await loadStore("viewer"));
  if (!S.isAdmin(viewer)) {
    $("whoami").textContent = viewer ? `signed in as ${viewer.displayName || viewer.name}` : "not signed in";
    $("denied-text").textContent = viewer
      ? "This page only works for dad's Octane account."
      : "Open octane.wtf while you're signed in, so Kerosene knows who you are.";
    $("denied").hidden = false;
    $("refresh").hidden = true;
    return;
  }
  $("whoami").textContent = `signed in as ${viewer.displayName || viewer.name} · owner of Supa Games`;
  try {
    const saved = Number(localStorage.getItem(RANGE_KEY));
    if ([86400000, 7 * 86400000, 30 * 86400000].includes(saved)) range = saved;
  } catch { /* fine */ }
  $("dash").hidden = false;
  wire();
  setRange(range);
  const got = await loadStored();
  renderAll();
  // a fresh sample if the last one is old (the background does this every 10 minutes)
  if (Date.now() - (got.adminTimers?.at || 0) > 10 * 60 * 1000) ext.runtime.sendMessage({ type: "admin-refresh" }).catch(() => {});
  await loadLive();
}

init();
