# DropMan Runtime State Machine

DropMan should treat each profile as an explicit state machine. A single
boolean such as `visible` is not enough because taskbar activation,
minimization, KWin reloads, desktop moves, and shortcut toggles are distinct
events with different side effects.

## Profile States

- `unclaimed`: no live window is attached to the profile.
- `visible`: the claimed window is at `shownGeometry`, on the current or a
  known desktop/activity, and should behave like the active dropdown window.
- `hidden`: the claimed window is parked at the edge-specific hidden geometry.
- `summoning`: DropMan is moving a hidden or off-desktop claimed window to the
  current desktop/activity and restoring `shownGeometry`.
- `hiding`: DropMan is moving a visible claimed window to hidden geometry and
  restoring focus to the previously focused non-dropdown window.
- `external_minimized`: KWin/taskbar minimized the claimed window outside the
  shortcut path. DropMan should immediately convert this to `hiding`, not leave
  it as an ordinary minimized window.
- `lost`: DropMan has persisted claim data, but the live window cannot be
  found by UUID or safe recovery rules.

## Events

- `claim(window)`: attach exactly one picked or active matching window.
- `release`: detach the claimed window and leave it visible if possible.
- `profile_shortcut`: user pressed the claimed profile's shortcut, such as
  `Meta+K` for Konsole or `Meta+F` for Firefox.
- `taskbar_minimize`: taskbar or window manager minimized a visible claimed
  window.
- `taskbar_activate`: taskbar or window manager activated a hidden claimed
  window.
- `kwin_reload`: KWin script/effect reloaded and rebuilt in-memory state from
  persisted config.
- `window_closed`: the claimed window was closed.
- `desktop_changed`: user changed virtual desktop or activity.

## Core Transitions

```text
unclaimed --claim(window)--> visible
visible --profile_shortcut/taskbar_minimize--> hiding --> hidden
hidden --profile_shortcut/taskbar_activate--> summoning --> visible
visible --release--> unclaimed
hidden --release--> unclaimed
any --window_closed--> unclaimed
any --kwin_reload, window found by UUID--> visible or hidden from live geometry
any --kwin_reload, window not found safely--> lost
lost --claim(window)--> visible
```

The shortcut is profile-specific. For example, when Konsole is claimed,
`Meta+K` and Konsole's taskbar button are equivalent state-machine events:
if Konsole is shown, either one retracts it; if Konsole is hidden, either one
shows it. Firefox follows the same rule with `Meta+F` and Firefox's taskbar
button.

## State Behavior Matrix

| Current state | Event | Behavior | Next state |
| --- | --- | --- | --- |
| `unclaimed` | `claim(window)` | Validate match rules, reject DropMan control windows, capture `shownGeometry`, persist UUID/geometry, tag/window-watch claim, leave window visible. | `visible` |
| `unclaimed` | `profile_shortcut` | Try safe recovery by persisted UUID, then parked geometry, then sole matching candidate. If none exists, log "no matching window" and do nothing. | `hidden`, `visible`, or `unclaimed` |
| `visible` | `profile_shortcut` | Update `shownGeometry` from live geometry and move to hidden edge geometry. Focus restoration is deferred until an animation-completion path exists. | `hidden` |
| `visible` | `taskbar_minimize` | Treat as dropdown hide: prevent ordinary minimize from becoming the durable state and park at hidden edge geometry. | `hidden` |
| `visible` | `taskbar_activate` | Claimed window is already visible; raise/activate only. | `visible` |
| `visible` | `desktop_changed` | Do nothing until the next summon/hide event. A visible claimed window may remain on its current desktop until requested. | `visible` |
| `visible` | `release` | Detach claim, clear DropMan metadata if possible, keep the window visible. | `unclaimed` |
| `hidden` | `profile_shortcut` | Move claimed window to current desktop/activity, move from hidden geometry to `shownGeometry`, activate/raise. | `visible` |
| `hidden` | `taskbar_activate` | Same as `profile_shortcut`: taskbar click on a hidden claimed window means summon it. | `visible` |
| `hidden` | `taskbar_minimize` | Already hidden; keep parked and do not enter ordinary minimized state. | `hidden` |
| `hidden` | `desktop_changed` | Keep parked. If screen geometry changes, recompute hidden geometry from stored `shownGeometry`. | `hidden` |
| `hidden` | `release` | Move to current desktop/activity, restore `shownGeometry`, activate/raise, detach claim. | `unclaimed` |
| `summoning` | transition completes | Activate/raise, mark visible, keep `shownGeometry` unchanged unless the user later moves/resizes while visible. | `visible` |
| `hiding` | transition completes | Restore previous non-dropdown focus, mark hidden. | `hidden` |
| `external_minimized` | entry | Immediately convert to `hiding`; this should be a transient state only. | `hiding` |
| `lost` | `profile_shortcut` | Attempt safe recovery. Never choose among multiple matching candidates. | `hidden`, `visible`, or `lost` |
| `lost` | `claim(window)` | Replace stale claim with the newly picked matching window. | `visible` |
| any | `window_closed` | Clear live claim and persisted claim if the closed window is the claimed window. | `unclaimed` |
| any | `kwin_reload` | Restore by persisted UUID first. If live geometry is parked, state is `hidden`; otherwise `visible`. If UUID is missing, recover only from one unambiguous parked or visible candidate. | `visible`, `hidden`, or `lost` |

## Side Effects By Transition

| Transition | Geometry | Focus | Persistence | Animation |
| --- | --- | --- | --- | --- |
| `claim -> visible` | Capture current frame as `shownGeometry`; do not move or resize. | No focus change. | Write UUID, edge, `shownGeometry`, and state. | Optional confirmation notice only. |
| `visible -> hidden` | Move from current/shown geometry to edge-hidden geometry. | Defer focus restoration until animation completion; do not raise another window during slide-out. | Persist state as hidden. | Slide out. |
| `hidden -> visible` | Move to current desktop/activity, then restore `shownGeometry`. | Activate claimed window. | Persist state as visible. | Slide in. |
| `visible -> visible` raise | No geometry change unless current desktop/activity requires summon semantics. | Activate claimed window. | No state change. | No animation. |
| `hidden -> unclaimed` release | Restore `shownGeometry` first, then detach. | Activate released window. | Remove persisted claim. | Usually no animation. |
| `visible -> unclaimed` release | No geometry change. | No required focus change. | Remove persisted claim. | None. |

## Rules

- Matching rules produce candidates only. They must not decide runtime state.
- A claimed window is identified by UUID when available.
- The shown state is always `shownGeometry`; profile width and height metadata
  must not repack the normal window in preserve-geometry mode.
- The hidden state is always a translation of `shownGeometry` offscreen along
  the configured edge.
- Taskbar minimize on a claimed visible window means "hide this dropdown."
- Taskbar activation on a claimed hidden window means "show this dropdown."
- Focus restore must happen only after the hide animation has completed. Until
  the native/effect completion path exists, the script must not synchronously
  raise another window during slide-out.
- Animation is a side effect of `visible <-> hidden` geometry transitions; it
  must not be used to infer ownership.

## Implementation Direction

The KWin script should replace ad hoc `binding.visible` updates with one
central transition function, for example:

```text
transition(binding, event, payload)
```

That function should be the only place allowed to set:

- `binding.state`
- `binding.window`
- `binding.shownGeometry`
- window geometry
- minimized/maximized restore state
- focus restoration

The current scripted effect can remain a compositor-side renderer for geometry
transitions, but ownership and state must live in the DropMan KWin script.
