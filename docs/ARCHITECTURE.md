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
- claim leaves the window visible;
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

Claiming a window does not hide it. The next profile toggle hides it if the
window is already visible on the current desktop/activity. If the user has
moved to another desktop/activity, that toggle first brings the claimed window
to the current context, matching Yakuake-style invocation behavior.

If KWin reloads after a window was hidden, the in-memory claim is lost while
the window may remain parked offscreen. A profile toggle may recover exactly
one matching offscreen window parked on that profile's configured edge, then
restore it into the current context. This is intentionally narrow to avoid
broad class-based mutation.

The app owns profile editing and persistence. On save, it writes
`profiles.json`, mirrors the same JSON into KWin's `Script-dropman` config
group, and requests a KWin reconfigure. The resident KWin component reads that
mirrored config on load and falls back to packaged defaults if it is missing or
invalid.

The app controls the live runtime by invoking KWin-owned UI/actions:

- app claim starts KWin's window picker, stages the picked UUID in
  `Script-dropman`, then invokes `DropMan-ClaimPicked-<id>`;
- keyboard claim invokes `DropMan-Claim-<id>` and claims the active window;
- `DropMan-Release-<id>` releases the claimed window;
- `DropMan-<id>` toggles the claimed window.

## Roadmap Direction

1. Build a Qt6/CMake app with profile editor and logging pane.
2. Harden KWin profile reload behavior and shortcut ownership when profiles
   change.
3. Improve visible toggle behavior and preserved edge geometry.
4. Add animation and packaging.
