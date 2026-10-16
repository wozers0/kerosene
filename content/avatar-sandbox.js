// Storage side of the avatar Sandbox (see content/avatar-main.js, which runs
// in the page's own world and can't reach extension storage). Answers its
// requests over DOM events. Only active in Octane's avatar editor frame.
(() => {
  if (!/^\/theme2020\/avatar\/?$/i.test(location.pathname)) return;
  const S = globalThis.KeroseneSettings;

  const reply = (id, ok, data, error) => {
    document.dispatchEvent(new CustomEvent("kerosene:sandbox-res", { detail: JSON.stringify({ id, ok, data, error }) }));
  };
  const push = (data) => {
    document.dispatchEvent(new CustomEvent("kerosene:sandbox-push", { detail: JSON.stringify(data) }));
  };

  // keep what the page sends small and well-formed
  const MAX_OUTFITS = 200, MAX_ITEMS = 60, MAX_BYTES = 1024 * 1024;
  const cleanItem = (i) => ({
    id: Number(i.id) || 0,
    name: String(i.name || "").slice(0, 100),
    type: Number(i.type) || 0,
    restriction: i.restriction === "limited" || i.restriction === "limited-unique" ? i.restriction : "",
    price: {
      kind: String(i.price?.kind || "offsale").slice(0, 16),
      ...(Number.isFinite(i.price?.robux) ? { robux: i.price.robux } : {}),
      ...(Number.isFinite(i.price?.tix) ? { tix: i.price.tix } : {}),
    },
    slug: String(i.slug || "").slice(0, 100),
  });
  const cleanItems = (items) => (Array.isArray(items) ? items.slice(0, MAX_ITEMS).map(cleanItem).filter((i) => i.id) : []);
  const tooBig = (v) => JSON.stringify(v).length > MAX_BYTES;
  const cleanOutfit = (o) => ({
    id: String(o.id || "").slice(0, 40),
    name: String(o.name || "Outfit").slice(0, 60),
    items: cleanItems(o.items),
    created: Number(o.created) || Date.now(),
    updated: Number(o.updated) || Date.now(),
  });

  const handlers = {
    async init() {
      const settings = await S.load();
      const got = await ext.storage.local.get(["sandboxOutfits", "sandboxDraft", "viewer"]);
      return {
        enabled: settings.enabled && settings.avatarSandbox,
        outfits: got.sandboxOutfits || [],
        draft: got.sandboxDraft?.draft || null,
        dirtyDraft: !!got.sandboxDraft?.dirty,
        viewer: got.viewer || null,
      };
    },
    async "save-outfits"(data) {
      const outfits = (Array.isArray(data?.outfits) ? data.outfits : []).slice(0, MAX_OUTFITS).map(cleanOutfit);
      if (tooBig(outfits)) throw new Error("too big");
      // anything lost by a save (a delete, or a script wiping the list) can be put back
      const { sandboxOutfits: before = [] } = await ext.storage.local.get("sandboxOutfits");
      const patch = { sandboxOutfits: outfits };
      if (before.some((o) => !outfits.some((n) => n.id === o.id))) patch.sandboxOutfitsBackup = { at: Date.now(), outfits: before };
      await ext.storage.local.set(patch);
      return true;
    },
    async "save-draft"(data) {
      const d = data?.draft || {};
      const draft = { id: d.id ? String(d.id).slice(0, 40) : null, name: String(d.name || "").slice(0, 60), items: cleanItems(d.items) };
      if (tooBig(draft)) throw new Error("too big");
      await ext.storage.local.set({ sandboxDraft: { draft, dirty: !!data?.dirty } });
      return true;
    },
  };

  document.addEventListener("kerosene:sandbox-req", async (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    const fn = handlers[msg?.op];
    if (!fn) return reply(msg?.id, false, null, "unknown op");
    try {
      reply(msg.id, true, await fn(msg.data));
    } catch (err) {
      reply(msg.id, false, null, String(err?.message || err));
    }
  });

  // outfits saved from another tab; the Sandbox switch in the popup
  ext.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.sandboxOutfits) push({ outfits: changes.sandboxOutfits.newValue || [] });
    if (changes.enabled || changes.avatarSandbox) {
      const settings = await S.load();
      push({ enabled: Boolean(settings.enabled && settings.avatarSandbox) });
    }
  });
})();
