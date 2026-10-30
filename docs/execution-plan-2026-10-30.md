# Integrated execution plan (2026-10-30)

Sources: the owner's *Soccer Training App Coding Brief* (R01–R15, "the Brief") and *Fix instructions: audit of 827862a* (Tasks 1–17, "the Fixes"). Baseline: commit 827862a, content 0.5.9.

## Rules for merging the two

1. Where the two disagree on an improvement, the Brief wins.
2. A Fix task wins only where it finds a break or defect (data loss, crash, hang, security gap, wrong number) that the Brief does not cover.
3. Both documents and CLAUDE.md agree on these, so they hold throughout:
   - no new dependencies or cloud services;
   - additive migrations, history preserved;
   - one task at a time, with build, tests and PROGRESS.md after each;
   - policy questions are left to the owner, with only safe display, copy and eligibility corrections made in the meantime;
   - no new filmed demonstrations.

## Conflicts and how they are resolved

| Topic | Brief | Fixes | Resolution |
| --- | --- | --- | --- |
| Stage rules with `consecutive: 1` (dribbling st3→st4, control st2→st3 and st3→st4) | R02: "two different-day results are still required **where the rule specifies it**"; policy questions go to the owner | Task 3: clamp every stage rule to at least 2 in code | **Brief wins:** no clamp. Add the validator *warning* from Task 3 (safe, shown on Parent → Content) and list the question for the owner. |
| Secrets on backup import | R05: strip secrets from old backups too; sending stays inactive until credentials are re-entered deliberately | Task 10: put the device's own secrets back after import | Both are kept, because they don't conflict. Secrets are never taken from a file. A credential this device already holds is kept, since that is not "reactivation from the file". With no device credential, sending stays inactive. |
| Deploy gating | R04: deploy needs build **and** e2e | Task 17.6: either option | **Brief wins:** `needs: [build, e2e]`. |
| System test grading | R06: immutable snapshot of switches and set-up versions at start | — | Store the snapshot on the record; grade from it. |
| End card "attempt 0" | R15 | (review point 2) | Practice rounds go in a separately labelled group. |
| Pronouns | R15: replace gender wording, no personal data | Task 14.3: replace she/her | Do it. Leave zone ids (`her-left gate`) as Task 14 says, because renaming them needs a migration. |
| Notifications include the first name | — (R05 covers secrets only) | Task 14.2: `includeName` opt-in, default off | **Fix applies:** a privacy break the Brief does not cover. |
| Presence gate (`presenceFrac` < 0.7) | R03: keep the unlock policy until the owner decides; improve labels and explanation only | — | Display and labelling only. The credit rule is unchanged. |
| Teaching copy, C6 and F7 metrics | R01: content approval required | — | Add mode resolution, mode-specific teaching and validation in code. Content changes go in a new version, flagged for coach approval. |

Fix Tasks 1, 2 and 4–17 are breaks or hardening that the Brief does not address (or addresses compatibly), so they apply as written, adapted to the current code.

## Order of work

Breaks that can lose progress or data come first, then the Brief's batches.

### Phase A: protect progress and data (Fixes, plus Brief R04/R05)
1. Fix 1: baseline placement behind the PIN; parent mode locks on exit.
2. Fix 2: placement cannot skip ahead once started; a new placement resets older confirmations.
3. Fix 3 (Brief variant): validator warning for stage rules below 2. No clamp. Owner decision.
4. Fix 4: benchmark values keyed per attempt; "Scored by" is an explicit tap.
5. Fix 5: the run opens the set-up's camera; camera errors in plain words.
6. Fix 6: an unplugged webcam can't hang the session.
7. Fix 7: the analysis worker fails safely; model URLs are pinned.
8. Fix 8: save failures show a retry; clip failure never loses presence.
9. Fix 9: root error boundary and start-up error screen.
10. Fix 10 plus R05: nested blobs, camera set-ups and secrets in backups; reliable import; backup reminder.
11. R04: deploy waits for the e2e job.

### Phase B: session robustness (Fixes)
12. Fix 11: wake lock; auto-pause when the page is hidden; 3D fps window.
13. Fix 12: 3D defender context loss, keep the canvas through PAUSE, fps written once per block, control taps, shared fps thresholds.
14. Fix 13: hold-to-STOP; double-tap guard.
15. Fix 14 plus R15 (pronouns): YouTube no-cookie host; name in messages is opt-in; pronouns.
16. Fix 15: service worker without surprise updates; timeouts; update offer on Home.
17. Fix 16: clip start time, frame capture time and cue paint time.

### Phase C: Brief Batch 1, R01
18. R01: one resolved training mode (3D, fallback arrows, anchor, wall, partner) shared by instructions, speech, demo choice and the stored block. Validation of mode references. C6 and F7 metric corrections as a content proposal awaiting coach approval.

### Phase D: Brief Batch 2 (conservative parts; policy questions listed)
19. R02: one eligibility function with reasons. Unknown extended context no longer matches known context. Advancement uses the same contract. Self, experimental and unvalidated automatic measures can't promote.
20. R03: presence relabelled as a motion-based activity check; technical reasons kept apart from skipped blocks; practice time always shown. Unlock policy unchanged.
21. R09: conservative progress language ("better this attempt"); faster with more errors is not improvement.

### Phase E: Brief Batch 3
22. R15: practice rounds kept out of scored attempts; rep strip with text and symbols; empty states with a next action.
23. R06: readiness overview (Training, Recording, Measures); grouped parent hub; System test switch snapshot.
24. R07: Home with one recommended card and the rest folded away; analysis states (pending, ready, not recorded, unable to assess, failed) on the end card and summary; a late result saved with a "new result" cue.
25. R08 (display part): "N min training + setup"; a breakdown of planned work and overhead. Dose changes wait for the coach.

### Phase F: later and smaller
26. Fix 17: local dates, onset gate, microphone leak, double-counted kept trial, notification queue, dependency clean-up, lazy parent screens (R13 measured first), dead code, fullscreen and keys.
27. Brief Batch 4 (R10–R12): only the parts that need no policy or pilot (R12 summary fields and coach question; R10 display of the next objective). R11 evaluation changes wait for the labelled pilot.

## Decisions for the owner (recorded in PROGRESS.md as they come up)

1. The three stage rules with `consecutive: 1`: intended, or should they be 2?
2. Light builder sessions turn benchmarks into rest and still unlock as `completed`.
3. Multi-area runs count one session per area toward the week.
4. Sessions skipped by a confirmed skip-ahead: offer them to repeat, or change the wording.
5. Self-hosting the MediaPipe models for offline analysis (Fix 7.5).
6. R02: which manual protocols count as verified; which cue-level equivalences are intended; what validates each automatic component.
7. R03: may a parent's manual confirmation change programme credit when the camera's activity check is unreliable?
8. R01: approval of the C6 and F7 measure changes and of the mode-specific teaching copy.
9. R08: coach approval of structured dose fields.
10. R09: a metric-specific repeatability rule (needs a pilot).
