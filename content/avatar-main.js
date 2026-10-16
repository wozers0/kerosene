// Kerosene Sandbox: try on anything in Octane's catalog inside the avatar
// editor, save outfits locally and see what they would cost you.
//
// Runs in the page's own JS world (a "world": "MAIN" content script) inside
// the /theme2020/avatar iframe. The editor is an AngularJS app, so the tab,
// its dropdown, the item cards and the thumbnails are built with the page's
// own $compile and components and look native. Storage lives in the
// extension: content/avatar-sandbox.js relays it over DOM events.
(() => {
  if (!/^\/theme2020\/avatar\/?$/i.test(location.pathname) || window.__keroseneSandbox) return;
  window.__keroseneSandbox = true;

  const API = "/apisite";
  const TAB = "Sandbox";

  // ---------- categories ----------
  // Octane's catalog filters by numeric asset type via `subcategory`.
  const ROWS = [
    { title: "Sandbox", menus: [["Current", "Current Outfit"], ["Saved", "Saved Outfits"]] },
    { title: "Accessories", menus: [["Hats", "Hats", 8], ["Hair", "Hair", 41], ["Face", "Face", 42], ["Neck", "Neck", 43],
      ["Shoulder", "Shoulder", 44], ["Front", "Front", 45], ["Back", "Back", 46], ["Waist", "Waist", 47]] },
    { title: "Clothing", menus: [["Shirts", "Shirts", 11], ["Pants", "Pants", 12], ["TShirts", "T-Shirts", 2]] },
    { title: "Body", menus: [["Faces", "Faces", 18], ["Heads", "Heads", 17], ["Packages", "Packages", 32]] },
    { title: "Other", menus: [["Gear", "Gear", 19], ["Emotes", "Emotes", 61]] },
  ];
  const TYPE_NAMES = {};
  for (const row of ROWS) for (const [, label, type] of row.menus) if (type) TYPE_NAMES[type] = label;
  // How many of each type an avatar can wear at once (Roblox 2021 rules)
  const LIMITS = { 8: 3, 61: 8 };
  const limitOf = (type) => LIMITS[type] || 1;
  // Try-on renders the item on your own avatar; these types have nothing to show
  const NO_TRY_ON = new Set([32, 61]);

  const SORTS = [
    { v: 0, label: "Newest" },
    { v: 4, label: "Price (low to high)" },
    { v: 5, label: "Price (high to low)" },
    { v: 1, label: "Most favorited" },
    { v: 3, label: "Recently updated" },
  ];
  const PAGE = 30;

  // ---------- bridge to the extension (content/avatar-sandbox.js) ----------
  let seq = 0;
  const waiting = new Map();
  function call(op, data, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      // strings cross the world boundary cleanly (Firefox Xray wrappers)
      document.dispatchEvent(new CustomEvent("kerosene:sandbox-req", { detail: JSON.stringify({ id, op, data }) }));
      setTimeout(() => { if (waiting.delete(id)) reject(new Error("timeout")); }, timeout);
    });
  }
  document.addEventListener("kerosene:sandbox-res", (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    const p = waiting.get(msg.id);
    if (!p) return;
    waiting.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || "failed"));
  });

  // ---------- Octane API ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A burst of requests sometimes gets a bare nginx 403 page; it clears in ~15 s
  const throttled = (r) => r.status === 403 && !(r.headers.get("content-type") || "").includes("json");

  // Two requests at a time, spaced out, so the sandbox doesn't trip the limit
  let active = 0;
  const queue = [];
  function slot() {
    return new Promise((resolve) => {
      queue.push(resolve);
      pump();
    });
  }
  function pump() {
    while (active < 2 && queue.length) {
      active++;
      queue.shift()();
    }
  }
  function release() {
    setTimeout(() => { active--; pump(); }, 150);
  }

  async function request(path, init = {}) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      let r;
      try {
        r = await fetch(API + path, { credentials: "include", ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
      } finally {
        release();
      }
      if (throttled(r) && attempt < 3) { await sleep([3000, 8000, 16000][attempt]); continue; }
      return r;
    }
  }

  async function getJson(path) {
    const r = await request(path);
    if (!r.ok) throw Object.assign(new Error(throttled(r) ? "Octane is rate limiting, try again in a moment" : `HTTP ${r.status}`), { status: r.status });
    return r.json();
  }

  // Writes need Roblox-style CSRF: the first POST answers 403 with a token
  let csrf = "";
  async function postJson(path, body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      const token = r.headers.get("x-csrf-token");
      if (r.status === 403 && token && token !== csrf) { csrf = token; continue; }
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r.json();
    }
    throw new Error("CSRF check failed");
  }

  // Full catalog rows for up to 100 ids per call (order isn't preserved)
  async function details(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const res = await postJson("/catalog/v1/catalog/items/details", { items: chunk.map((id) => ({ itemType: "Asset", id })) });
      out.push(...(res.data || []));
    }
    return out;
  }

  // What it costs to get an item right now. Off-sale items keep their old
  // list price in `price`, so isForSale and the resale price decide.
  function priceOf(d) {
    const limited = (d.itemRestrictions || []).some((r) => r === "Limited" || r === "LimitedUnique");
    const options = [];
    if (d.isForSale && d.priceStatus === "Free") options.push(0);
    else if (d.isForSale && d.price != null) options.push(d.price);
    if (limited && d.lowestPrice != null) options.push(d.lowestPrice);
    if (options.length) {
      const robux = Math.min(...options);
      const resale = limited && d.lowestPrice === robux && !(d.isForSale && d.price === robux);
      return { kind: robux === 0 ? "free" : resale ? "resale" : "robux", robux };
    }
    if (d.isForSale && d.priceTickets != null) return { kind: "tix", tix: d.priceTickets };
    return { kind: limited ? "nosellers" : "offsale" };
  }

  const slug = (name) => String(name || "item").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "item";

  function normalize(d) {
    const r = d.itemRestrictions || [];
    return {
      id: d.id,
      name: d.name || `Item ${d.id}`,
      type: Number(d.assetType?.id ?? d.assetType) || 0,
      restriction: r.includes("LimitedUnique") ? "limited-unique" : r.includes("Limited") ? "limited" : "",
      price: priceOf(d),
      slug: slug(d.name),
    };
  }
  const approved = (d) => !d.moderationStatus || d.moderationStatus === "ReviewApproved";

  // ---------- state ----------
  const params = new URLSearchParams(location.search);
  const sb = {
    ready: false,
    viewerId: Number(params.get("userId") || params.get("viewerId")) || 0,
    rows: ROWS,
    sorts: SORTS,
    view: "browse", // browse | current | saved
    menu: null,
    q: { keyword: "", sort: 0, hideOffsale: false },
    items: [],
    cursor: "0",
    loading: false,
    error: "",
    balance: null, // {robux, tickets}
    owned: null, // Set of asset ids
    ownedComplete: false, // the whole inventory loaded (no per-item checks needed)
    draft: { id: null, name: "", items: [] },
    dirty: false,
    outfits: [],
    focused: null,
    preview: { is3d: false, url: "", loading: false, failed: false, target3d: "" },
    renaming: null,
    confirmDelete: null,
    menuFor: null,
  };
  const known = new Map(); // id -> latest normalized item
  let scope = null;
  let gen = 0;

  const apply = () => scope && scope.$applyAsync();

  function remember(it) {
    known.set(it.id, it);
    return it;
  }
  // The freshest copy of an item we've seen (saved outfits keep a snapshot)
  const fresh = (it) => known.get(it.id) || it;
  const snapshot = (it) => ({ id: it.id, name: it.name, type: it.type, restriction: it.restriction, price: it.price, slug: it.slug });

  const owns = (it) => !!sb.owned && sb.owned.has(it.id);
  const isWorn = (it) => sb.draft.items.some((w) => w.id === it.id);

  // ---------- totals ----------
  function summarize(items) {
    const s = { count: items.length, total: 0, cost: 0, tix: 0, owned: 0, unbuyable: 0, need: null, tixNeed: null, toBuy: 0 };
    for (const raw of items) {
      const it = fresh(raw);
      const p = it.price || {};
      if (p.robux != null) s.total += p.robux;
      if (owns(it)) { s.owned++; continue; }
      if (p.robux != null) { s.cost += p.robux; s.toBuy++; }
      else if (p.tix != null) { s.tix += p.tix; s.toBuy++; }
      else s.unbuyable++;
    }
    if (sb.balance) {
      s.need = Math.max(0, s.cost - (sb.balance.robux || 0));
      s.tixNeed = Math.max(0, s.tix - (sb.balance.tickets || 0));
    }
    return s;
  }

  function refreshSums() {
    sb.sum = summarize(sb.draft.items);
    for (const o of sb.outfits) o.sum = summarize(o.items);
  }

  // ---------- catalog browsing ----------
  function reload() {
    gen++;
    sb.items = [];
    sb.cursor = "0";
    sb.error = "";
    sb.loading = false;
    if (sb.view === "browse" && sb.menu?.sbType) loadMore();
    apply();
  }

  async function loadMore() {
    if (sb.loading || sb.cursor == null || sb.view !== "browse" || !sb.menu?.sbType) return;
    const mine = gen;
    sb.loading = true;
    sb.error = "";
    apply();
    try {
      const p = new URLSearchParams({ subcategory: String(sb.menu.sbType), includeNotForSale: "true", limit: String(PAGE), cursor: sb.cursor });
      if (sb.q.keyword.trim()) p.set("keyword", sb.q.keyword.trim());
      if (sb.q.sort) p.set("sortType", String(sb.q.sort));
      const page = await getJson(`/catalog/v1/search/items?${p}`);
      const ids = (page.data || []).filter((d) => d.itemType === "Asset").map((d) => d.id);
      const rows = ids.length ? await details(ids) : [];
      if (mine !== gen) return;
      const byId = new Map(rows.filter(approved).map((d) => [d.id, remember(normalize(d))]));
      const have = new Set(sb.items.map((i) => i.id));
      for (const id of ids) {
        const it = byId.get(id);
        if (it && !have.has(id)) sb.items.push(it);
      }
      sb.cursor = page.nextPageCursor || null;
      refreshSums();
    } catch (err) {
      if (mine === gen) sb.error = err.message || "Couldn't load items";
    } finally {
      if (mine === gen) sb.loading = false;
      apply();
      // keep filling while the end of the list is on screen
      if (mine === gen && !sb.error) setTimeout(checkSentinel, 50);
    }
  }

  function visibleItems() {
    let list = sb.view === "current" ? sb.draft.items.map(fresh) : sb.items;
    if (sb.view === "browse" && sb.q.hideOffsale) {
      list = list.filter((i) => owns(i) || i.price.robux != null || i.price.tix != null);
    }
    return list;
  }

  // Load the next page when the bottom of the grid scrolls into view. The
  // iframe grows to fit its content, so it's the parent page that scrolls;
  // IntersectionObserver measures against the top-level viewport.
  let sentinelObserver = null;
  let sentinelVisible = false;
  function watchSentinel(el) {
    sentinelObserver?.disconnect();
    sentinelObserver = new IntersectionObserver((entries) => {
      sentinelVisible = entries.some((e) => e.isIntersecting);
      if (sentinelVisible) loadMore();
    }, { rootMargin: "0px 0px 600px 0px" });
    sentinelObserver.observe(el);
  }
  function checkSentinel() {
    if (sentinelVisible) loadMore();
  }

  // ---------- wearing ----------
  function wear(item) {
    const it = snapshot(fresh(item));
    let items = sb.draft.items.filter((w) => w.id !== it.id);
    const same = items.filter((w) => w.type === it.type);
    // over the limit for this slot: the oldest one comes off
    if (same.length >= limitOf(it.type)) {
      const drop = new Set(same.slice(0, same.length - limitOf(it.type) + 1).map((w) => w.id));
      items = items.filter((w) => !drop.has(w.id));
    }
    items.push(it);
    sb.draft.items = items;
    changed();
    focus(it);
  }

  function takeOff(item) {
    sb.draft.items = sb.draft.items.filter((w) => w.id !== item.id);
    if (sb.focused?.id === item.id) focus(sb.draft.items[sb.draft.items.length - 1] || null);
    changed();
  }

  function toggle(item) {
    if (isWorn(item)) takeOff(item);
    else wear(item);
  }

  function changed() {
    sb.dirty = true;
    refreshSums();
    checkOwnership(sb.draft.items);
    saveDraft();
    apply();
  }

  let draftTimer = 0;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      call("save-draft", { draft: sb.draft, dirty: sb.dirty }).catch(() => {});
    }, 250);
  }

  // ---------- preview ----------
  // Octane's try-on renders your current avatar plus ONE extra item, so the
  // preview shows whichever item you picked last.
  let previewSeq = 0;
  async function focus(item) {
    sb.focused = item ? fresh(item) : null;
    const p = sb.preview;
    p.url = "";
    p.failed = false;
    p.target3d = "";
    const mine = ++previewSeq;
    if (!item || !sb.viewerId) { p.loading = false; apply(); return; }
    if (NO_TRY_ON.has(item.type)) { p.loading = false; p.failed = true; apply(); return; }
    p.loading = true;
    apply();
    // clicking through several items quickly only renders the last one
    await sleep(350);
    if (mine !== previewSeq) return;
    p.target3d = `${sb.viewerId}&tryOnAssetId=${item.id}`;
    apply();
    try {
      for (let i = 0; i < 12 && mine === previewSeq; i++) {
        const res = await getJson(`/thumbnails/v1/avatar/try-on?assetId=${item.id}&userId=${sb.viewerId}&size=420x420&format=Png`);
        const t = res.data?.[0];
        if (t?.state === "Completed" && t.imageUrl) { if (mine === previewSeq) p.url = t.imageUrl; break; }
        if (t && t.state !== "Pending") throw new Error(t.state);
        await sleep(1500);
      }
      if (mine === previewSeq && !p.url) p.failed = true;
    } catch {
      if (mine === previewSeq) p.failed = true;
    } finally {
      if (mine === previewSeq) p.loading = false;
      apply();
    }
  }

  // ---------- your stuff ----------
  const WEARABLE = [2, 8, 11, 12, 17, 18, 19, 27, 28, 29, 30, 31, 32, 41, 42, 43, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 56, 61];

  async function loadOwned() {
    if (!sb.viewerId) return;
    try {
      const owned = new Set();
      let cursor = "";
      for (let page = 0; page < 50; page++) {
        const res = await getJson(`/inventory/v2/users/${sb.viewerId}/inventory?assetTypes=${WEARABLE.join(",")}&limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        for (const it of res.data || []) owned.add(it.assetId);
        cursor = res.nextPageCursor;
        if (!cursor) break;
      }
      if (sb.owned) for (const id of sb.owned) owned.add(id);
      sb.owned = owned;
      sb.ownedComplete = true;
    } catch {
      // private inventory without a session: fall back to per-item checks
      sb.owned = sb.owned || new Set();
      checkOwnership(sb.draft.items);
    }
    refreshSums();
    apply();
  }

  // Single-item check (works even when the inventory is private)
  const checked = new Set();
  async function checkOwnership(items) {
    if (!sb.viewerId || !sb.owned || sb.ownedComplete) return;
    for (const it of items) {
      if (checked.has(it.id) || sb.owned.has(it.id)) continue;
      checked.add(it.id);
      try {
        const res = await getJson(`/inventory/v1/users/${sb.viewerId}/items/Asset/${it.id}`);
        if ((res.data || []).length) { sb.owned.add(it.id); refreshSums(); apply(); }
      } catch { /* leave as not owned */ }
    }
  }

  async function loadBalance() {
    if (!sb.viewerId) return;
    try {
      const res = await getJson(`/economy/v1/users/${sb.viewerId}/currency`);
      sb.balance = { robux: res.robux || 0, tickets: res.tickets || 0 };
    } catch {
      sb.balance = null;
    }
    refreshSums();
    apply();
  }

  // Prices move (resales especially), so refresh everything in your outfits
  async function refreshPrices() {
    const ids = [...new Set([...sb.draft.items, ...sb.outfits.flatMap((o) => o.items)].map((i) => i.id))];
    if (!ids.length) return;
    try {
      for (const d of await details(ids)) remember(normalize(d));
      const update = (list) => list.map((i) => (known.has(i.id) ? snapshot(known.get(i.id)) : i));
      sb.draft.items = update(sb.draft.items);
      for (const o of sb.outfits) o.items = update(o.items);
      refreshSums();
      apply();
    } catch { /* keep the saved prices */ }
  }

  // Start from what you're wearing for real
  async function copyAvatar() {
    if (!sb.viewerId) return;
    try {
      const av = await getJson(`/avatar/v1/users/${sb.viewerId}/avatar`);
      const ids = (av.assets || []).map((a) => a.id);
      const rows = ids.length ? await details(ids) : [];
      const byId = new Map(rows.map((d) => [d.id, remember(normalize(d))]));
      const items = (av.assets || []).map((a) => byId.get(a.id) || remember({
        id: a.id, name: a.name, type: a.assetType?.id || 0, restriction: "", price: { kind: "offsale" }, slug: slug(a.name),
      })).filter((it) => TYPE_NAMES[it.type]);
      // what you already wear is yours
      if (sb.owned) for (const it of items) sb.owned.add(it.id);
      sb.draft = { id: null, name: "", items: items.map(snapshot) };
      sb.dirty = true;
      refreshSums();
      saveDraft();
      focus(null);
      toast("Copied your current avatar into the sandbox");
    } catch {
      toast("Couldn't read your avatar", true);
    }
  }

  // ---------- saved outfits ----------
  function persistOutfits() {
    const outfits = sb.outfits.map((o) => ({ id: o.id, name: o.name, items: o.items.map(snapshot), created: o.created, updated: o.updated }));
    return call("save-outfits", { outfits }).catch(() => toast("Couldn't save outfits", true));
  }

  function newId() {
    return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async function askName(title, current) {
    try {
      const $uibModal = injector.get("$uibModal");
      const modal = $uibModal.open({
        animation: false,
        templateUrl: "outfit-name-modal",
        controller: "outfitNameModalController",
        openedClass: "modal-open-noscroll",
        resolve: { modalData: { title, description: "Sandbox outfits are saved on this computer by Kerosene.", buttonName: "Save", nameInputPlaceholder: current || "Name your outfit" } },
      });
      const res = await modal.result;
      return String(res?.outfitName || "").trim();
    } catch {
      return "";
    }
  }

  async function save(asNew) {
    if (!sb.draft.items.length) return;
    const now = Date.now();
    let outfit = !asNew && sb.draft.id ? sb.outfits.find((o) => o.id === sb.draft.id) : null;
    if (!outfit) {
      const name = await askName("Save Sandbox Outfit", sb.draft.name);
      if (!name) return;
      outfit = { id: newId(), name, items: [], created: now };
      sb.outfits.unshift(outfit);
    }
    outfit.items = sb.draft.items.map(snapshot);
    outfit.updated = now;
    sb.draft.id = outfit.id;
    sb.draft.name = outfit.name;
    sb.dirty = false;
    refreshSums();
    saveDraft();
    await persistOutfits();
    toast(`Saved "${outfit.name}"`);
    apply();
  }

  function load(o) {
    sb.draft = { id: o.id, name: o.name, items: o.items.map(snapshot) };
    sb.dirty = false;
    sb.menuFor = null;
    refreshSums();
    saveDraft();
    checkOwnership(sb.draft.items);
    focus(sb.draft.items[sb.draft.items.length - 1] || null);
    selectMenu("Current");
  }

  async function rename(o) {
    sb.menuFor = null;
    const name = await askName("Rename Sandbox Outfit", o.name);
    if (!name) return;
    o.name = name;
    o.updated = Date.now();
    if (sb.draft.id === o.id) { sb.draft.name = name; saveDraft(); }
    await persistOutfits();
    apply();
  }

  async function remove(o) {
    sb.menuFor = null;
    sb.confirmDelete = null;
    sb.outfits = sb.outfits.filter((x) => x.id !== o.id);
    if (sb.draft.id === o.id) { sb.draft.id = null; sb.dirty = true; saveDraft(); }
    refreshSums();
    await persistOutfits();
    toast(`Deleted "${o.name}"`);
    apply();
  }

  function clearDraft() {
    sb.draft = { id: null, name: "", items: [] };
    sb.dirty = false;
    refreshSums();
    saveDraft();
    focus(null);
  }

  // ---------- UI glue ----------
  let injector = null;
  let ctrlScope = null;

  function toast(msg, error) {
    try {
      const fb = ctrlScope?.systemFeedback;
      if (fb) { (error ? fb.error : fb.success)(msg); apply(); }
    } catch { /* no feedback bar */ }
  }

  let tabRef = null;
  function selectMenu(name) {
    for (const row of tabRef.categoryRows) {
      const menu = row.subCategoryMenu.find((m) => m.sbName === name);
      if (menu) { ctrlScope.onMenuClick(tabRef, menu, row); apply(); return; }
    }
  }

  function onMenu(tab, menu) {
    if (!tab || tab.name !== TAB || !menu) return;
    const view = menu.sbName === "Current" ? "current" : menu.sbName === "Saved" ? "saved" : "browse";
    const same = sb.view === view && sb.menu === menu;
    sb.view = view;
    sb.menu = menu;
    sb.menuFor = null;
    if (view === "saved" || view === "current") refreshPrices();
    if (!same) reload();
  }

  const CSS = `
    /* six tabs instead of five (below 992px Octane makes the row scroll) */
    @media (min-width: 992px) { #avatar-container #horizontal-tabs > li.rbx-tab { width: 16.666%; } }
    #kerosene-sandbox .items-list.avatar-item-list .item-card { height: auto; min-height: 210px; }
    #kerosene-sandbox .item-card-thumb-container { cursor: pointer; position: relative; }
    #kerosene-sandbox .item-card-price { height: auto; min-height: 20px; margin-bottom: 4px; }
    #kerosene-sandbox .kero-sb-owned { position: absolute; top: 4px; left: 4px; font-size: 10px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: #02b757; color: #fff; }
    #kerosene-sandbox .kero-sb-off { font-size: 13px; }
    #kerosene-sandbox .kero-sb-tag { font-size: 10px; text-transform: uppercase; letter-spacing: .3px; opacity: .6; margin-left: 4px; }
    #kerosene-sandbox .kero-sb-tix { display: inline-block; font-size: 10px; font-weight: 700; border: 1.5px solid currentColor; border-radius: 3px; padding: 0 2px; margin-right: 3px; line-height: 13px; vertical-align: middle; opacity: .75; }

    #kerosene-sandbox .kero-sb-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin-bottom: 8px; }
    #kerosene-sandbox .kero-sb-name { font-weight: 600; font-size: 16px; }
    #kerosene-sandbox .kero-sb-name small { font-weight: 400; font-size: 12px; opacity: .6; margin-left: 6px; }
    #kerosene-sandbox .kero-sb-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    #kerosene-sandbox .kero-sb-actions button { min-width: 0; padding: 5px 9px; }
    #kerosene-sandbox .kero-sb-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; margin-bottom: 8px; }
    #kerosene-sandbox .kero-sb-stat { border-radius: 8px; padding: 7px 10px; background: rgba(127,127,127,.12); }
    #kerosene-sandbox .kero-sb-stat > span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; opacity: .65; }
    #kerosene-sandbox .kero-sb-stat b { display: block; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #kerosene-sandbox .kero-sb-stat b.txt { white-space: normal; font-size: 13px; line-height: 1.25; }
    #kerosene-sandbox .kero-sb-stat .icon-robux-16x16 { margin: -2px 1px 0 0; }
    #kerosene-sandbox .kero-sb-stat.need b { color: #e2231a; }
    #kerosene-sandbox .kero-sb-stat.ok b { color: #02b757; }
    #kerosene-sandbox .kero-sb-note { font-size: 12px; opacity: .7; margin: -2px 0 8px; }
    #kerosene-sandbox .kero-sb-worn { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0 0 10px; padding: 0; }
    #kerosene-sandbox .kero-sb-worn li { position: relative; width: 52px; height: 52px; border-radius: 6px; overflow: hidden; cursor: pointer; background: rgba(127,127,127,.18); outline: 2px solid transparent; outline-offset: -2px; }
    #kerosene-sandbox .kero-sb-worn li.focused { outline-color: #00a2ff; }
    #kerosene-sandbox .kero-sb-worn li .thumbnail-2d-container, #kerosene-sandbox .kero-sb-worn li img { width: 52px; height: 52px; }
    #kerosene-sandbox .kero-sb-x { position: absolute; top: 1px; right: 1px; width: 17px; height: 17px; padding: 0; border: 0; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; font-size: 13px; line-height: 17px; text-align: center; cursor: pointer; }
    #kerosene-sandbox .kero-sb-filters { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-bottom: 10px; }
    #kerosene-sandbox .kero-sb-filters input[type=search] { flex: 1 1 180px; min-width: 0; height: 32px; }
    #kerosene-sandbox .kero-sb-filters select { flex: 0 1 190px; height: 32px; padding: 0 8px; }
    #kerosene-sandbox .kero-sb-filters label { display: flex; align-items: center; gap: 5px; margin: 0; font-weight: 400; font-size: 13px; cursor: pointer; white-space: nowrap; }
    #kerosene-sandbox .kero-sb-filters label input { margin: 0; }
    #kerosene-sandbox .kero-sb-msg { margin: 8px 0; }
    #kerosene-sandbox .kero-sb-msg a { cursor: pointer; margin-left: 6px; }
    #kerosene-sandbox .kero-sb-more { display: block; margin: 8px auto; }
    #kerosene-sandbox .kero-sb-sentinel { height: 1px; }

    #kerosene-sandbox .kero-sb-collage { display: grid !important; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; padding: 4px; }
    #kerosene-sandbox .kero-sb-collage .thumbnail-2d-container, #kerosene-sandbox .kero-sb-collage img { width: 100%; height: 100%; }
    #kerosene-sandbox .kero-sb-need { font-size: 12px; font-weight: 600; padding: 0 5px 4px; }
    #kerosene-sandbox .kero-sb-left { font-size: 12px; padding: 0 5px; opacity: .8; }
    #kerosene-sandbox .kero-sb-need .icon-robux-16x16, #kerosene-sandbox .kero-sb-left .icon-robux-16x16 { transform: scale(.8); margin: -2px 0 0 1px; }
    #kerosene-sandbox .kero-sb-need.short { color: #e2231a; }
    #kerosene-sandbox .kero-sb-need.ok { color: #02b757; }
    #kerosene-sandbox .kero-sb-ocard .item-card-container { position: relative; }
    #kerosene-sandbox .kero-sb-gear { position: absolute; top: 6px; right: 6px; z-index: 2; cursor: pointer; }
    #kerosene-sandbox .kero-sb-menu { position: absolute; top: 28px; right: 4px; z-index: 3; display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
    .dark-theme #kerosene-sandbox .kero-sb-menu { background: #232527; }
    #kerosene-sandbox .kero-sb-menu button { min-width: 84px; }

    /* covers the editor's own preview (.avatar-back is 277x352; the native
       352px render sits 37px to the left inside it) */
    .avatar-back .kero-sb-preview { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; background: inherit; }
    .avatar-back .kero-sb-preview .kero-sb-stage { position: absolute; top: 0; left: -37px; width: 352px; height: 352px; }
    .avatar-back .kero-sb-preview img.kero-sb-render { width: 352px; height: 352px; display: block; }
    .avatar-back .kero-sb-preview thumbnail-3d, .avatar-back .kero-sb-preview .thumbnail-3d-container { display: block; width: 352px; height: 352px; }
    .avatar-back .kero-sb-preview .kero-sb-fallback { width: 150px; height: 150px; }
    .avatar-back .kero-sb-preview .kero-sb-fallback img, .avatar-back .kero-sb-preview .kero-sb-fallback .thumbnail-2d-container { width: 100%; height: 100%; }
    .avatar-back .kero-sb-cap { position: absolute; left: 8px; top: 8px; max-width: calc(100% - 16px); z-index: 2; padding: 5px 8px; border-radius: 6px; font-size: 12px; line-height: 1.3; background: rgba(0,0,0,.55); color: #fff; text-align: left; pointer-events: none; }
    .avatar-back .kero-sb-cap b { font-weight: 600; }
    .avatar-back .kero-sb-preview .kero-sb-toggle { position: absolute; right: 16px; bottom: 16px; z-index: 2; padding: 9px; font-size: 16px; font-weight: 500; line-height: 100%; border-radius: 3px; background: #fff; color: #191919; cursor: pointer; user-select: none; }
    .avatar-back .kero-sb-preview .spinner { position: absolute; z-index: 1; }
  `;

  const PRICE = `
    <span ng-switch="item.price.kind">
      <span ng-switch-when="free" class="text-robux-tile">Free</span>
      <span ng-switch-when="tix"><span class="kero-sb-tix">TX</span><span class="text-robux-tile">{{item.price.tix | number}}</span></span>
      <span ng-switch-when="offsale" class="text-label kero-sb-off">Off Sale</span>
      <span ng-switch-when="nosellers" class="text-label kero-sb-off">No Resellers</span>
      <span ng-switch-default><span class="icon-robux-16x16"></span><span class="text-robux-tile">{{item.price.robux | number}}</span><span ng-if="item.price.kind === 'resale'" class="kero-sb-tag" title="Cheapest reseller">resale</span></span>
    </span>`;

  const CARD = `
    <div class="item-card-container remove-panel">
      <div class="item-card-link">
        <a class="item-card-thumb-container" ng-click="sbToggle(item)" data-item-name="{{item.name}}" title="{{sbWorn(item) ? 'Take off' : 'Try on'}}">
          <thumbnail-2d class="item-card-thumb" thumbnail-target-id="item.id" thumbnail-type="'assetThumbnail'"></thumbnail-2d>
          <span ng-if="item.restriction" ng-class="'icon-' + item.restriction + '-label'"></span>
          <span ng-if="sbOwns(item)" class="kero-sb-owned">Owned</span>
        </a>
      </div>
      <div class="item-card-caption">
        <div ng-show="sbWorn(item)" class="item-card-equipped" data-item-status="equipped"><div class="item-card-equipped-label"></div><span class="icon-check-selection"></span></div>
        <a ng-href="/catalog/{{item.id}}/{{item.slug}}" class="item-card-name-link"><div title="{{item.name}}" class="text-overflow item-card-name">{{item.name}}</div></a>
        <div class="text-overflow item-card-price">${PRICE}</div>
      </div>
    </div>`;

  const PANE = `
  <div class="tab-pane" id="kerosene-sandbox" ng-class="{active: selectedTab.name === '${TAB}'}">
    <div class="kero-sb-head">
      <div class="kero-sb-name">{{sb.draft.name || 'Sandbox outfit'}}<small ng-if="sb.dirty && sb.draft.id">unsaved changes</small><small ng-if="!sb.draft.id && sb.draft.items.length">not saved yet</small></div>
      <div class="kero-sb-actions">
        <button type="button" class="btn-secondary-xs" ng-click="sbSave(false)" ng-disabled="!sb.draft.items.length">{{sb.draft.id ? 'Save' : 'Save Outfit'}}</button>
        <button type="button" class="btn-control-xs" ng-if="sb.draft.id" ng-click="sbSave(true)" ng-disabled="!sb.draft.items.length">Save as New</button>
        <button type="button" class="btn-control-xs" ng-click="sbCopy()">Copy My Avatar</button>
        <button type="button" class="btn-control-xs" ng-click="sbClear()" ng-disabled="!sb.draft.items.length">Clear</button>
      </div>
    </div>

    <div class="kero-sb-stats">
      <div class="kero-sb-stat"><span>Items</span><b>{{sb.sum.count}}</b></div>
      <div class="kero-sb-stat"><span>Outfit worth</span><b><span class="icon-robux-16x16"></span> {{sb.sum.total | number}}</b></div>
      <div class="kero-sb-stat"><span>Left to buy</span><b><span class="icon-robux-16x16"></span> {{sb.sum.cost | number}}</b></div>
      <div class="kero-sb-stat"><span>You have</span><b ng-if="sb.balance"><span class="icon-robux-16x16"></span> {{sb.balance.robux | number}}</b><b ng-if="!sb.balance">&ndash;</b></div>
      <div class="kero-sb-stat" ng-class="{need: sb.sum.need > 0, ok: sb.sum.need === 0}"><span>Still need</span>
        <b ng-if="sb.sum.need > 0"><span class="icon-robux-16x16"></span> {{sb.sum.need | number}}</b>
        <b class="txt" ng-if="sb.sum.need === 0">{{sb.sum.cost ? 'You can afford it' : (sb.sum.count ? 'Nothing to buy' : '0')}}</b>
        <b ng-if="sb.sum.need === null">&ndash;</b>
      </div>
    </div>
    <div class="kero-sb-note" ng-if="sb.sum.owned || sb.sum.tix || sb.sum.unbuyable || !sb.balance">
      <span ng-if="sb.sum.owned">You already own {{sb.sum.owned}} of these. </span>
      <span ng-if="sb.sum.tix">Plus {{sb.sum.tix | number}} Tix<span ng-if="sb.balance"> (you have {{sb.balance.tickets | number}})</span>. </span>
      <span ng-if="sb.sum.unbuyable">{{sb.sum.unbuyable}} {{sb.sum.unbuyable === 1 ? "item isn't" : "items aren't"}} for sale right now. </span>
      <span ng-if="!sb.balance">Log in to Octane to compare with your balance.</span>
    </div>

    <ul class="kero-sb-worn" ng-if="sb.draft.items.length">
      <li ng-repeat="w in sb.draft.items track by w.id" ng-class="{focused: sb.focused.id === w.id}" ng-click="sbFocus(w)" title="{{w.name}}">
        <thumbnail-2d thumbnail-target-id="w.id" thumbnail-type="'assetThumbnail'"></thumbnail-2d>
        <button type="button" class="kero-sb-x" ng-click="sbTakeOff(w); $event.stopPropagation()" title="Take off">&times;</button>
      </li>
    </ul>

    <div ng-if="sb.view === 'browse'">
      <div class="kero-sb-filters">
        <input type="search" class="form-control input-field" placeholder="Search {{sb.menu.label}}" ng-model="sb.q.keyword" ng-model-options="{debounce: 400}" ng-change="sbReload()">
        <select class="form-control input-field" ng-model="sb.q.sort" ng-change="sbReload()" ng-options="o.v as o.label for o in sb.sorts"></select>
        <label><input type="checkbox" ng-model="sb.q.hideOffsale"> Hide off-sale</label>
      </div>
    </div>

    <div ng-if="sb.view !== 'saved'">
      <div class="items-list avatar-item-list">
        <ul class="hlist item-cards-stackable">
          <li ng-repeat="item in sbList() track by item.id" class="list-item item-card">${CARD}</li>
        </ul>
      </div>
      <div ng-show="sb.view === 'browse' && sb.loading" loading-animated></div>
      <div class="section-content-off kero-sb-msg" ng-if="sb.view === 'browse' && sb.error">{{sb.error}}<a class="text-link" ng-click="sbMore()">Try again</a></div>
      <div class="section-content-off kero-sb-msg" ng-if="sb.view === 'browse' && !sb.loading && !sb.error && !sbList().length">No items found.</div>
      <div class="section-content-off kero-sb-msg" ng-if="sb.view === 'current' && !sb.draft.items.length">Nothing on yet. Pick a category from the Sandbox menu and click items to try them on.</div>
      <button type="button" class="btn-control-sm kero-sb-more" ng-if="sb.view === 'browse' && !sb.loading && !sb.error && sb.cursor" ng-click="sbMore()">Load more</button>
    </div>

    <div ng-if="sb.view === 'saved'">
      <div class="section-content-off kero-sb-msg" ng-if="!sb.outfits.length">No saved outfits yet. Try some items on, then press Save Outfit.</div>
      <div class="items-list avatar-item-list">
        <ul class="hlist item-cards-stackable">
          <li ng-repeat="o in sb.outfits track by o.id" class="list-item item-card kero-sb-ocard">
            <div class="item-card-container remove-panel outfit-card">
              <span class="icon-settings-16x16 kero-sb-gear" ng-click="sb.menuFor = (sb.menuFor === o.id ? null : o.id); sb.confirmDelete = null" title="Options"></span>
              <div class="kero-sb-menu" ng-if="sb.menuFor === o.id">
                <button type="button" class="btn-secondary-xs" ng-click="sbLoad(o)">Wear</button>
                <button type="button" class="btn-control-xs" ng-click="sbRename(o)">Rename</button>
                <button type="button" class="btn-control-xs" ng-if="sb.confirmDelete !== o.id" ng-click="sb.confirmDelete = o.id">Delete</button>
                <button type="button" class="btn-alert-xs" ng-if="sb.confirmDelete === o.id" ng-click="sbRemove(o)">Really delete</button>
              </div>
              <div class="item-card-link">
                <a class="item-card-thumb-container kero-sb-collage" ng-click="sbLoad(o)" title="Wear in the sandbox">
                  <thumbnail-2d ng-repeat="it in o.items | limitTo:4 track by it.id" thumbnail-target-id="it.id" thumbnail-type="'assetThumbnail'"></thumbnail-2d>
                </a>
              </div>
              <div class="item-card-caption">
                <div title="{{o.name}}" class="text-overflow item-card-name">{{o.name}}</div>
                <div class="text-overflow item-card-price" title="Whole outfit"><span class="icon-robux-16x16"></span><span class="text-robux-tile">{{o.sum.total | number}}</span> <span class="kero-sb-tag">{{o.items.length}} {{o.items.length === 1 ? 'item' : 'items'}}</span></div>
                <div class="text-overflow kero-sb-left" ng-if="o.sum.owned && o.sum.cost" title="What you don't own yet">Left to buy <span class="icon-robux-16x16"></span>{{o.sum.cost | number}}</div>
                <div class="kero-sb-need" ng-class="{short: o.sum.need > 0, ok: o.sum.need === 0}">
                  <span ng-if="o.sum.need > 0">Need <span class="icon-robux-16x16"></span>{{o.sum.need | number}} more</span>
                  <span ng-if="o.sum.need === 0 && o.sum.cost > 0">You can afford it</span>
                  <span ng-if="!o.sum.cost && !o.sum.unbuyable && o.sum.owned">You own all of it</span>
                  <span ng-if="o.sum.need === null && o.sum.cost > 0">{{o.sum.cost | number}} left to buy</span>
                  <span ng-if="o.sum.unbuyable" class="kero-sb-tag">{{o.sum.unbuyable}} off sale</span>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
    <!-- outside every ng-if, so the observer never loses it -->
    <div class="kero-sb-sentinel"></div>
  </div>`;

  const PREVIEW = `
  <div class="kero-sb-preview" ng-if="selectedTab.name === '${TAB}' && sb.focused">
    <span class="toggle-three-dee btn-control btn-control-small kero-sb-toggle" ng-if="!sb.preview.failed" ng-click="sb.preview.is3d = !sb.preview.is3d">{{sb.preview.is3d ? '2D' : '3D'}}</span>
    <div class="kero-sb-stage" ng-if="sb.preview.is3d && !sb.preview.failed && sb.preview.target3d" ng-repeat="t in [sb.preview.target3d] track by t">
      <thumbnail-3d target-id="t"></thumbnail-3d>
    </div>
    <div class="kero-sb-stage" ng-if="!sb.preview.is3d && sb.preview.url"><img class="kero-sb-render" ng-src="{{sb.preview.url}}" alt=""></div>
    <div class="kero-sb-fallback" ng-if="sb.preview.failed"><thumbnail-2d thumbnail-target-id="sb.focused.id" thumbnail-type="'assetThumbnail'"></thumbnail-2d></div>
    <span class="spinner spinner-default" ng-if="!sb.preview.is3d && sb.preview.loading"></span>
    <div class="kero-sb-cap"><b>{{sb.focused.name}}</b><br>{{sb.preview.failed ? 'No try-on for this one' : 'Tried on your avatar'}}</div>
  </div>`;

  function inject() {
    const root = document.getElementById("avatar-container");
    const ctrlEl = document.querySelector('[ng-controller="avatarController"]');
    injector = window.angular.element(root).injector();
    ctrlScope = window.angular.element(ctrlEl).scope();
    const $compile = injector.get("$compile");
    const $rootScope = injector.get("$rootScope");

    const style = document.createElement("style");
    style.id = "kerosene-sandbox-css";
    style.textContent = CSS;
    document.head.appendChild(style);

    // The tab: avatarController's $scope.tabs is avatarConstantService.tabs,
    // so a pushed entry renders as a native tab with a nested dropdown. Menu
    // entries carry no `assetType`, so the editor's own item loaders ignore them.
    const tabs = injector.get("avatarConstantService").tabs;
    tabRef = tabs.find((t) => t.name === TAB);
    if (!tabRef) {
      tabRef = {
        name: TAB,
        label: TAB,
        tabType: TAB,
        menuType: "Nested",
        visible: true,
        categoryRows: ROWS.map((row) => ({
          title: row.title,
          name: `Sandbox${row.title}`,
          subCategoryMenu: row.menus.map(([name, label, type]) => ({ name: `Sandbox${name}`, sbName: name, label, sbType: type || 0 })),
        })),
      };
      tabs.push(tabRef);
    }

    scope = ctrlScope.$new();
    scope.sb = sb;
    scope.sbList = visibleItems;
    scope.sbWorn = isWorn;
    scope.sbOwns = owns;
    scope.sbToggle = toggle;
    scope.sbTakeOff = takeOff;
    scope.sbFocus = focus;
    scope.sbReload = reload;
    scope.sbMore = () => { sb.error = ""; loadMore(); };
    scope.sbSave = save;
    scope.sbCopy = copyAvatar;
    scope.sbClear = clearDraft;
    scope.sbLoad = load;
    scope.sbRename = rename;
    scope.sbRemove = remove;

    const pane = $compile(PANE)(scope);
    window.angular.element(document.querySelector("[avatar-tab-content]")).append(pane);
    const back = document.querySelector(".avatar-back");
    if (back) window.angular.element(back).append($compile(PREVIEW)(scope));

    ctrlScope.$watchGroup(["selectedTab", "selectedMenu"], ([tab, menu]) => onMenu(tab, menu));
    // a sandbox outfit preview shouldn't stay stuck over your real avatar
    ctrlScope.$watch("selectedTab.name", (name) => { if (name !== TAB) sb.menuFor = null; });

    $rootScope.$apply();
    const sentinel = pane[0].querySelector(".kero-sb-sentinel");
    if (sentinel) watchSentinel(sentinel);
  }

  // Wait for Angular to bootstrap the editor and render its tabs
  function whenEditorReady() {
    return new Promise((resolve) => {
      const started = Date.now();
      const t = setInterval(() => {
        const root = document.getElementById("avatar-container");
        const ctrlEl = document.querySelector('[ng-controller="avatarController"]');
        const ng = window.angular;
        if (root && ctrlEl && ng && ng.element(root).injector() && document.querySelector("#horizontal-tabs > li.rbx-tab")) {
          clearInterval(t);
          resolve(true);
        } else if (Date.now() - started > 60000) {
          clearInterval(t);
          resolve(false);
        }
      }, 150);
    });
  }

  async function start() {
    // the extension side answers once its storage is loaded
    let init = null;
    for (let i = 0; i < 20 && !init; i++) {
      try { init = await call("init", null, 1500); } catch { await sleep(250); }
    }
    if (!init || !init.enabled) return;
    if (!sb.viewerId && init.viewer?.id) sb.viewerId = init.viewer.id;
    sb.outfits = (init.outfits || []).filter((o) => o && Array.isArray(o.items));
    if (init.draft && Array.isArray(init.draft.items)) {
      sb.draft = { id: init.draft.id || null, name: init.draft.name || "", items: init.draft.items };
      sb.dirty = !!init.dirtyDraft;
      // a deleted outfit can't be "saved over"
      if (sb.draft.id && !sb.outfits.some((o) => o.id === sb.draft.id)) sb.draft.id = null;
    }
    refreshSums();
    if (!(await whenEditorReady())) return;
    inject();
    sb.ready = true;
    loadOwned();
    loadBalance();
    refreshPrices();
    if (sb.draft.items.length) focus(sb.draft.items[sb.draft.items.length - 1]);
  }

  // Outfits saved in another tab
  document.addEventListener("kerosene:sandbox-push", (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    if (msg.outfits) {
      sb.outfits = msg.outfits.filter((o) => o && Array.isArray(o.items));
      refreshSums();
      apply();
    }
  });

  // Octane frames post this after a purchase; your balance and items changed
  window.addEventListener("message", (e) => {
    if (e.data?.source === "octane-currency" && sb.ready) { loadBalance(); checked.clear(); sb.ownedComplete = false; loadOwned(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sb.ready) loadBalance();
  });

  start();
})();
