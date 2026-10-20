# Contributing

Thanks for considering a contribution. Contributing here is easy: no build step, no runtime dependencies.

## Setup

```bash
npm install
```

## Before you open a PR

```bash
npm test            # node:test, runs on the current Node (>= 22.6)
npm run typecheck   # tsc --noEmit
```

Then try the extension in a live session:

```bash
pi -e /path/to/this/repo
```

To test away mode without waiting 10 minutes, run `/away on`, then `/away auto` or "I'm back" to end it.

## Guidelines

- Keep the extension dependency-free: pi provides `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` as peers. Anything else needs a strong justification.
- No build step. The TypeScript source is what pi loads and what npm ships.
- No network calls and no telemetry. The only data that leaves the machine is what the agent itself sends to its model, such as `screen_capture` images.
- The sensor and the capture shell out to macOS tools (`ioreg`, `pgrep`, `system_profiler`, `screencapture`, `sips`). On another system they must fail quietly, and the user then counts as present.
- Tests live in `test/` and run with `node --test`. Pure helpers stay exported so they stay testable; `test/extension.test.ts` drives the hooks through a fake pi API.
- Keep messages short and concrete, both the ones shown to the user and the notes injected for the agent.

## Releasing

Versions are bumped manually and released by tagging:

```bash
npm version patch|minor|major
git push --follow-tags
```

The `release` GitHub Action publishes to npm on `v*` tags using npm trusted publishing (OIDC), so no npm token is stored in the repo.

First publish only: the package name must exist on npm and be linked to this repo as a trusted publisher (npmjs.com, package settings, "Trusted Publisher": repository `clementprevot/pi-away-status`, workflow `release.yml`). Publish the first version locally with `npm publish` while logged in, then link the trusted publisher so later tags publish automatically.
