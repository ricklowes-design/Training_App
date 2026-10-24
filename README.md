# Home Training

A personal home soccer-training web app for one player, run by a parent, used in Chrome on a Chromebook. No accounts, no server; everything stays in the browser on that device.

- Plan: kept privately (it contains the player's details), not in this public repository. Agent rules: `CLAUDE.md`. Status: `PROGRESS.md`.
- Programme content: `content/programme.json` (validated on load; coach changes are stored as overrides on the device).

## Commands

```
npm install
npm run dev      # local preview at http://localhost:5173
npm test         # unit tests (rules, maths, engines)
npm run test:e2e # end-to-end tests of every screen in Chromium (builds first)
npm run test:all # both
npm run build    # production build into dist/
# deploy: push to main; GitHub Actions builds and publishes to GitHub Pages
```

## Tests

- **Unit tests** (`src/**/*.test.ts`, Vitest): content validation, session arithmetic and builder templates, the completion rule, session runner, sequencing, trial mode, comparisons, feedback wording, advancement, overrides, milestones, layouts, backup, cue engine, camera maths, analysis.
- **End-to-end tests** (`e2e/*.spec.ts`, Playwright + Chromium) drive the production build through every screen: set-up, PIN, content errors, offline PWA, sessions (no-touch run, skip, pause, STOP, DONE, Repeat, notes, choice), baselines and placement, benchmark forms and comparisons, trial mode, Week/Skills/Drills and the comparison picker, builder, light, quiz, anchor check, all coach and parent screens, backup and restore, settings, cue engine, and the camera (set-up wizard, framing check, recording, tripwire, presence rule, analysis, clip player, retention). Long sessions run on Playwright's fake clock; the camera runs on Chromium's fake webcam fed with generated video (`e2e/fake-video.ts`).
- The pose speed test downloads Google's models, so it runs only with `E2E_NETWORK=1` (set in CI). Behind a proxy, also set `E2E_PROXY`.
- GitHub Actions (`.github/workflows/home-training.yml`) runs both suites on every push and pull request that touches `home-training/`, and uploads the Playwright report when something fails.
- Not testable by machine: sound and readability from 5 m, the real USB webcam, and the accuracy of the camera numbers. Those are the parent checks in `PROGRESS.md`.

## Deploying to GitHub Pages

Every push to `main` runs `.github/workflows/deploy.yml`: unit tests and the build, then it publishes `dist/` to GitHub Pages (repository Settings → Pages → Source: GitHub Actions). The end-to-end tests run in the same workflow but do not hold up the deploy. The camera features need HTTPS, which Pages provides. This repository is public: never add the plan, names, results, clips or screenshots with real data.

## Layout

- `src/content` — content types, loader, validator
- `src/db` — Dexie database, record types, backup
- `src/domain` — rules that live in code: completion, sequencing, trials, comparability, templates, advancement, builder
- `src/runner` — session runner (pure engine + screens)
- `src/screens` — home, progress, builder, summary, parent/coach mode
- `src/defender` — 3D defender: seeded reaction engine, state machine, Three.js scene (lazy-loaded), 2D fallback, block engine, replay
- `src/camera` — camera session, framing and room checks, live onset detector, geometry
- `src/analysis` — after-block analysis in a worker (zones, pose, defender reps, scan reps)
- `src/ball` — registered-ball colour model, detection, tracking, gate crossings, touches (part 17)
- `src/learning` — verified-only learning service, validation gate, rollback, trends (part 18)
- Optional dependency: `three` (MIT), loaded only when a defender block starts; see the assessment in `PROGRESS.md`.
