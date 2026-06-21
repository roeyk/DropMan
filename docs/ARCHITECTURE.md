# Architecture

DropMan is a standalone KDE/Qt app with an isolated Plasma/KWin backend.
KWin owns the two hard problems for this project:

- global shortcut registration;
- authoritative window geometry on Plasma Wayland and X11.

## Components

- Qt desktop app: profile editor, claim/release/test actions, and logging.
- Profile model: persistent user-facing dropdown definitions saved as
  `profiles.json`.
- KWin backend: the only layer that talks to Plasma/KWin identity, shortcuts,
  and geometry.
- KWin prototype package: experimental bridge until the backend is finalized.

## Binding Model

Each binding has:

- a stable `id`;
- a display `name`;
- a KDE shortcut string;
- a claim shortcut string;
- an edge: `top`, `right`, `bottom`, or `left`;
- a mode, currently `preserve_geometry`;
- size percentages for a future explicit resize mode;
- match criteria for `resourceClass`, `resourceName`, `windowClass`, or
  `caption`.

The project rule is: match many, bind one.

Class/resource matching only produces candidate windows. An explicit claim
step binds exactly one active window to a profile. This prevents broad
class-based mutation and keeps other windows from the same app normal.

Observed identity fields on Geshem:

- Firefox: `resourceClass="firefox_firefox"`, `resourceName="firefox"`
- Uplink: `resourceClass="Uplink"`, `resourceName="Uplink"`
- Konsole: `resourceClass="org.kde.konsole"`, `resourceName="konsole"`
- Yakuake: `resourceClass="org.kde.yakuake"`, `resourceName="yakuake"`

Firefox profile-picker dialogs must be excluded before claim, since they can
share the same class/name fields as real browser windows. The starter Firefox
profile intentionally avoids a positive caption match; the explicit active
window claim is the binding decision.

Claimed-window mutations should stay minimal in early runtime testing. Edge
geometry movement is the first behavior to validate; hints such as no-border,
skip-taskbar, all-desktops, or keep-above are opt-in profile settings.

Default geometry mode is `preserve_geometry`:

- claim captures the active window's current `frameGeometry` as
  `shownGeometry`;
- hide translates that exact rectangle fully offscreen in the configured edge
  direction;
- show restores `shownGeometry` exactly;
- before showing, DropMan moves the claimed window to the current
  virtual-desktop/activity context so the panel appears where the shortcut was
  invoked;
- if the user moves or resizes the claimed window while visible, the stored
  `shownGeometry` is updated on the next hide.

The configured edge controls hide direction, not forced shown geometry, in the
default mode. Profile size percentages should only take effect later through an
explicit mode such as `resize_to_profile`.

Claiming a window parks it in hidden edge geometry immediately. That makes the
next profile toggle a visible "show" action instead of requiring two toggles
after claim.

The app now owns profile editing and persistence. The KWin prototype still
uses packaged defaults until the app-to-KWin bridge is implemented.

## Roadmap Direction

1. Build a Qt6/CMake app with profile editor and logging pane.
2. Wire claim/release/test actions to the isolated KWin backend.
3. Teach the resident KWin component to load/reload app-saved profiles.
4. Improve visible toggle behavior and preserved edge geometry.
5. Add animation and packaging.
