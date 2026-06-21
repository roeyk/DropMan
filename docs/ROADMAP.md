# Roadmap

## First Milestone

- Qt6/CMake desktop app.
- Persistent profile editor.
- Fields per profile: name, match rules, edge, size metadata, shortcut.
- Actions: claim active window, release claimed window, test toggle.
- Logging pane showing live KWin identity data.
- Plasma/KWin backend isolated from the rest of the app.

## Next

- Confirm backend behavior on Geshem's live Plasma session.
- Tighten Firefox matching to avoid profile-picker dialogs.
- Persist selected window identity where KWin exposes a stable identifier.
- Make preserve-current-window-geometry toggle behavior reliable before
  animation.
- Add smooth slide animation after geometry is stable.
- Replace the placeholder app backend with real communication to the resident
  KWin component.
- Add script-side diagnostics for claimed/visible state and before/after
  geometry.
- Add an explicit future `resize_to_profile` mode if users want profile-defined
  dropdown rectangles instead of preserving the claimed window geometry.

## Later

- KDE configuration UI.
- Import/export binding profiles.
- Per-monitor placement rules.
- Optional launch command when no matching window exists.
- Packaged release through KDE Store or distro packages.
