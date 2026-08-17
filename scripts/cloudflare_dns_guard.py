#!/usr/bin/env python3
"""Dry-run by default; only reconciles apex/www A, AAAA and CNAME records."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

TOKEN = os.environ["CF_API_TOKEN"]
ZONE = os.environ["CF_ZONE_ID"]
PROJECT = os.environ["CF_PAGES_PROJECT"]
APPLY = os.environ.get("APPLY_DNS", "false").lower() == "true"
API = f"https://api.cloudflare.com/client/v4/zones/{ZONE}"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

def request(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(API + path, data=data, method=method, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8", "replace")) from error
    if not body.get("success"):
        raise RuntimeError(json.dumps(body.get("errors", [])))
    return body["result"]

zone = request("GET", "")
apex = zone["name"].rstrip(".")
allowed_names = {apex, f"www.{apex}"}
allowed_types = {"A", "AAAA", "CNAME"}
records = request("GET", "/dns_records?" + urllib.parse.urlencode({"per_page": 500}))
managed = [record for record in records if record["name"] in allowed_names and record["type"] in allowed_types]
target = f"{PROJECT}.pages.dev"

print(f"mode={'APPLY' if APPLY else 'DRY_RUN'} zone={apex} target={target}")
for record in managed:
    print(f"delete {record['type']} {record['name']} -> {record['content']}")
for name in sorted(allowed_names):
    print(f"create CNAME {name} -> {target} proxied=true")
if not APPLY:
    print("Dry run only. Re-run with apply_dns=true after reviewing this plan.")
    sys.exit(0)
for record in managed:
    request("DELETE", f"/dns_records/{record['id']}")
for name in sorted(allowed_names):
    request("POST", "/dns_records", {"type": "CNAME", "name": name, "content": target, "proxied": True, "ttl": 1})
print("Applied only apex/www A, AAAA and CNAME changes; MX/TXT/CAA/NS were untouched.")
