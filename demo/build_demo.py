#!/usr/bin/env python3
"""Build dist/kerosene-demo.html: a single web page that runs the real
Kerosene popup and content scripts on a stand-in Octane site with sample
data, for trying the extension without installing it (e.g. on a phone).

    python3 demo/build_demo.py
"""
import colorsys
import json
import pathlib
import re
from urllib.parse import quote

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / "demo"
OUT = ROOT / "dist" / "kerosene-demo.html"


def read(rel):
    return (ROOT / rel).read_text()


def js_json(obj):
    """JSON safe to drop inside a <script> element."""
    return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/")


def inline_script(code):
    assert "</script" not in code.lower(), "script contains </script>"
    return f"<script>\n{code}\n</script>"


# ---------------------------------------------------------------- sample data
def hue_of(n):
    return (n * 47) % 360


def svg_uri(svg):
    return "data:image/svg+xml," + quote(svg, safe="")


def avatar_svg(name, n):
    h = hue_of(n)
    initial = (name.strip("#@ ") or "?")[0].upper()
    return svg_uri(
        f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>"
        f"<rect width='48' height='48' fill='hsl({h},45%,42%)'/>"
        f"<circle cx='24' cy='19' r='9' fill='hsl({h},60%,78%)'/>"
        f"<rect x='11' y='31' width='26' height='17' rx='6' fill='hsl({h},60%,78%)'/>"
        f"<text x='24' y='23' font-family='Arial' font-size='10' font-weight='700' text-anchor='middle' fill='hsl({h},45%,30%)'>{initial}</text>"
        f"</svg>"
    )


def item_svg(name, n):
    h = hue_of(n)
    words = re.findall(r"[A-Za-z0-9]+", name)
    initials = "".join(w[0] for w in words[:3]).upper() or "?"
    return svg_uri(
        f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>"
        f"<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
        f"<stop offset='0' stop-color='hsl({h},55%,58%)'/><stop offset='1' stop-color='hsl({(h + 40) % 360},55%,34%)'/>"
        f"</linearGradient></defs><rect width='120' height='120' rx='14' fill='url(#g)'/>"
        f"<path d='M30 78 L60 30 L90 78 Z' fill='rgba(255,255,255,.18)'/>"
        f"<text x='60' y='98' font-family='Arial' font-size='22' font-weight='700' text-anchor='middle' fill='rgba(255,255,255,.92)'>{initials}</text>"
        f"</svg>"
    )


