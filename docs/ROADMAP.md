# Roadmap

## First Milestone

- Qt6/CMake desktop app.
- Persistent profile editor.
- Fields per profile: name, match rules, edge, size, shortcut.
- Actions: claim active window, release claimed window, test toggle.
- Logging pane showing live KWin identity data.
- Plasma/KWin backend isolated from the rest of the app.

## Next

- Confirm backend behavior on Geshem's live Plasma session.
- Tighten Firefox matching to avoid profile-picker dialogs.
- Persist selected window identity where KWin exposes a stable identifier.
- Make visible toggle behavior reliable before animation.
- Add smooth slide animation after geometry is stable.
- Replace the placeholder app backend with real communication to the resident
  KWin component.

## Later

- KDE configuration UI.
- Import/export binding profiles.
- Per-monitor placement rules.
- Optional launch command when no matching window exists.
- Packaged release through KDE Store or distro packages.
