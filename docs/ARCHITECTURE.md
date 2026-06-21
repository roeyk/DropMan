# Architecture

DropMan is a standalone KDE/Qt app with an isolated Plasma/KWin backend.
KWin owns the two hard problems for this project:

- global shortcut registration;
- authoritative window geometry on Plasma Wayland and X11.

## Components

- Qt desktop app: profile editor, claim/release/test actions, and logging.
- Profile model: persistent user-facing dropdown definitions.
- KWin backend: the only layer that talks to Plasma/KWin identity, shortcuts,
  and geometry.
- KWin prototype package: experimental bridge until the backend is finalized.

## Binding Model

Each binding has:

- a stable `id`;
- a display `name`;
- a KDE shortcut string;
- an edge: `top`, `right`, `bottom`, or `left`;
- size percentages for the active screen;
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

## Roadmap Direction

1. Build a Qt6/CMake app with profile editor and logging pane.
2. Wire claim/release/test actions to the isolated KWin backend.
3. Persist profiles.
4. Improve visible toggle behavior and edge geometry.
5. Add animation and packaging.
