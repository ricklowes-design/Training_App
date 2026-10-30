# Project rules for the coding agent

This is the public copy of the app. The `plan/` folder referred to below is kept in the private repository (`ricklowes-design/reimagined-system`, folder `home-training/plan/`) because it holds the player's details; never copy it, or anything personal, into this repository.

## What this is
A personal home soccer-training web app for one player, run by a parent, used in Chrome on a family Chromebook with a USB webcam. Not a product. No accounts, no server, no analytics, no sign-up.

## Read first, every session
0. `plan/16-agent-update-spec.md`, `plan/17-ball-tracking-spec.md` and `plan/18-continuous-learning-spec.md` (the approved specifications) and `plan/15-decision-register.md` (how they override earlier parts). Where they conflict with anything below or in parts 1–14, they win.
1. `plan/09-roadmap-build-tasks.md` — find the current slice and task in `PROGRESS.md`; do that task only.
2. `plan/08-technical-architecture.md` — stack and data model. Do not change the stack without asking.
3. `plan/13-simplicity-and-progress.md`, then the part of `plan/02-user-experience.md`, `plan/05-measurement-motivation-progress.md` and, for camera tasks, `plan/12-camera-analytics.md` that the task touches.

## Standing rules
- Stack: Vite + React + TypeScript, Dexie for IndexedDB, PWA manifest + service worker, deploy to GitHub Pages. Ask before adding any dependency beyond these, MediaPipe Tasks Vision, and small utilities. A 3D library (Three.js or Babylon.js) is allowed only after the licence, bundle-size and measured-performance assessment in task 2.1 is recorded.
- Programme content lives in `content/programme.json`; coach changes are overrides in the database. Never hard-code drills, cues, session lengths, or the player's details in code.
- Nothing personal in the repository: no names, results, clips, or screenshots with data.
- Data stays on the device. No network calls except loading the app, YouTube embeds, the MediaPipe model files, (opt-in only) Chrome speech recognition for single digits, and (opt-in only) the one small session record per finished session sent to the notification service or a chat webhook (plan/14). Nothing else ever leaves the device.
- Full camera evaluation runs after a block, in a Web Worker, never on the main thread. Live camera use is limited to the framing check, the pixel-motion tripwire, and the bounded low-latency feint onset/direction detector that triggers the defender animation (part 15 D5). When its confidence is low, fall back to planned timing or a parent trigger and label the source.
- Every measured metric carries a status (`verified` / `estimate` / `unableToAssess`), a source, a confidence and a context key. `unableToAssess` is never shown as zero and never affects progression. Never label anything "sold it", "fooled the defender" or "deception quality"; use `observedExecution`, `estimatedTechnique`, `unableToAssess`.
- Each drill declares focus, supporting and experimental measures (`FocusMetricConfig`); only progression-eligible measures can advance a stage. No undifferentiated combined score.
- Rules that must live in code, not content: `completed` is defined by plan/14.4 (timers to the end, pause limits, camera presence when available); unlock only on `completed` or `completedBenchmarkSkipped`; `partial`, `stopped`, `extra` and any record with `trial: true` never unlock and never count toward the week (a trial counts only once promoted, per plan/13.5); benchmark trends only join results with the same context key (`layoutVersion`, `cueLevel`, `roomProfileVersion`, `defenderArchetype` or `benchmarkOpponent`, `taskMode`, `cameraConfidence`, `ballProfileId`, `modelVersion`, drill settings); stage advancement follows part 15 D12 (default ordered path, evidence-based skip-ahead on two different days with verified or coach-confirmed measures, parent confirmation); a time is never shown without its error count; no composite scores; no negative messages for missed sessions.
- Feedback text comes only from the templates in `plan/05`. Do not invent praise.
- Every screen used during practice must be readable from 5 m and operable with at most one large tap. Audio for everything that happens inside a block.
- Zero-fiddle rules (plan/13.1) are hard requirements for the player: one tap to start a session or drill; the camera is never operated by the player; the framing check is automatic; scoring is automatic or at most a few taps on a result card that is **never pre-filled from an earlier session** (an estimate may come only from the current block); no mid-session settings or confirmations. One-time room-profile set-up by the parent (photo, anchors, safe polygon, adjustable cone overlay) is allowed; no floor tape, markers or measuring is ever required (part 15 D1).
- Ball tracking (plan/17): a registered-ball profile drives detection; a predicted ball position is never a confirmed measurement; gate and touch events carry direction, confidence and duplicate suppression; contacts are `confirmed` / `possible` / `unobservable`; progression thresholds for ball-derived measures come only from the measured validation in plan/17, never from arbitrary confidence values. Any detector model needs a licence check (compatible with commercial distribution) before adoption. Ball inference runs in a worker with frame scheduling and must never stall the 3D defender.
- Continuous learning (plan/18): training is never run in the real-time inference path; only independently verified examples (flagged-rep reviews, blind calibration, coach verification) are used as labels; every candidate model is evaluated against a frozen validation set and activated only if held-out accuracy improves; previous models are kept and rollback works; every score is stored with the `ModelVersion` that produced it and history is never re-scored silently; the user can pause personalisation, recalibrate a skill or reset a learned profile without losing training history; formal assessments and anchors use the fixed non-learning benchmark opponent; model confidence is never presented as accuracy. Prefer statistical or rule-based adaptation over neural fine-tuning unless a measured accuracy benefit on the Chromebook justifies it.
- No absolute speed (m/s), sprint or maximum-acceleration measures; relative, matched timing only (part 15 D2). No drills that exceed the safe floor polygon.
- Scored reactive drills use the 3D player-perspective defender; arrows or colours must never reveal the correct action during the decision window. Word/arrow cues remain for instruction, the fixed anchor A3, and the WebGL/performance fallback (part 15 D3).
- Number or symbol call-outs are an optional diagnostic, never part of normal scanning training; speech recognition is never required to play (part 15 D8).
- Every block ends with the end-of-drill progress card (plan/13.2) before anything else happens: Basic view by default (focus result, comparable change, one takeaway, next drill), Advanced on toggle.
- Work in small steps. After each task: run the build, run any unit tests, update `PROGRESS.md` with what was done, what was not, and the manual checks the parent should run on the Chromebook.
- Do not test on the camera, audio or distance readability yourself; write the manual test script for the parent instead. For camera tasks, also write the validation step from `plan/10` and `plan/09` (for example: 20 recorded reps compared with a parent's frame reading).
- Do not touch `plan/` files except to add a dated note under "Deviations" in `PROGRESS.md` when the plan could not be followed.

## Commands
- `npm run dev` — local preview
- `npm run build` — production build
- `npm test` — unit tests (sequencing and advancement rules, comparability/context keys, templates, session-duration arithmetic, the seeded `DefenderReactionEngine`, defender state machine, DB migrations, gate-event hysteresis, touch de-duplication, model validation gate and rollback must all have tests)

## PROGRESS.md format
```
## Current task: <number and name>
## Done
- <date> Task N: ...
## Manual checks pending (parent)
- ...
## Deviations
- <date> ...
```
