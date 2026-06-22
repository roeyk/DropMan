# Animation Plan

DropMan should eventually slide claimed windows in and out like Yakuake. The
current KWin script is not the right place to implement smooth animation:
Geshem testing showed that this script context does not expose KWin's
`animate`/`Effect` API or a usable timer API.

## Current Runtime

The KWin script remains responsible for:

- global shortcuts;
- claim/release/toggle state;
- exact claimed-window identity;
- preserved shown geometry;
- hidden edge geometry;
- focus restoration.

Show and hide are currently instant geometry changes. That keeps the prototype
deterministic while the binding model is still hardening.

An experimental scripted effect now lives in:

```text
kwin/effects/dropman_slide
```

The effect first tries to track exact app-picked UUIDs. The Qt app mirrors
picked claims into several KWin effect config groups, but Geshem showed that
scripted effects do not necessarily expose those groups through
`effect.readConfig()`. The KWin shortcut script also tags claimed window
objects with DropMan metadata, and the effect treats that as the preferred
runtime handoff when available.

While that protocol is being validated, the effect also has an experimental
fallback that animates large edge-to-edge geometry moves. This is intentionally
for testing only; the final runtime should use an exact claim handoff, not
broad movement heuristics.

## Target Runtime

Smooth animation should live in a dedicated KWin effect/runtime component, not
in the shortcut script. The current scripted effect is a validation step. A
full native effect may still be needed for top-layer notices, richer drawing,
and explicit show/hide operation handshakes.

The script or app should provide the effect with:

- profile id;
- claimed window UUID;
- starting geometry;
- ending geometry;
- direction/edge;
- operation: show or hide.

The effect should then animate the transition and report completion, at which
point the script can finalize focus and visible/hidden state.

## Yakuake Reference

Yakuake has two animation strategies:

- a window-manager-assisted path using `KWindowEffects::slideWindow()` on
  Wayland and the `_KDE_SLIDE` window property on X11;
- a fallback app-owned animation using `QTimer` and progressively adjusted
  window masks.

The second strategy is not suitable for DropMan's default mode because DropMan
does not own Firefox, Konsole, Uplink, or other claimed windows. A generic
dropdown manager should not inject masks into arbitrary third-party windows.

The first strategy is the right model to investigate. For a first animation
experiment, DropMan should try to request KWin's existing slide effect for the
claimed window and fall back to instant geometry when unavailable.

Open questions for Geshem:

- On Wayland, can `KWindowEffects::slideWindow()` be applied by a helper to a
  foreign claimed window, or only to the helper's own `QWindow`?
- On X11, can `_KDE_SLIDE` be set safely on a foreign window id before the
  geometry/show/hide transition?
- Does Plasma's existing slide effect animate move-to/offscreen geometry
  changes for ordinary windows, or only show/hide transitions?

## Constraints

- Animation must not broaden matching. It only applies to the one claimed
  window for a profile.
- The final frame must exactly match the stored `shownGeometry` or computed
  hidden geometry.
- If the effect is unavailable, DropMan must fall back to instant geometry.
- Animation must not temporarily unmaximize, resize, or otherwise normalize
  windows outside the explicit profile mode.

## Next Slice

1. Keep the script's instant geometry path as fallback.
2. Add a narrow animation backend interface around show/hide.
3. Validate the scripted `dropman_slide` effect on Geshem:
   - install it with `scripts/install-kwin-effect.sh`;
   - enable it in Desktop Effects;
   - claim a window through the app so the KWin script tags the claimed
     window;
   - toggle the window and watch for `dropman-slide: animated ...` logs,
     especially `tracked=true` or `largeEdgeMove=true`.
4. If scripted effects cannot provide enough control, move to a native KWin
   effect/runtime component.
5. Add a config flag such as `animation.enabled`, defaulting to false until the
   effect is proven on Geshem.
