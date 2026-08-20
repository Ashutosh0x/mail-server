# Haptics

Every vibration the Android app can produce, why it exists, and the rules that
keep the list short.

## The problem this solves

A `view.performHapticFeedback(...)` scattered across thirty composables is
thirty independent decisions about intensity. The result is an app that buzzes
at everything — which, to a hand in a pocket, is indistinguishable from an app
that buzzes at nothing. Once feedback stops carrying information, the user turns
it off in system settings, and the pulses that genuinely matter go with it.

So there is one manager, `ui/haptics/Haptics.kt`, and the enum names the
**intent** rather than the effect. Call sites read as `Haptic.SelectionStart`,
not `LONG_PRESS`, and the mapping from intent to platform constant is tuned in
one place.

## The vocabulary

| Intent | When | Platform constant |
|---|---|---|
| `Press` | A control was pressed and something will happen — Compose FAB, toolbar action | `KEYBOARD_TAP` |
| `Select` | A row entered or left the selection | `CLOCK_TICK` |
| `SelectionStart` | Long-press crossed into selection mode | `LONG_PRESS` |
| `Toggle` | A star was toggled | `CLOCK_TICK` |
| `Drawer` | The drawer opened or closed | `CLOCK_TICK` |
| `Threshold` | A swipe or pull crossed the point where releasing would act | `CLOCK_TICK` |
| `Confirm` | A reversible action completed | `CONFIRM` (API 30+) |
| `ConfirmDestructive` | An irreversible action completed | `CONFIRM` (API 30+) |
| `Send` | A message left the device | `CONFIRM` (API 30+) |
| `Error` | An operation failed | `REJECT` (API 30+) |

`CONFIRM` and `REJECT` exist only from API 30. Below that they fall back to
effects present on every supported release rather than silently doing nothing,
which would leave older devices with no feedback on exactly the operations that
matter most.

## What is deliberately absent

**Navigation.** Opening a conversation, switching mailbox, scrolling — none of
these pulse. Navigating is not an event that needs confirming through the skin,
and it is the single largest source of buzz in apps that get this wrong.

**Typing.** The keyboard has its own haptics, governed by the user's keyboard
settings. Adding a second layer would double-pulse every keystroke.

**Anything that fires per frame.** See the threshold rule below.

## The threshold rule

Swipe and pull-to-refresh both report a *continuous* distance. Firing a haptic
whenever that distance exceeds the activation point means firing on every frame
the finger is past it — a continuous vibration, which conveys nothing.

`ThresholdLatch` makes the crossing discrete: one pulse on the way in, re-armed
when the finger falls back below the line, so a user who hesitates over the
threshold feels the boundary each way instead of a buzz. Every continuous
gesture goes through it — there is no direct `Haptic.Threshold` call anywhere.

## Two switches, both honoured

Checked at the moment of firing, never cached:

1. **The system setting.** `Settings.System.HAPTIC_FEEDBACK_ENABLED` is the
   OS-wide toggle. Compose's own `LocalHapticFeedback` does **not** consult it,
   so an app built on that alone keeps vibrating after the user has turned
   haptics off in Settings. Checking it here is what makes the app obey.
2. **The app setting.** For someone who wants a phone that still vibrates for
   calls but a mail client that stays quiet.

`FLAG_IGNORE_VIEW_SETTING` is never passed. That flag overrides the view's own
haptic preference, which is the opposite of what a respectful client does.

A failed read of the system setting is treated as *enabled*, matching the
platform default, rather than silently disabling all feedback because one
Settings lookup threw on one OEM build.

## Implementation status

| Piece | State |
|---|---|
| `HapticFeedbackManager`, the intent vocabulary | Implemented |
| `ThresholdLatch` | Implemented; used by swipe and pull-to-refresh |
| System-setting check | Implemented |
| Wired: drawer, selection, long-press, star, swipe, pull, toolbar, delete confirm | Implemented |
| Wired: send, voice recording | **Not yet** — those screens do not exist |
| In-app enable/disable preference | **Not yet.** The manager already reads a
  supplier, but it returns the honest default rather than a stored value, and no
  Appearance screen exists to change it. Wiring a toggle that persists nothing
  would be a setting that does not work. |

## Coordination with motion

Haptics accompany a visible change; they do not replace one. Long-press pulses
*with* the selection animation, the swipe threshold pulses *with* the icon
arming, and a destructive confirmation pulses *with* the dialog's action. A
pulse with no corresponding visual is feedback a deaf-to-touch user — anyone
with the phone on a table — never receives.
