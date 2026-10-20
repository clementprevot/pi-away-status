# @clementprevot/pi-away-status

A [Pi](https://pi.dev) extension that notices when you step away from your Mac and keeps the agent from waiting on you. While you are away, the agent keeps working: it makes the reversible calls itself, sets aside what needs you, and hands you an exact recap when you come back (decisions to challenge, commands to run, open questions).

It runs on macOS only. On other systems the sensor is unavailable and you always count as present.

## Install

```bash
pi install npm:@clementprevot/pi-away-status
```

Updates ship with `pi update --extensions`. The extension applies to your next session (quit and relaunch, or run `/reload`).

## How it works

### Detecting that you are away

You count as away when one of these holds:

- no keyboard, mouse, or trackpad input for 10 minutes (`HIDIdleTime`, the counter behind the screensaver; agent activity does not reset it)
- the screen is locked
- the screensaver is running
- you told the agent you are leaving (see below)

The check runs live through `ioreg` and `pgrep`, needs no macOS permission, and is cached for 5 seconds. If the sensor cannot run, you count as present.

### Saying you leave

A message that says you are leaving turns away mode on right away, whatever the sensor says. The phrase can sit anywhere in the message, so "run the tests, I'm off" works. Recognized phrases include "I'm off", "brb", "afk", "gotta go", and French ones such as "je file", "je pars", "j'y vais", "je m'absente", "je reviens dans 20 min", "pause déj", or "à plus". Look-alikes such as "je pars du principe" ("I assume") do not count.

Away mode then stays on until you say you are back. If you write to the agent in the meantime, it starts its answer with a one-line reminder that away mode is still on. That is often expected: you said you were leaving, then came back for a last instruction.

### What changes while you are away

These hooks run on their own:

- `ask_user_question` is blocked with the away rules as the reason, so the session does not hang on a question nobody can answer
- the first tool result after you leave carries the away rules, and the first one after you return says you are back
- a bash command that ran 30 seconds or more while you were away gets a note telling the agent not to retry it and to check the screen for a waiting dialog
- a blocking UI prompt opened while you are away (a permission ask, for example) lands in the journal

The away rules, in short:

- never retry an operation that needs you at the keyboard (1Password, SSO, Touch ID, sudo, permission prompts): log it as a pending command and move on
- no guardrail relaxes: no unsigned commits, no workaround for a blocked command, no commit, push, or publish
- a reversible choice inside the scope you already approved: the agent decides, logs the decision with its alternatives and how to revert it, and continues
- anything else is logged as a question while the agent works on what does not depend on it

### Coming back

Type `/back`, or start your message with "I'm back", "je suis de retour", "de retour", or "me revoilà" (a bare "re" or "back" works too). Away mode turns off. When the journal has entries, the extension injects it and asks the agent to present it in this order:

1. The decisions, each with how to revert it, so you can challenge them.
2. The commands, in one copyable bash block (each line includes its `cd`).
3. The open questions, with a recommended answer.

The agent then waits for your answers before resuming. The journal follows the session branch and is cleared once presented.

The footer shows when away mode is on and how many entries wait (`away mode on | log: 2 decisions, 1 command`). When the sensor sees you return and the journal has entries, the extension shows a notice and emits a `notifications:send` event on the pi event bus, for any notification extension that listens to it.

## Tools

The extension adds three tools:

- `away_status`: returns the live status, plus the away rules when you are away
- `away_log`: records a `decision` (choice, alternatives, rationale, revert), a `pending_command` (exact command, cwd, what blocks it), a `question` (options), or `progress`
- `screen_capture`: captures every display, downsizes each image to 1,800 px on its longest edge, and returns them to the model (useful to spot a 1Password dialog behind a hanging command)

`screen_capture` needs the Screen Recording permission for the terminal that runs pi (System Settings > Privacy and Security > Screen Recording).

## Commands

- `/back`: end away mode, show the recap, and resume
- `/away [status|on|off|auto]`: show the status, turn away mode on (like saying "I'm off"), force present mode, or go back to the sensor

## Configuration

Add an `awayStatus` key to your pi `settings.json`. Project settings (`.pi/settings.json`) override global ones once you trust the project. Schema, shown with defaults:

```json
{
	"awayStatus": {
		"idleSeconds": 600,
		"slowCommandSeconds": 30,
		"captureSilent": false
	}
}
```

- `idleSeconds`: how long without input before you count as away
- `slowCommandSeconds`: how long a bash command must run, while you are away, before the agent gets the do-not-retry note
- `captureSilent`: capture the screen without the shutter sound

Each setting can be overridden by an environment variable, which wins over `settings.json`: `PI_AWAY_STATUS_IDLE_SECONDS`, `PI_AWAY_STATUS_SLOW_COMMAND_SECONDS`, `PI_AWAY_STATUS_CAPTURE_SILENT` (`1`, `true`, `0`, or `false`). An invalid value is ignored with a warning at session start, and the next layer applies. Changes take effect at the next session start or `/reload`.

## Privacy and data

The extension runs `ioreg`, `pgrep`, `system_profiler`, `screencapture`, and `sips` locally. It makes no network calls and collects no telemetry.

Screen captures stay on disk under `$TMPDIR/pi-away-status-captures/` and are deleted after 24 hours. When the agent calls `screen_capture`, the images are part of the tool result, so they go to your model provider like any other tool output. Everything on your screens at that moment goes with them.

## Known limits

- A bash command that hangs forever on a prompt is only noticed when it ends or times out. The extension cannot inspect a call that is still running.
- Subagents load the extension too, but what they log stays in their own session.
- Departure and return phrases are matched with patterns, not understood. An unusual phrasing can be missed; `/away on` and `/back` always work.

## Local development

```bash
npm install
npm test
npm run typecheck
```

To try the extension in a live session without installing it:

```bash
pi -e /path/to/this/repo
```

## Credits

The idea comes from Tim V. ([timvisher](https://github.com/timvisher)) and the away-status setup in his [ide repository](https://github.com/timvisher/ide): a LaunchAgent records idle time, screen lock, and screensaver state, a skill tells agents to check it before anything that needs a human, and a screen capture skill spots prompts left waiting. This extension moves that behavior into pi hooks, so it no longer depends on the model remembering a skill, and adds the away journal and the recap on return.
