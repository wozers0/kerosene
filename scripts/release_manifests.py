#!/usr/bin/env python3
"""Write the files that point browsers at the latest release.

    python3 scripts/release_manifests.py 0.4.0 "Avatar sandbox, update button"

version.json  read by Kerosene's update button (version, notes, download links)
updates.json  Firefox's update manifest (signed .xpi per version), see
              https://extensionworkshop.com/documentation/manage/updating-your-extension/
"""
import datetime
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = "wozers0/kerosene"
GECKO_ID = "kerosene@wozers0"


def main():
    version = sys.argv[1]
    notes = sys.argv[2] if len(sys.argv) > 2 else ""
    base = f"https://github.com/{REPO}/releases/download/v{version}"
    info = {
        "version": version,
        "notes": notes,
        "released": datetime.date.today().isoformat(),
        "firefox": f"{base}/kerosene-firefox.xpi",
        "chrome": f"{base}/kerosene-chrome.zip",
        "page": f"https://github.com/{REPO}/releases/tag/v{version}",
    }
    # The update button downloads the signed file from the repo itself (the
    # release asset can't be fetched by an extension) and checks it against this.
    xpi = ROOT / "dist" / "kerosene-firefox.xpi"
    if xpi.exists():
        data = xpi.read_bytes()
        info["firefox_xpi"] = f"https://raw.githubusercontent.com/{REPO}/main/dist/kerosene-firefox.xpi"
        info["firefox_sha256"] = hashlib.sha256(data).hexdigest()
        info["firefox_size"] = len(data)
    (ROOT / "version.json").write_text(json.dumps(info, indent=2) + "\n")
    updates = {"addons": {GECKO_ID: {"updates": [{"version": version, "update_link": info["firefox"]}]}}}
    (ROOT / "updates.json").write_text(json.dumps(updates, indent=2) + "\n")
    print(f"version.json + updates.json -> {version}")


if __name__ == "__main__":
    main()
