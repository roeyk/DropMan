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
window captures its current frame rectangle as the shown state. The configured
edge controls only the offscreen hide direction. DropMan does not resize or
repack the window during normal toggle.

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

## Configure Bindings

Edit:

```text
kwin/dropman/contents/config/dropdowns.json
```

The starter profiles use identity fields observed on Geshem:

- Firefox: `resourceClass=firefox_firefox`, `resourceName=firefox`
- Uplink: `resourceClass=Uplink`, `resourceName=Uplink`
- Konsole: `resourceClass=org.kde.konsole`, `resourceName=konsole`

`widthPercent` and `heightPercent` remain in the prototype config as future
profile metadata, but the default runtime mode does not use them to compute the
shown rectangle.

## License

MIT