def sample_values():
    """The Octomons snapshot, filled out with sample demand/trend/values so
    every badge type shows up. Clearly labelled as sample data in the UI."""
    values = json.loads((DEMO / "demo-values.json").read_text())
    for key, v in values.items():
        n = int(key)
        if v["demand"] < 0:
            v["demand"] = (n // 7) % 5
        if v["trend"] < 0:
            v["trend"] = (n // 3) % 5
        if not v["valued"] and n % 3 == 0:
            v["valued"] = True
            v["value"] = round(v["rap"] * (1.1 + (n % 5) / 10) / 5) * 5
        v["thumb"] = item_svg(v["name"], n)
    return values


VIEWER = {"id": 156, "name": "builderman", "displayName": "builderman"}

FRIENDS = [
    {"id": 261, "name": "Shedletsky", "displayName": "Shedletsky", "cycle": ["ingame", "ingame", "online"], "game": "Sword Fights on the Heights", "placeId": 47324},
    {"id": 1311, "name": "stickmasterluke", "displayName": "stickmasterluke", "cycle": ["online", "ingame"], "game": "Crossroads", "placeId": 1818, "offset": 1},
    {"id": 2032, "name": "Telamon", "displayName": "Telamon", "cycle": ["studio", "studio", "offline"]},
    {"id": 4417, "name": "Seranok", "displayName": "Seranok", "cycle": ["ingame", "online"], "game": "Natural Disaster Survival", "placeId": 189707},
    {"id": 3528, "name": "Merely", "displayName": "Merely", "cycle": ["offline", "online"], "offset": 1},
    {"id": 7210, "name": "ReeseMcBlox", "displayName": "ReeseMcBlox", "cycle": ["offline"]},
]

OTHER_USERS = {
    9001: ("John Doe", True), 9002: ("Jane Doe", False), 9003: ("Guest1337", True),
    9004: ("BuilderGirl", False), 9005: ("noob", True),
}


def sample_data(values):
    by_rap = sorted(values.values(), key=lambda v: -v["rap"])
    users = {str(f["id"]): {"name": f["name"], "online": f["cycle"][0] != "offline"} for f in FRIENDS}
    users.update({str(i): {"name": n, "online": o} for i, (n, o) in OTHER_USERS.items()})
    users[str(VIEWER["id"])] = {"name": VIEWER["name"], "online": True}
    avatars = {str(i): avatar_svg(u["name"], int(i)) for i, u in users.items()}
    inventory = [
        {"userAssetId": 50000 + i, "serialNumber": (12 if i == 0 else None), "assetId": v["id"],
         "recentAveragePrice": v["rap"], "originalPrice": 100, "assetStock": (150 if i == 0 else None),
         "assetTypeId": "Hat", "name": v["name"]}
        for i, v in enumerate([by_rap[2], by_rap[4], by_rap[6], by_rap[9], by_rap[13], by_rap[17]])
    ]
    return {
        "version": json.loads(read("manifest.json"))["version"],
        "values": values,
        "friends": FRIENDS,
        "users": users,
        "avatars": avatars,
        "inventory": inventory,
        "viewer": VIEWER,
        "trades": {
            "inbound": {"user": "Shedletsky", "give": [by_rap[4]["id"], by_rap[9]["id"]], "get": [by_rap[0]["id"], by_rap[5]["id"]], "getRobux": 100},
            "outbound": {"user": "Telamon", "give": [by_rap[2]["id"], by_rap[6]["id"]], "get": [by_rap[11]["id"]], "giveRobux": 0},
            "window": {"user": "stickmasterluke", "give": [by_rap[13]["id"]], "get": [by_rap[1]["id"], by_rap[8]["id"]]},
        },
    }


def initial_storage(data):
    by_rap = sorted(data["values"].values(), key=lambda v: -v["rap"])
    statuses = {}
    for f in FRIENDS:
        s = f["cycle"][0]
        statuses[str(f["id"])] = {
            "id": f["id"], "name": f["name"], "displayName": f["displayName"], "friend": True, "status": s,
            "location": f.get("game", "") if s == "ingame" else ("Studio" if s == "studio" else ""),
            "placeId": f.get("placeId", 0) if s == "ingame" else 0,
        }
    return {
        "viewer": VIEWER,
        "openSections": ["themes"],
        "friendStatus": statuses,
        "friendsMeta": {"checked": 0, "syncError": None, "synced": True},
        "avatars": data["avatars"],
        "calc": {"give": [by_rap[3]["id"]], "get": [by_rap[7]["id"], by_rap[12]["id"]], "giveRobux": 0, "getRobux": 150},
    }


# ---------------------------------------------------------------- extension sources (lightly patched)
def content_scripts():
    engine = read("content/engine.js")
    values = read("content/values.js")
    # the demo's site panel stands in for a top-level octane.wtf tab
    old = "const embedded = window.top !== window;"
    assert old in engine
    engine = engine.replace(old, "const embedded = window.__keroTop ? false : window.top !== window;")
    # srcdoc frames have no real path; the demo tells values.js which page it is
    assert values.count("location.pathname") == 2
    values = values.replace("location.pathname", "(window.__keroPath || location.pathname)")
    order = ["shared/compat.js", "shared/settings.js", "shared/themes.js", "shared/values.js", "shared/char-field.js"]
    return [read(p) for p in order] + [engine, values]


def popup_document(data_json, mock):
    html = read("popup/popup.html")
    css = read("popup/popup.css") + """
/* demo: the popup lives in a resizable frame instead of a 380px toolbar popup */
html, body { width: 100% !important; }
body { min-height: 0 !important; max-height: none !important; height: 100vh; }
.shell { min-height: 100vh; }
"""
    html = html.replace('<link rel="stylesheet" href="popup.css">', f"<style>\n{css}\n</style>")
    # image links can't load inside the published demo (its CSP only allows data: images); uploads can
    html = html.replace("</body>", inline_script(
        "(function () { var u = document.getElementById('bg-url'); if (u) u.closest('.inline').style.display = 'none';"
        " var l = document.querySelector('.field-label'); if (l) l.textContent = 'Your own image, GIF or video'; })();"
    ) + "</body>")
    popup_js = read("popup/popup.js")
    old = "const IS_FIREFOX = /firefox/i.test(navigator.userAgent);"
    assert old in popup_js
    # the demo has no extension tab to open; uploads work in place
    popup_js = popup_js.replace(old, "const IS_FIREFOX = !window.__keroDemo && /firefox/i.test(navigator.userAgent);")
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    first = True
    for src in scripts:
        rel = str(pathlib.PurePosixPath("popup") / src).replace("popup/../", "")
        code = popup_js if rel == "popup/popup.js" else read(rel)
        tag = inline_script(code)
        if first:
            tag = "<!--KERO_INIT-->" + inline_script(f"window.__keroData={data_json};") + inline_script(mock) + tag
            first = False
        html = html.replace(f'<script src="{src}"></script>', tag, 1)
    return html


SITE_CSS = r"""
/* Stand-in for Octane's Roblox 2021/22 frontend: light-theme / dark-theme classes like the real one */
* { box-sizing: border-box; }
html { background-color: #f2f4f5; }
html.octane-dark { background-color: #232527; }
body { margin: 0; font-family: "HCo Gotham SSm", "Montserrat", "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 14px; }
body.light-theme { background-color: #f2f4f5; color: #393b3d; }
body.dark-theme { background-color: #232527; color: #ffffff; }
a { text-decoration: none; color: inherit; }
h1, h2, h3 { margin: 0; }
.icon-robux { font-size: 0.85em; font-weight: 700; opacity: 0.8; margin-right: 2px; }

#navigation-container { position: sticky; top: 0; z-index: 5; }
#header.rbx-header { position: relative; height: 46px; display: flex; align-items: center; gap: 20px; padding: 0 14px; }
.light-theme .rbx-header { background-color: #ffffff; box-shadow: 0 1px 0 #e3e3e3; }
.dark-theme .rbx-header { background-color: #191b1d; box-shadow: 0 1px 0 #111213; }
.navbar-brand { font-weight: 800; font-size: 19px; letter-spacing: 1.5px; }
.light-theme .text-header, .light-theme .navbar-brand { color: #393b3d; }
.dark-theme .text-header, .dark-theme .navbar-brand { color: #ffffff; }
.rbx-navbar { display: flex; gap: 18px; list-style: none; margin: 0; padding: 0; font-weight: 500; }
.navbar-search { flex: 1; max-width: 300px; margin-left: auto; }
.input-field { width: 100%; height: 30px; border-radius: 8px; padding: 0 10px; font: inherit; font-size: 13px; }
.light-theme .input-field { background-color: #ffffff; border: 1px solid #b8b8b8; color: #393b3d; }
.dark-theme .input-field { background-color: #191b1d; border: 1px solid #4f5153; color: #ffffff; }
.text-robux-nav { font-weight: 600; white-space: nowrap; }

.rbx-left-col { position: fixed; top: 46px; bottom: 0; left: 0; width: 176px; padding-top: 10px; }
.light-theme .rbx-left-col { background-color: #ffffff; box-shadow: 1px 0 0 #e3e3e3; }
.dark-theme .rbx-left-col { background-color: #191b1d; }
.left-col-list { list-style: none; margin: 0; padding: 0; }
.left-col-list .text-lead { padding: 6px 16px 10px; font-weight: 700; }
.left-col-list a.text-nav { display: block; padding: 9px 16px; font-weight: 500; }
.light-theme .left-col-list a.text-nav:hover, .light-theme .left-col-list a.active { background-color: #eeeeee; }
.dark-theme .left-col-list a.text-nav:hover, .dark-theme .left-col-list a.active { background-color: #393b3d; }

.content { margin-left: 176px; padding: 24px 28px 40px; display: flex; flex-direction: column; gap: 22px; }
.section h2, .container-header h2 { font-size: 19px; font-weight: 700; margin-bottom: 10px; }
.section-content { border-radius: 8px; padding: 14px; }
.light-theme .section-content { background-color: #ffffff; box-shadow: 0 1px 4px rgba(25, 25, 25, 0.08); }
.dark-theme .section-content { background-color: #393b3d; }
.light-theme .text-secondary { color: #606162; }
.dark-theme .text-secondary { color: #bdbebe; }
.light-theme .text-link { color: #0074bd; }
.dark-theme .text-link { color: #00a2ff; }
.home-header { display: flex; align-items: center; gap: 14px; }
.home-header img { width: 64px; height: 64px; border-radius: 50%; }
.font-header-1 { font-size: 28px; font-weight: 700; }

.friends-row { display: flex; gap: 16px; overflow-x: auto; }
.friend-tile { width: 76px; text-align: center; font-size: 12px; flex-shrink: 0; }
.friend-tile .avatar { position: relative; width: 64px; height: 64px; margin: 0 auto 6px; }
.friend-tile img { width: 64px; height: 64px; border-radius: 50%; display: block; }
.friend-tile .dot { position: absolute; right: 1px; bottom: 1px; width: 15px; height: 15px; border-radius: 50%; border: 2px solid #ffffff; }
.dark-theme .friend-tile .dot { border-color: #393b3d; }
.dot.online { background-color: #00b06f; } .dot.ingame { background-color: #00a2ff; } .dot.studio { background-color: #f68802; }
.friend-tile .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.game-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
.game-card-thumb { aspect-ratio: 1; border-radius: 8px; }
.game-card-name { font-weight: 600; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.item-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(126px, 1fr)); gap: 14px; list-style: none; margin: 0; padding: 0; }
.item-card-container { display: flex; flex-direction: column; gap: 4px; }
.item-card-thumb-container img { width: 100%; aspect-ratio: 1; display: block; border-radius: 8px; }
.light-theme .item-card-thumb-container { background-color: #ffffff; border-radius: 8px; }
.item-card-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-card-price { font-size: 13px; }
.light-theme .text-robux { color: #02b757; } .dark-theme .text-robux { color: #00b06f; }

.btn-row { display: flex; flex-wrap: wrap; gap: 10px; }
[class*="btn-"] { border-radius: 8px; padding: 9px 18px; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; border: 1px solid transparent; }
.btn-growth-md { background-color: #00b06f; border-color: #00b06f; color: #ffffff; }
.btn-primary-md, .btn-cta-md { background-color: #00a2ff; border-color: #00a2ff; color: #ffffff; }
.light-theme .btn-control-md { background-color: #ffffff; border-color: #b8b8b8; color: #393b3d; }
.dark-theme .btn-control-md { background-color: transparent; border-color: #bdbebe; color: #ffffff; }

/* trades */
.trades { display: grid; grid-template-columns: 230px 1fr; gap: 20px; align-items: start; }
.trade-row { padding: 10px 12px; border-radius: 8px; cursor: pointer; display: flex; gap: 10px; align-items: center; }
.trade-row img { width: 38px; height: 38px; border-radius: 50%; }
.light-theme .trade-row.selected { background-color: #ffffff; box-shadow: 0 1px 4px rgba(25, 25, 25, 0.08); }
.dark-theme .trade-row.selected { background-color: #393b3d; }
.text-date-hint { font-size: 12px; }
.light-theme .text-date-hint { color: #606162; } .dark-theme .text-date-hint { color: #bdbebe; }
.trade-list-detail-offer { padding: 14px 0; display: flex; flex-direction: column; gap: 10px; }
.light-theme .rbx-divider { border-top: 1px solid #e3e3e3; } .dark-theme .rbx-divider { border-top: 1px solid #4f5153; }
.trade-list-detail-offer-header { font-size: 16px; font-weight: 600; }
.robux-line { display: flex; justify-content: space-between; max-width: 420px; }
.robux-line.ng-hide { display: none; }
.text-robux-lg { font-weight: 700; font-size: 16px; }
.trade-buttons { display: flex; flex-wrap: wrap; gap: 10px; }

.trade-request-window-offers { display: flex; flex-direction: column; gap: 14px; }
#their-offer { order: -1; } /* DOM order stays mine-then-theirs, as on Octane */
.trade-request-window-offer { padding: 14px; border-radius: 8px; display: flex; flex-direction: column; gap: 10px; }
.light-theme .trade-request-window-offer { background-color: #ffffff; box-shadow: 0 1px 4px rgba(25, 25, 25, 0.08); }
.dark-theme .trade-request-window-offer { background-color: #393b3d; }
.slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.trade-request-item { position: relative; display: flex; flex-direction: column; gap: 3px; font-size: 12px; min-width: 0; }
.trade-request-item img { width: 100%; aspect-ratio: 1; border-radius: 8px; display: block; }
.trade-request-item .item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trade-request-item.blank-item { aspect-ratio: 1; border-radius: 8px; border: 2px dashed rgba(127, 127, 127, 0.35); }
.remove-item { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0; background-color: rgba(0, 0, 0, 0.6); color: #ffffff; font-size: 14px; line-height: 22px; cursor: pointer; }
.robux-input-group input { max-width: 200px; }
.trade-inventory-panel .item-card-container { cursor: pointer; }
.trade-inventory-panel .in-offer { opacity: 0.4; }

/* item page */
#item-container { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 24px; align-items: start; }
.item-thumb img { width: 100%; border-radius: 10px; display: block; }
.item-name-container h1 { font-size: 26px; font-weight: 700; }
#item-details { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
.price-container { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.field-label { font-size: 13px; }
.light-theme .field-label { color: #606162; } .dark-theme .field-label { color: #bdbebe; }
.item-field-container { display: flex; gap: 14px; }
.item-field-container .field-label { width: 90px; flex-shrink: 0; }
.limited-tag { display: inline-block; margin-left: 8px; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; vertical-align: middle; background-color: #02b757; color: #ffffff; }

@media (max-width: 760px) {
  .rbx-left-col, .rbx-navbar .wide, .navbar-search { display: none; }
  #header.rbx-header { gap: 14px; }
  .content { margin-left: 0; padding: 18px 16px 32px; }
  .trades, #item-container { grid-template-columns: 1fr; }
  .trade-inventory-panel .item-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
}
"""

# Octane's own theme switcher works like this (localStorage.rbx_theme_v1 + an
# "octane-theme-change" event); the stand-in keeps the same contract so the
# extension switches modes exactly as it does on the real site.
SITE_THEME_SCRIPT = r"""
(function () {
  var root = document.documentElement;
  function dark() {
    try { var v = localStorage.getItem('rbx_theme_v1'); return v ? v === 'dark' : true; } catch (e) { return true; }
  }
  function apply() {
    var d = dark();
    root.classList.toggle('octane-dark', d);
    document.querySelectorAll('.light-theme, .dark-theme').forEach(function (el) {
      el.classList.toggle('dark-theme', d);
      el.classList.toggle('light-theme', !d);
    });
  }
  window.__octaneApplyTheme = apply;
  addEventListener('octane-theme-change', apply);
  addEventListener('DOMContentLoaded', apply);
})();
"""

SITE_PAGE_SCRIPT = r"""
(function () {
  var D = window.__keroData, I = window.__keroInit || {};
  var V = D.values, viewer = D.viewer, page = I.page || 'home';
  var fmt = function (n) { return Math.round(n || 0).toLocaleString('en-US'); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var slug = function (s) { return String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var item = function (id) { return V[id] || { id: id, name: 'Item #' + id, rap: 0, thumb: '' }; };
  var cat = function (v) { return '/catalog/' + v.id + '/' + slug(v.name); };
  var friendsById = {}; (D.friends || []).forEach(function (f) { friendsById[f.name] = f; });

  function itemCard(v, attrs, cls) {
    return '<div class="item-card-container' + (cls ? ' ' + cls : '') + '"' + (attrs || '') + '>' +
      '<a class="item-card-link" href="' + cat(v) + '"><div class="item-card-thumb-container"><img alt="" src="' + v.thumb + '"></div>' +
      '<div class="item-card-name" title="' + esc(v.name) + '">' + esc(v.name) + '</div></a>' +
      '<div class="text-overflow item-card-price"><span class="icon-robux">R$</span><span class="text-robux">' + fmt(v.rap) + '</span></div></div>';
  }

  function home() {
    var st = I.storage.friendStatus || {};
    var friends = (D.friends || []).map(function (f) {
      var s = (st[f.id] || {}).status || 'offline';
      return '<div class="friend-tile"><div class="avatar"><img alt="" src="' + D.avatars[f.id] + '">' +
        (s !== 'offline' ? '<span class="dot ' + s + '"></span>' : '') + '</div><div class="name">' + esc(f.displayName) + '</div></div>';
    }).join('');
    var games = [['Crossroads', 200], ['Sword Fights on the Heights', 10], ['Natural Disaster Survival', 150], ['Work at a Pizza Place', 30], ['Welcome to Bloxburg', 260]]
      .map(function (g) {
        return '<div class="game-card"><div class="game-card-thumb" style="background:linear-gradient(135deg,hsl(' + g[1] + ',55%,55%),hsl(' + (g[1] + 50) + ',55%,30%))"></div>' +
          '<div class="game-card-name">' + g[0] + '</div><div class="text-secondary" style="font-size:12px">' + (g[1] % 40 + 3) + ' playing</div></div>';
      }).join('');
    var lims = (D.inventory || []).map(function (u) { return '<li>' + itemCard(item(u.assetId)) + '</li>'; }).join('');
    return '<div class="home-header"><img alt="" src="' + D.avatars[viewer.id] + '"><h1 class="font-header-1">Hello, ' + esc(viewer.displayName) + '!</h1></div>' +
      '<div class="section"><div class="container-header"><h2>Friends (' + D.friends.length + ')</h2></div><div class="section-content friends-row">' + friends + '</div></div>' +
      '<div class="section"><div class="container-header"><h2>Continue Playing</h2></div><div class="game-cards">' + games + '</div></div>' +
      '<div class="section"><div class="container-header"><h2>My Limiteds</h2></div><ul class="item-cards">' + lims + '</ul></div>' +
      '<div class="btn-row"><button class="btn-growth-md">Play</button><button class="btn-primary-md">Join Group</button><button class="btn-control-md">Message</button></div>';
  }

  function detailOffer(label, ids, robuxNet) {
    var total = ids.reduce(function (s, id) { return s + item(id).rap; }, 0) + (robuxNet || 0);
    return '<div class="trade-list-detail-offer"><div class="rbx-divider"></div><h3 class="trade-list-detail-offer-header">' + label + '</h3>' +
      '<ul class="item-cards item-cards-stackable">' + ids.map(function (id) { return '<li class="list-item item-card trade-item-card"><div>' + itemCard(item(id)) + '</div></li>'; }).join('') + '</ul>' +
      '<div><div class="robux-line' + (robuxNet ? '' : ' ng-hide') + '"><span class="text-label">Robux offered after 30% fee</span><span class="robux-line-amount"><span class="text-label robux-line-value">' + fmt(robuxNet) + '</span></span></div>' +
      '<div class="robux-line"><span class="text-lead">Total Value</span><span class="robux-line-amount"><span class="icon-robux">R$</span><span class="text-robux-lg robux-line-value">' + fmt(total) + '</span></span></div></div></div>';
  }

  function trades() {
    var list = [['inbound', 'Inbound'], ['outbound', 'Outbound']];
    var sel = window.__selTrade || 'inbound';
    var t = D.trades[sel];
    var rows = list.map(function (l) {
      var tr = D.trades[l[0]], f = friendsById[tr.user] || {};
      return '<div class="trade-row' + (l[0] === sel ? ' selected' : '') + '" data-trade="' + l[0] + '"><img alt="" src="' + (D.avatars[f.id] || '') + '"><div><div class="text-lead">' + esc(tr.user) + '</div><div class="text-date-hint">' + l[1] + ' · 10/16/26</div></div></div>';
    }).join('');
    return '<div class="section"><h2>Trades</h2></div><div class="trades"><div class="trade-row-list">' + rows + '</div>' +
      '<div class="trades-list-detail"><h2 class="trades-header-nowrap">Trade with <b>' + esc(t.user) + '</b></h2>' +
      '<div class="col-xs-12">' +
      detailOffer('Items you will give', t.give, Math.round((t.giveRobux || 0) * 0.7)) +
      detailOffer('Items you will receive', t.get, Math.round((t.getRobux || 0) * 0.7)) +
      '</div><div class="trade-buttons">' + (sel === 'inbound' ? '<button class="btn-cta-md">Accept</button><button class="btn-control-md">Counter</button>' : '') + '<button class="btn-control-md">Decline</button></div></div></div>';
  }

  var offer = { give: null };
  function newTrade() {
    var t = D.trades.window;
    if (!offer.give) offer.give = t.give.slice();
    var slot = function (id, removable) {
      var v = item(id);
      return '<div class="trade-request-item" data-userassetid="' + id + '9">' + (removable ? '<button class="remove-item" data-remove="' + id + '" aria-label="Remove">×</button>' : '') +
        '<img alt="" src="' + v.thumb + '"><div class="text-lead item-name" title="' + esc(v.name) + '"><a href="' + cat(v) + '">' + esc(v.name) + '</a></div>' +
        '<div class="item-value"><span class="icon-robux">R$</span><span class="text-robux">' + fmt(v.rap) + '</span></div></div>';
    };
    var blanks = function (n) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="trade-request-item blank-item"></div>'; return s; };
    var offerHtml = function (label, ids, removable, robux, id) {
      return '<div class="trade-request-window-offer" id="' + id + '"><h3>' + label + '</h3><div class="slots">' + ids.map(function (i) { return slot(i, removable); }).join('') + blanks(4 - ids.length) + '</div>' +
        '<div class="input-group robux-input-group"><input class="form-control input-field" name="robux" type="text" inputmode="numeric" placeholder="+ Robux amount" value="' + esc(robux || '') + '"></div></div>';
    };
    var inv = (D.inventory || []).map(function (u) {
      var inOffer = offer.give.indexOf(u.assetId) >= 0;
      return '<li>' + itemCard(item(u.assetId), ' data-add="' + u.assetId + '"', inOffer ? 'in-offer' : '') + '</li>';
    }).join('');
    return '<div class="section"><h2>Trade with <b>' + esc(t.user) + '</b></h2><p class="text-secondary" style="margin:6px 0 0">Tap items in your inventory (below) to add them, × to remove, or type Robux.</p></div>' +
      '<div class="trade-request-window-offers">' + offerHtml('Your Offer', offer.give, true, window.__giveRobux, 'my-offer') + offerHtml('Their Offer', t.get, false, window.__getRobux, 'their-offer') +
      '<button class="btn-cta-md">Make Offer</button></div>' +
      '<div class="trade-inventory-panel section"><h3 style="margin-bottom:10px">Your inventory</h3><ul class="item-cards">' + inv + '</ul></div>';
  }

  function itemPage() {
    var id = I.itemId, v = item(id);
    var others = Object.keys(V).map(function (k) { return V[k]; }).sort(function (a, b) { return b.rap - a.rap; })
      .filter(function (o) { return o.id !== v.id; }).slice(0, 6);
    return '<div id="item-container"><div class="item-thumb"><img alt="" src="' + v.thumb + '"></div><div>' +
      '<div class="item-name-container"><h1>' + esc(v.name) + '<span class="limited-tag">LIMITED</span></h1><div class="text-secondary" style="margin-top:4px">By ROBLOX</div></div>' +
      '<div id="item-details" class="item-details"><div class="clearfix price-container"><div><div class="field-label">Best price</div><div class="text-robux-lg"><span class="icon-robux">R$</span>' + fmt(v.bestPrice || v.rap) + '</div></div>' +
      '<button class="btn-growth-md">Buy</button></div>' +
      '<div class="item-field-container"><div class="field-label">Type</div><div>Hat</div></div>' +
      '<div class="item-field-container"><div class="field-label">Description</div><div class="text-secondary">A collectible from Octane\'s catalog.</div></div></div></div></div>' +
      '<div class="section"><div class="container-header"><h2>Other limiteds</h2></div><ul class="item-cards">' + others.map(function (o) { return '<li>' + itemCard(o) + '</li>'; }).join('') + '</ul></div>';
  }

  var pages = { home: home, trades: trades, newtrade: newTrade, item: itemPage };
  var main = document.getElementById('main');
  function render() { main.innerHTML = (pages[page] || home)(); }
  render();

  document.addEventListener('click', function (e) {
    var row = e.target.closest('[data-trade]');
    if (row) { window.__selTrade = row.getAttribute('data-trade'); render(); return; }
    var rm = e.target.closest('[data-remove]');
    if (rm) { e.preventDefault(); offer.give.splice(offer.give.indexOf(Number(rm.getAttribute('data-remove'))), 1); keepRobux(); render(); return; }
    var add = e.target.closest('[data-add]');
    if (add && page === 'newtrade') {
      e.preventDefault();
      var id = Number(add.getAttribute('data-add'));
      if (offer.give.indexOf(id) < 0 && offer.give.length < 4) offer.give.push(id);
      keepRobux(); render(); return;
    }
    var a = e.target.closest('a[href]');
    if (!a) return;
    var url = new URL(a.getAttribute('href'), 'https://octane.wtf/');
    if (url.hostname !== 'octane.wtf') return; // e.g. "View on Octomons" opens in a new tab
    e.preventDefault();
    parent.postMessage({ kero: 1, type: 'navigate', url: url.href }, '*');
  });

  var NAV = { home: '/home', trades: '/trades', newtrade: '/trades' };
  function updateNav() {
    document.querySelectorAll('.left-col-list a.text-nav').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === NAV[page]);
    });
  }
  updateNav();

  // client-side navigation from the demo shell
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.kero !== 1 || d.type !== 'page') return;
    page = d.page;
    I.itemId = d.itemId;
    window.__keroPath = d.path || '';
    render();
    updateNav();
    window.scrollTo(0, 0);
  });

  if (window.ext) {
    ext.storage.onChanged.addListener(function (c) {
      if (c.friendStatus && page === 'home') { I.storage.friendStatus = c.friendStatus.newValue; render(); }
    });
  }
  function keepRobux() {
    var mine = document.querySelector('#my-offer input[name="robux"]');
    var theirs = document.querySelector('#their-offer input[name="robux"]');
    if (mine) window.__giveRobux = mine.value;
    if (theirs) window.__getRobux = theirs.value;
  }
})();
"""


def site_document(data_json, mock, scripts):
    nav = "".join(
        f'<li><a class="text-nav" href="{href}">{label}</a></li>'
        for label, href in ([
            ("Home", "/home"), ("Profile", "/users/156/profile"), ("Friends", "/users/friends"),
            ("Avatar", "/my/avatar"), ("Inventory", "/users/156/limiteds"), ("Trade", "/trades"), ("Groups", "/groups"),
        ])
    )
    head_scripts = "<!--KERO_INIT-->" + inline_script(f"window.__keroData={data_json};") + inline_script(mock) + "".join(inline_script(s) for s in scripts)
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Octane</title>
{head_scripts}
<style>{SITE_CSS}</style>
{inline_script(SITE_THEME_SCRIPT)}
</head><body class="rbx-body light-theme gotham-font">
<div id="navigation-container" class="light-theme gotham-font">
<div id="header" class="navbar-fixed-top rbx-header" role="navigation">
<a class="navbar-brand" href="/home">OCTANE</a>
<ul class="nav rbx-navbar"><li><a class="font-header-2 nav-menu-title text-header" href="/games">Discover</a></li><li class="wide"><a class="font-header-2 nav-menu-title text-header" href="/catalog">Avatar Shop</a></li><li class="wide"><a class="font-header-2 nav-menu-title text-header" href="/develop">Create</a></li></ul>
<div class="navbar-search"><input class="form-control input-field" placeholder="Search"></div>
<span class="text-robux-nav text-header"><span class="icon-robux">R$</span>1,250</span>
</div>
<div id="navigation" class="rbx-left-col"><ul class="left-col-list"><li class="text-lead">builderman</li>{nav}</ul></div>
</div>
{inline_script("window.__octaneApplyTheme();")}
<div id="main" class="content"></div>
{inline_script(SITE_PAGE_SCRIPT)}
</body></html>"""


def main():
    values = sample_values()
    data = sample_data(values)
    data_json = js_json(data)
    mock = (DEMO / "mock-ext.js").read_text()
    popup = popup_document(data_json, mock)
    site = site_document(data_json, mock, content_scripts())
    shell = (DEMO / "shell.html").read_text()
    bundle = js_json({"popup": popup, "site": site, "storage": initial_storage(data), "values": {k: {"name": v["name"]} for k, v in values.items()}})
    out = shell.replace("/*__KERO_BUNDLE__*/null", bundle)
    assert out != shell, "bundle placeholder missing in shell.html"
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(out)
    print(f"built {OUT.relative_to(ROOT)} ({len(out) // 1024} KB)")


if __name__ == "__main__":
    main()
