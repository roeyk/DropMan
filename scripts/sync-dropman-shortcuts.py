#!/usr/bin/env python3
"""Sync DropMan global shortcut entries from KWin profile config.

KWin's registerShortcut creates actions, but profile renames/additions can
leave kglobalshortcutsrc with stale DropMan-* owners. This helper reads
[Script-dropman] profilesJson from kwinrc and rewrites only DropMan entries
inside the [kwin] global-shortcut component.
"""

from __future__ import annotations

import configparser
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


def load_json(raw: str, label: str) -> dict:
    if not raw:
        raise SystemExit(f"{label} is empty")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"Could not parse {label}: {error}") from error
    if not isinstance(data, dict):
        raise SystemExit(f"{label} is not a JSON object")
    return data


def shortcut_entry(shortcut: str, label: str) -> str:
    shortcut = shortcut.strip() if shortcut else "none"
    if not shortcut:
        shortcut = "none"
    return f"{shortcut},{shortcut},{label}"


def hidden_entry(label: str) -> str:
    return f"none,none,{label}"


def first_shortcut(value: str) -> str:
    return value.split(",", 1)[0].strip() if value else ""


def main() -> int:
    kwinrc = Path.home() / ".config" / "kwinrc"
    shortcuts = Path.home() / ".config" / "kglobalshortcutsrc"
    if not kwinrc.exists():
        print(f"kwinrc not found: {kwinrc}", file=sys.stderr)
        return 1
    if not shortcuts.exists():
        print(f"kglobalshortcutsrc not found: {shortcuts}", file=sys.stderr)
        return 1

    kwin_config = configparser.RawConfigParser()
    kwin_config.optionxform = str
    kwin_config.read(kwinrc)
    if "Script-dropman" not in kwin_config:
        print("[Script-dropman] not found in kwinrc", file=sys.stderr)
        return 1

    profiles_json = load_json(
        kwin_config["Script-dropman"].get("profilesJson", ""),
        "profilesJson",
    )
    profiles = profiles_json.get("bindings", [])
    if not isinstance(profiles, list) or not profiles:
        print("No profile bindings found in profilesJson", file=sys.stderr)
        return 1

    desired: dict[str, str] = {}
    wanted_shortcuts: dict[str, str] = {}
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        profile_id = str(profile.get("id", "")).strip()
        name = str(profile.get("name", profile_id)).strip() or profile_id
        shortcut = str(profile.get("shortcut", "")).strip()
        claim_shortcut = str(profile.get("claimShortcut", "")).strip()
        if not profile_id:
            continue

        toggle_key = f"DropMan-{profile_id}"
        claim_key = f"DropMan-Claim-{profile_id}"
        desired[toggle_key] = shortcut_entry(shortcut, f"DropMan: {name}")
        desired[claim_key] = shortcut_entry(claim_shortcut, f"DropMan: Claim {name}")
        desired[f"DropMan-ClaimPicked-{profile_id}"] = hidden_entry(
            f"DropMan: Claim picked {name}"
        )
        desired[f"DropMan-Release-{profile_id}"] = hidden_entry(
            f"DropMan: Release {name}"
        )

        if shortcut:
            wanted_shortcuts[shortcut] = toggle_key
        if claim_shortcut:
            wanted_shortcuts[claim_shortcut] = claim_key

    if not desired:
        print("No valid DropMan profile ids found", file=sys.stderr)
        return 1

    shortcut_config = configparser.RawConfigParser()
    shortcut_config.optionxform = str
    shortcut_config.read(shortcuts)
    if "kwin" not in shortcut_config:
        shortcut_config.add_section("kwin")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = shortcuts.with_name(f"kglobalshortcutsrc.pre-dropman-shortcut-sync-{timestamp}")
    shutil.copy2(shortcuts, backup)

    kwin_group = shortcut_config["kwin"]
    stale = sorted(key for key in kwin_group if key.startswith("DropMan-") and key not in desired)
    for key in stale:
        del kwin_group[key]

    for key, value in desired.items():
        kwin_group[key] = value

    conflicts: list[str] = []
    for section in shortcut_config.sections():
        for key, value in shortcut_config[section].items():
            if section == "kwin" and key in desired:
                continue
            shortcut = first_shortcut(value)
            if shortcut in wanted_shortcuts and shortcut.lower() != "none":
                conflicts.append(
                    f"{shortcut} also appears in [{section}] {key}; wanted by {wanted_shortcuts[shortcut]}"
                )

    with shortcuts.open("w") as output:
        shortcut_config.write(output, space_around_delimiters=False)

    print(f"Backed up kglobalshortcutsrc to {backup}")
    if stale:
        print("Removed stale DropMan shortcut entries: " + ", ".join(stale))
    else:
        print("No stale DropMan shortcut entries found")
    print("Synced DropMan shortcut entries:")
    for key in sorted(desired):
        print(f"  {key}={desired[key]}")
    if conflicts:
        print("Potential non-DropMan shortcut conflicts:")
        for conflict in conflicts:
            print(f"  {conflict}")
    else:
        print("No non-DropMan shortcut conflicts detected")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
