# DropMan

DropMan, short for Dropdown Manager, is a KDE app for turning ordinary
application windows into keyboard-driven dropdown panels.

The goal is to let users claim specific apps or windows, bind them to global
shortcuts, and slide them in and out from any screen edge. This should cover
common cases handled by tools like Yakuake while staying general enough for
Konsole, Firefox, Uplink, chat clients, editors, and one selected window from a
multi-window application session.

Example bindings:

- `Meta+K`: Konsole
- `Meta+F`: Firefox
- `Meta+U`: Uplink

## Status

This repository starts with a Qt6/CMake desktop app and an isolated KWin
backend prototype. The first milestone is meant to prove the control model:

- edit persistent dropdown profiles;
- inspect KWin identity fields for candidate windows;
- claim exactly one selected window per profile;
- move that window on and off screen while preserving its claimed geometry;
- keep target apps unaware of dropdown mode.

The central design rule is: match many, bind one. Class/resource matching may
produce candidates, but an explicit claim step decides the single managed
window for each profile.

Default runtime behavior is preserve-current-window-geometry: claiming a
window captures its current frame rectangle as the shown state, flashes the
window for confirmation, and leaves it visible. The configured edge controls
only the offscreen hide direction. DropMan does not resize or repack the window
during normal toggle.

Like Yakuake, a claimed window should appear on the virtual desktop/activity
where its shortcut is invoked. On show, the KWin prototype first moves the
claimed window into the current desktop/activity context, then restores and
activates its preserved geometry.

## Repository Layout

```text
src/                          Qt6 app and backend boundary
kwin/dropman/                 KWin prototype package
scripts/install-kwin-script.sh local prototype install helper
docs/                         design notes and roadmap
```

## Build

Dependencies:

- CMake
- Qt 6 Widgets development files
- KDE Extra CMake Modules
- KDE Frameworks 6: I18n, ConfigCore, ConfigWidgets

```bash
cmake -S . -B build
cmake --build build
```

## KWin Prototype

```bash
./scripts/install-kwin-script.sh
```

Then enable the script in:

```text
System Settings -> Window Management -> KWin Scripts
```

Restart KWin if needed:

```bash
qdbus6 org.kde.KWin /KWin reconfigure
```

Expected KWin logs for the preserve-geometry prototype include:

```text
dropman: loaded 3 bindings; scriptVersion=live-picked-claim-20260621
dropman: claimed ... shown=... left visible
dropman: hid ... shown=... hidden=...
dropman: context for ... movedDesktop=...
dropman: showed ... shown=...
```

If logs still say `visible=...`, KWin is running an older installed copy of
the script. Re-run the install helper, reconfigure KWin, and log out/in if KWin
keeps the stale script in memory.

## Configure Bindings

The app now loads and saves editable profiles at the platform config location:

```text
~/.config/dropman/profiles.json
```

The file uses the same profile shape as the KWin prototype:

```json
{
  "schemaVersion": 1,
  "bindings": [
    {
      "id": "konsole",
      "name": "Konsole",
      "shortcut": "Meta+K",
      "claimShortcut": "Meta+Shift+K",
      "edge": "top",
      "mode": "preserve_geometry",
      "match": {
        "resourceClass": "org.kde.konsole",
        "resourceName": "konsole"
      }
    }
  ]
}
```

The packaged KWin prototype still has built-in defaults in:

```text
kwin/dropman/contents/config/dropdowns.json
```

When profiles are saved, the app also mirrors the same JSON into KWin's
`Script-dropman` config group and requests a KWin reconfigure. The resident
KWin component reads that mirrored config on load and falls back to packaged
defaults if it is missing or invalid.

The app's claim button starts KWin's window picker, stages the picked window
UUID in the `Script-dropman` config group, then invokes the resident
`DropMan-ClaimPicked-<id>` action through KDE's global shortcut service.
Keyboard claim shortcuts still use `DropMan-Claim-<id>` to claim the active
window. Release and test-toggle also invoke resident KWin actions. KWin remains
the owner of live window state.

The starter profiles use identity fields observed on Geshem:

- Firefox: `resourceClass=firefox_firefox`, `resourceName=firefox`
- Uplink: `resourceClass=Uplink`, `resourceName=Uplink`
- Konsole: `resourceClass=org.kde.konsole`, `resourceName=konsole`

`widthPercent` and `heightPercent` remain in the prototype config as future
profile metadata, but the default runtime mode does not use them to compute the
shown rectangle.

## License

MIT
