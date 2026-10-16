#!/usr/bin/env python3
"""Package Kerosene for each browser family.

    python3 build.py

dist/kerosene-chrome.zip   Chrome, Brave, Edge, Opera (manifest as-is)
dist/kerosene-firefox.xpi  Firefox and Zen (background scripts + gecko id)
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
INCLUDE = ["background.js", "icons", "popup", "content", "shared", "README.md"]

BACKGROUND_SCRIPTS = ["shared/compat.js", "shared/settings.js", "shared/values.js", "background.js"]


def files():
    for name in INCLUDE:
        path = ROOT / name
        if path.is_dir():
            yield from sorted(p for p in path.rglob("*") if p.is_file())
        elif path.exists():
            yield path


def firefox_manifest(manifest):
    m = json.loads(json.dumps(manifest))
    # Firefox runs MV3 backgrounds as event pages, not service workers
    m["background"] = {"scripts": BACKGROUND_SCRIPTS}
    m["browser_specific_settings"] = {
        "gecko": {
            "id": "kerosene@wozers0",
            "strict_min_version": "128.0",
            "data_collection_permissions": {"required": ["none"]},
        }
    }
    return m


def write(target, manifest):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        for path in files():
            z.write(path, path.relative_to(ROOT).as_posix())
    print(f"built {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    DIST.mkdir(exist_ok=True)
    write(DIST / "kerosene-chrome.zip", manifest)
    write(DIST / "kerosene-firefox.xpi", firefox_manifest(manifest))


if __name__ == "__main__":
    main()
