#!/usr/bin/env python3
"""gamekit.py — CLI-first authoring for SCIMA game charts (P0.5).

The editor MVP is deliberately CLI/JSON-first: author charts in any text
editor or this tool, validate + play-test them headlessly in the app's
reducer (ui/test_games.py) or here structurally, and share them as
envelope JSON or SCIMAGAME1-… share strings. The in-app editor at /games/
edits the same format with a schema-driven inspector.

Catalog lockstep: CATALOG below mirrors SCIMA_GAME_CATALOG in
site/home/shared/scima-games.js — tests-and-tools/ui/test_games.py diffs the
two so they can never drift.

Commands
  catalog                     dump the catalog as JSON (parity + tooling)
  validate FILE|-             schema/catalog-check a chart envelope or bare chart
  new NAME [--pace input|time] [--by AUTHOR]
                              starter envelope (pi-recall shape) on stdout
  list FILE                   table of objects (idx step lane type props)
  add FILE --type T --step N [--set k=v ...] [--out FILE]
  set FILE --index I [--step N] [--set k=v ...] [--out FILE]
  rm  FILE --index I [--out FILE]
  hash FILE                   content-hash id (sha256 of canonical JSON)
  share FILE                  SCIMAGAME1-… share string (skeletal + deflated)
  unshare STRING|-            decode a share string back to pretty envelope JSON
  remix FILE --by NAME [--out FILE]
                              fork: bump version, set remixOf, extend attribution

Canonical JSON = recursively key-sorted, separators=(',',':'), UTF-8 —
identical to gameCanonical() in dashboard-games.js, so ids and share
strings match across CLI, browser and tests.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import zlib

CATALOG = {
    "prompt.stream": {"lane": "prompt", "persist": True, "label": "Streaming sequence prompt", "props": {
        "source": {"type": "string", "default": "constant:pi.decimals", "label": "Source (constant:… | data: inline array)"},
        "chunk": {"type": "int", "default": 1, "min": 1, "max": 16, "label": "Chars per round"}}},
    "prompt.rounds": {"lane": "prompt", "persist": True, "label": "Round-based prompt", "props": {
        "source": {"type": "string", "default": "deck:all", "label": "Source (deck:all | data: inline array)"},
        "order": {"type": "enum", "default": "shuffle", "enum": ["shuffle", "seq"], "label": "Order"}}},
    "input.typed": {"lane": "input", "persist": True, "label": "Typed input", "props": {
        "charset": {"type": "string", "default": "0-9", "label": "Allowed charset hint"},
        "commit": {"type": "enum", "default": "perChar", "enum": ["perChar", "perSubmit"], "label": "Commit mode"},
        "maxLen": {"type": "int", "default": 32, "min": 1, "max": 256, "label": "Max buffered length"}}},
    "input.choice": {"lane": "input", "persist": True, "label": "Multiple-choice input", "props": {
        "options": {"type": "int", "default": 4, "min": 2, "max": 8, "label": "Option count"}}},
    "match.prefix": {"lane": "effect", "persist": True, "label": "Prefix/stream matcher", "props": {
        "scorePer": {"type": "enum", "default": "char", "enum": ["char", "round"], "label": "Score unit"},
        "missCost": {"type": "int", "default": 1, "min": 0, "max": 9, "label": "Lives lost per miss"}}},
    "match.exact": {"lane": "effect", "persist": True, "label": "Exact/round matcher", "props": {
        "missCost": {"type": "int", "default": 1, "min": 0, "max": 9, "label": "Lives lost per miss"}}},
    "rule.lives": {"lane": "hazard", "persist": True, "label": "Lives", "props": {
        "lives": {"type": "int", "default": 3, "min": 1, "max": 99, "label": "Life count"}}},
    "rule.timer": {"lane": "hazard", "persist": True, "label": "Countdown timer", "props": {
        "seconds": {"type": "int", "default": 60, "min": 5, "max": 3600, "label": "Seconds"}}},
    "rule.end": {"lane": "hazard", "persist": True, "label": "End conditions", "props": {
        "when": {"type": "list", "default": ["lives==0"], "enum": ["lives==0", "timer==0", "source-end"], "label": "End when"}}},
    "portal.pace": {"lane": "effect", "persist": False, "label": "Pace shift portal", "props": {
        "pace": {"type": "enum", "default": "time", "enum": ["input", "time"], "label": "New pace"},
        "beatMs": {"type": "int", "default": 500, "min": 50, "max": 10000, "label": "Beat (ms) when timed"}}},
    "portal.mode": {"lane": "effect", "persist": False, "label": "Input-mode shift portal", "props": {
        "commit": {"type": "enum", "default": "perSubmit", "enum": ["perChar", "perSubmit"], "label": "New commit mode"},
        "chunk": {"type": "int", "default": 4, "min": 1, "max": 16, "label": "New chunk size"}}},
    "event.score": {"lane": "effect", "persist": False, "label": "Instant score bonus", "props": {
        "add": {"type": "int", "default": 10, "min": -1000, "max": 1000, "label": "Points"}}},
    "cosmetic.token": {"lane": "cosmetic", "persist": False, "label": "Milestone token", "props": {
        "every": {"type": "int", "default": 10, "min": 1, "max": 1000, "label": "Every N correct"},
        "token": {"type": "string", "default": "🔥", "label": "Token"}}},
}
OBJECT_CAP = 2000
LANES = ["prompt", "input", "effect", "hazard", "cosmetic"]


# ── sanitizer mirror ──────────────────────────────────────────────────────
def sanitize_object(raw):
    if not isinstance(raw, dict):
        return None
    t = raw.get("t")
    if t not in CATALOG:
        return None
    spec = CATALOG[t]
    props = {}
    src = raw.get("props") if isinstance(raw.get("props"), dict) else {}
    for k, ps in spec["props"].items():
        v = src.get(k)
        if ps["type"] == "int":
            try:
                n = round(float(v))
            except (TypeError, ValueError):
                n = ps["default"]
            props[k] = min(ps["max"], max(ps["min"], n))
        elif ps["type"] == "enum":
            props[k] = v if v in ps["enum"] else ps["default"]
        elif ps["type"] == "list":
            arr = [x for x in (v if isinstance(v, list) else []) if x in ps["enum"]]
            props[k] = list(dict.fromkeys(arr)) or list(ps["default"])
        else:
            props[k] = str(v)[:5000] if isinstance(v, str) else ps["default"]
    step = raw.get("step")
    step = max(0, min(100000, round(step))) if isinstance(step, (int, float)) else 0
    return {"t": t, "step": step, "lane": spec["lane"], "props": props}


def sanitize_game(raw):
    if not isinstance(raw, dict):
        raw = {}
    g = raw.get("game") if isinstance(raw.get("game"), dict) else raw
    name = str(g.get("name") or "Untitled game").strip()[:80] or "Untitled game"
    grid = g.get("grid") if isinstance(g.get("grid"), dict) else {}
    pace = "time" if grid.get("pace") == "time" else "input"
    beat = grid.get("beatMs")
    beat = min(10000, max(50, round(beat))) if isinstance(beat, (int, float)) else 500
    objects = [o for o in (sanitize_object(x) for x in (g.get("objects") if isinstance(g.get("objects"), list) else [])) if o]
    objects = sorted(objects[:OBJECT_CAP], key=lambda o: o["step"])
    attribution = []
    if isinstance(g.get("attribution"), list):
        for a in g["attribution"][:50]:
            if isinstance(a, dict) and isinstance(a.get("name"), str):
                attribution.append({"name": a["name"][:80],
                                    "role": "remixer" if a.get("role") == "remixer" else "creator",
                                    "hash": (a.get("hash") or None) if isinstance(a.get("hash"), str) else None})
    remix_of = g.get("remixOf")
    remix_of = {"id": str(remix_of.get("id", ""))[:100], "name": str(remix_of.get("name", ""))[:80],
                "author": str(remix_of.get("author", ""))[:80]} if isinstance(remix_of, dict) else None
    version = g.get("version")
    version = version if isinstance(version, str) and _is_semver(version) else "1.0.0"
    return {"format": "chart", "chartVersion": 1, "name": name, "version": version,
            "remixOf": remix_of, "remixable": g.get("remixable") is not False,
            "attribution": attribution,
            "grid": {"pace": pace, "beatMs": beat, "lanes": list(LANES)},
            "objects": objects,
            "inlineData": [str(x) for x in (g.get("inlineData") if isinstance(g.get("inlineData"), list) else [])[:500]]}


def _is_semver(v):
    parts = v.split(".")
    return len(parts) == 3 and all(p.isdigit() for p in parts)


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def game_id(spec):
    return hashlib.sha256(canonical(sanitize_game(spec)).encode("utf-8")).hexdigest()


def to_skeletal(spec):
    s = sanitize_game(spec)
    objs = []
    for o in s["objects"]:
        p = {k: v for k, v in o["props"].items()
             if canonical(v) != canonical(CATALOG[o["t"]]["props"][k]["default"])}
        row = [o["t"], o["step"], LANES.index(o["lane"])]
        if p:
            row.append(p)
        objs.append(row)
    sk = {"n": s["name"], "v": s["version"],
          "g": [1 if s["grid"]["pace"] == "time" else 0,
                0 if s["grid"]["beatMs"] == 500 else s["grid"]["beatMs"]],
          "o": objs}
    if s["attribution"]:
        sk["a"] = s["attribution"]
    if s["remixOf"]:
        sk["r"] = s["remixOf"]
    if not s["remixable"]:
        sk["x"] = False
    return sk


def from_skeletal(sk):
    objs = []
    for row in sk.get("o", []):
        t, step, lane = row[0], row[1], (LANES[row[2]] if len(row) > 2 else "effect")
        objs.append({"t": t, "step": step, "lane": lane, "props": row[3] if len(row) > 3 else {}})
    return sanitize_game({"name": sk.get("n"), "version": sk.get("v"),
                          "grid": {"pace": "time" if (sk.get("g") or [0])[0] == 1 else "input",
                                   "beatMs": (sk.get("g") or [0, 0])[1] or 500},
                          "objects": objs, "attribution": sk.get("a"),
                          "remixOf": sk.get("r"), "remixable": sk.get("x", True)})


def share_string(spec):
    payload = zlib.compress(canonical(to_skeletal(spec)).encode("utf-8"), 9)
    return "SCIMAGAME1-" + base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def parse_share_string(text):
    text = text.strip()
    if not text.startswith("SCIMAGAME1-"):
        raise ValueError("not a SCIMAGAME1- share string")
    pad = text[len("SCIMAGAME1-"):]
    pad += "=" * (-len(pad) % 4)
    return from_skeletal(json.loads(zlib.decompress(base64.urlsafe_b64decode(pad)).decode("utf-8")))


def envelope(spec):
    return {"$schema": "scima", "schema": "share", "schemaVersion": 1, "kind": "game",
            "game": sanitize_game(spec)}


def read_spec(path):
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    raw = raw.strip()
    if raw.startswith("SCIMAGAME1-"):
        return parse_share_string(raw)
    data = json.loads(raw)
    return sanitize_game(data)


def write_out(path, text):
    if path:
        open(path, "w", encoding="utf-8").write(text + "\n")
    else:
        print(text)


def parse_sets(pairs):
    out = {}
    for p in pairs or []:
        k, _, v = p.partition("=")
        out[k] = v
    return out


def coerce_props(t, pairs):
    props = {}
    for k, v in pairs.items():
        ps = CATALOG[t]["props"].get(k)
        if not ps:
            raise SystemExit(f"unknown prop {k!r} for {t}")
        if ps["type"] == "int":
            props[k] = int(v)
        elif ps["type"] == "list":
            props[k] = [x for x in v.split(",") if x]
        else:
            props[k] = v
    return props


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gamekit", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog")
    p = sub.add_parser("validate"); p.add_argument("file")
    p = sub.add_parser("new"); p.add_argument("name"); p.add_argument("--pace", default="input", choices=["input", "time"]); p.add_argument("--by", default="")
    p = sub.add_parser("list"); p.add_argument("file")
    for name in ("add", "set"):
        q = sub.add_parser(name); q.add_argument("file"); q.add_argument("--out")
        q.add_argument("--type", required=(name == "add")); q.add_argument("--index", type=int, required=(name == "set"))
        q.add_argument("--step", type=int); q.add_argument("--set", action="append")
    p = sub.add_parser("rm"); p.add_argument("file"); p.add_argument("--index", type=int, required=True); p.add_argument("--out")
    p = sub.add_parser("hash"); p.add_argument("file")
    p = sub.add_parser("share"); p.add_argument("file")
    p = sub.add_parser("unshare"); p.add_argument("string")
    p = sub.add_parser("remix"); p.add_argument("file"); p.add_argument("--by", required=True); p.add_argument("--out")
    a = ap.parse_args(argv)

    if a.cmd == "catalog":
        print(json.dumps(CATALOG, indent=2, ensure_ascii=False))
    elif a.cmd == "validate":
        spec = read_spec(a.file)
        errs = []
        if not spec["objects"]:
            errs.append("chart has no objects")
        if not any(o["t"].startswith("prompt.") for o in spec["objects"]):
            errs.append("no prompt.* object")
        if not any(o["t"].startswith("input.") for o in spec["objects"]):
            errs.append("no input.* object")
        if not any(o["t"].startswith("match.") for o in spec["objects"]):
            errs.append("no match.* object")
        if errs:
            print("❌ " + "; ".join(errs), file=sys.stderr); return 1
        print(f"✓ {spec['name']} v{spec['version']} — {len(spec['objects'])} objects, id {game_id(spec)[:16]}…")
    elif a.cmd == "new":
        chart = {"name": a.name, "version": "0.1.0", "grid": {"pace": a.pace},
                 "attribution": ([{"name": a.by, "role": "creator", "hash": None}] if a.by else []),
                 "objects": [
                     {"t": "prompt.stream", "step": 0, "props": {"source": "constant:pi.decimals", "chunk": 1}},
                     {"t": "input.typed", "step": 0, "props": {"charset": "0-9", "commit": "perChar"}},
                     {"t": "match.prefix", "step": 0, "props": {"scorePer": "char", "missCost": 1}},
                     {"t": "rule.lives", "step": 0, "props": {"lives": 3}},
                     {"t": "rule.end", "step": 0, "props": {"when": ["lives==0"]}}]}
        write_out(None, json.dumps(envelope(chart), indent=2, ensure_ascii=False))
    elif a.cmd == "list":
        spec = read_spec(a.file)
        print(f"{spec['name']} v{spec['version']} pace={spec['grid']['pace']} id={game_id(spec)[:16]}")
        for i, o in enumerate(spec["objects"]):
            props = " ".join(f"{k}={v if not isinstance(v, list) else '|'.join(v)}" for k, v in o["props"].items())
            print(f"  [{i:2}] s{o['step']:<5} {o['lane']:<8} {o['t']:<15} {props}")
    elif a.cmd in ("add", "set"):
        spec = read_spec(a.file)
        if a.cmd == "add":
            obj = sanitize_object({"t": a.type, "step": a.step or 0, "props": coerce_props(a.type, parse_sets(a.set))})
            if not obj:
                raise SystemExit(f"unknown type {a.type}")
            if a.step is not None:
                obj["step"] = a.step
            spec["objects"].append(obj)
        else:
            if not (0 <= a.index < len(spec["objects"])):
                raise SystemExit("index out of range")
            o = spec["objects"][a.index]
            t = a.type or o["t"]
            merged = {**o["props"], **coerce_props(t, parse_sets(a.set))}
            new = sanitize_object({"t": t, "step": a.step if a.step is not None else o["step"], "props": merged})
            spec["objects"][a.index] = new
        spec["objects"] = sorted(spec["objects"], key=lambda o: o["step"])[:OBJECT_CAP]
        write_out(a.out, json.dumps(envelope(spec), indent=2, ensure_ascii=False))
        if a.out:
            print(f"wrote {a.out}", file=sys.stderr)
    elif a.cmd == "rm":
        spec = read_spec(a.file)
        if not (0 <= a.index < len(spec["objects"])):
            raise SystemExit("index out of range")
        spec["objects"].pop(a.index)
        write_out(a.out, json.dumps(envelope(spec), indent=2, ensure_ascii=False))
    elif a.cmd == "hash":
        print(game_id(read_spec(a.file)))
    elif a.cmd == "share":
        print(share_string(read_spec(a.file)))
    elif a.cmd == "unshare":
        raw = a.string if a.string != "-" else sys.stdin.read()
        spec = parse_share_string(raw)
        print(json.dumps(envelope(spec), indent=2, ensure_ascii=False))
    elif a.cmd == "remix":
        spec = read_spec(a.file)
        orig_id = game_id(spec)
        major, minor, patch = (int(x) for x in spec["version"].split("."))
        spec["version"] = f"{major}.{minor + 1}.0"
        creator = next((x["name"] for x in spec["attribution"] if x["role"] == "creator"), "")
        spec["remixOf"] = {"id": orig_id, "name": spec["name"], "author": creator}
        spec["attribution"] = spec["attribution"] or [{"name": creator or "unknown", "role": "creator", "hash": orig_id}]
        spec["attribution"] = spec["attribution"] + [{"name": a.by, "role": "remixer", "hash": None}]
        write_out(a.out, json.dumps(envelope(spec), indent=2, ensure_ascii=False))
        if a.out:
            print(f"remixed → {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
