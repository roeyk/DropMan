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

## Target Runtime

Smooth animation should live in a dedicated KWin effect/runtime component, not
in the shortcut script. The script should provide the effect with:

- profile id;
- claimed window UUID;
- starting geometry;
- ending geometry;
- direction/edge;
- operation: show or hide.

The effect should then animate the transition and report completion, at which
point the script can finalize focus and visible/hidden state.

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
3. Investigate a KWin effect package for the animated compositor-side path.
4. Add a config flag such as `animation.enabled`, defaulting to false until the
   effect is proven on Geshem.
