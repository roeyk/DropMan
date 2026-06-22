#!/usr/bin/env python3
"""Remove stale DropMan runtime claim entries from kwinrc.

The DropMan profile table lives in [Script-dropman] profilesJson. Runtime
claims live in [Script-dropman] claimsJson and can contain stale keys after
profile IDs are renamed. This script keeps only claim keys that still exist in
profilesJson, backs up kwinrc, and mirrors the cleaned claimsJson to the
DropMan Slide effect config groups.
"""

from __future__ import annotations

import configparser
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


EFFECT_GROUPS = [
    "Effect-dropman_slide",
    "Effect-kwin4_effect_dropman_slide",
    "Effect-kwin_wayland4_effect_dropman_slide",
    "Effect-kwin4_effect_dropman-slide",
    "Effect-kwin_wayland4_effect_dropman-slide",
]


def load_json(raw: str, label: str) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"Could not parse {label}: {error}") from error
    if not isinstance(data, dict):
        raise SystemExit(f"{label} is not a JSON object")
    return data


def main() -> int:
    path = Path.home() / ".config" / "kwinrc"
    if not path.exists():
        print(f"kwinrc not found: {path}", file=sys.stderr)
        return 1

    config = configparser.RawConfigParser()
    config.optionxform = str
    config.read(path)

    if "Script-dropman" not in config:
        print("[Script-dropman] not found; nothing to clean")
        return 0

    script_group = config["Script-dropman"]
    profiles_json = load_json(script_group.get("profilesJson", ""), "profilesJson")
    profiles = profiles_json.get("bindings", [])
    valid_ids = {
        str(profile.get("id", "")).strip()
        for profile in profiles
        if isinstance(profile, dict) and str(profile.get("id", "")).strip()
    }

    if not valid_ids:
        print("No profile ids found in profilesJson; refusing to modify claims", file=sys.stderr)
        return 1

    claims_json = load_json(script_group.get("claimsJson", ""), "claimsJson")
    claims = claims_json.get("claims", {})
    if not isinstance(claims, dict):
        print("claimsJson.claims is not an object; refusing to modify claims", file=sys.stderr)
        return 1

    cleaned_claims = {key: value for key, value in claims.items() if key in valid_ids}
    removed = sorted(set(claims) - set(cleaned_claims))

    claims_json["schemaVersion"] = claims_json.get("schemaVersion", 1)
    claims_json["claims"] = cleaned_claims
    compact_claims_json = json.dumps(claims_json, separators=(",", ":"), sort_keys=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(f"kwinrc.pre-dropman-claims-cleanup-{timestamp}")
    shutil.copy2(path, backup)

    script_group["claimsJson"] = compact_claims_json
    for group_name in EFFECT_GROUPS:
        if group_name not in config:
            config.add_section(group_name)
        config[group_name]["claimsJson"] = compact_claims_json

    with path.open("w") as output:
        config.write(output, space_around_delimiters=False)

    print(f"Backed up kwinrc to {backup}")
    print("Valid profile ids: " + ", ".join(sorted(valid_ids)))
    if removed:
        print("Removed stale claim ids: " + ", ".join(removed))
    else:
        print("No stale claim ids found")
    print(f"Remaining claim ids: {', '.join(sorted(cleaned_claims)) or '<none>'}")
    print("Mirrored cleaned claimsJson to DropMan Slide effect groups")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
