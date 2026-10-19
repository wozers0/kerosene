"""Prepares the stats Worker's Cloudflare side for stats.yml: finds or creates
the KV namespace, makes sure the account has a workers.dev subdomain, writes
stats/wrangler.toml, and prints the Worker's address for the workflow.

Needs CF_TOKEN (an API token from the "Edit Cloudflare Workers" template) and
CF_ACCOUNT (the account ID) in the environment.
"""
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ["CF_TOKEN"]
ACCOUNT = os.environ["CF_ACCOUNT"]
NAME = "kerosene-stats"


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.load(err)
        except ValueError:
            return err.code, {}


def kv_namespace():
    status, data = call("GET", f"/accounts/{ACCOUNT}/storage/kv/namespaces?per_page=100")
    if status != 200 or not data.get("success"):
        sys.exit(f"Couldn't list KV namespaces (HTTP {status}): {data.get('errors')}")
    for ns in data.get("result") or []:
        if ns.get("title") == NAME:
            return ns["id"]
    status, data = call("POST", f"/accounts/{ACCOUNT}/storage/kv/namespaces", {"title": NAME})
    if status != 200 or not data.get("success"):
        sys.exit(f"Couldn't create the KV namespace (HTTP {status}): {data.get('errors')}")
    print("Created KV namespace", NAME)
    return data["result"]["id"]


def subdomain():
    status, data = call("GET", f"/accounts/{ACCOUNT}/workers/subdomain")
    sub = (data.get("result") or {}).get("subdomain") if status == 200 else None
    if sub:
        return sub
    # a new account has none yet: pick one
    wanted = f"kerosene-{secrets.token_hex(3)}"
    status, data = call("PUT", f"/accounts/{ACCOUNT}/workers/subdomain", {"subdomain": wanted})
    if status != 200 or not data.get("success"):
        sys.exit(f"Couldn't set a workers.dev subdomain (HTTP {status}): {data.get('errors')}")
    print("Created workers.dev subdomain", wanted)
    return wanted


def main():
    ns = kv_namespace()
    sub = subdomain()
    here = os.path.dirname(os.path.abspath(__file__))
    toml = os.path.join(here, "..", "stats", "wrangler.toml")
    with open(toml, "w") as f:
        f.write(
            f'name = "{NAME}"\n'
            'main = "worker.js"\n'
            'compatibility_date = "2024-09-23"\n'
            "workers_dev = true\n"
            f'kv_namespaces = [{{ binding = "STATS", id = "{ns}" }}]\n'
            "\n[triggers]\n"
            'crons = ["5 0 * * *"]\n'
        )
    url = f"https://{NAME}.{sub}.workers.dev"
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"url={url}\n")
    print("Worker address:", url)


if __name__ == "__main__":
    main()
