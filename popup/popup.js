const DEFAULTS = { enabled: true, animatedBg: true, openSections: ["general"] };

const storage = {
  async get() {
    if (globalThis.chrome?.storage?.sync) {
      return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    }
    return { ...DEFAULTS };
  },
  async set(patch) {
    if (globalThis.chrome?.storage?.sync) await chrome.storage.sync.set(patch);
  },
};

function applyEffects(settings) {
  document.body.classList.toggle("off", !settings.enabled);
  document.querySelector(".status").lastChild.textContent = settings.enabled ? " ready" : " disabled";
  window.KeroseneBg?.setRunning(settings.animatedBg);
}

async function init() {
  const settings = await storage.get();

  if (globalThis.chrome?.runtime?.getManifest) {
    document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;
  }

  // toggles
  for (const input of document.querySelectorAll("[data-setting]")) {
    const key = input.dataset.setting;
    input.checked = Boolean(settings[key]);
    input.addEventListener("change", async () => {
      settings[key] = input.checked;
      applyEffects(settings);
      await storage.set({ [key]: input.checked });
    });
  }

  // dropdowns remember which ones were open
  const drops = document.querySelectorAll("details.drop");
  for (const d of drops) {
    d.open = settings.openSections.includes(d.dataset.key);
    d.addEventListener("toggle", () => {
      const open = [...drops].filter((x) => x.open).map((x) => x.dataset.key);
      storage.set({ openSections: open });
    });
  }

  applyEffects(settings);
}

init();
