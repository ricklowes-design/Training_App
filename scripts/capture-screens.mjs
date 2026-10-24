// Captures docs/screens/*.png with fictional sample data. Usage:
//   npx vite build --outDir /tmp/shots-dist && npx vite preview --outDir /tmp/shots-dist --port 4174 &
//   npm run test:e2e -- e2e/10 (once, to create the fake video in the temp folder) then
//   node scripts/capture-screens.mjs docs/screens
import { chromium } from '@playwright/test';
const OUT = process.argv[2];
const URL_ = 'http://localhost:4174/';
const PIN = '1234';
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=/tmp/home-training-moving.y4m', '--autoplay-policy=no-user-gesture-required'] });

async function newPage(clock = true) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  if (clock) await page.clock.install({ time: new Date('2026-11-06T17:00:00') });
  await page.goto(URL_);
  return page;
}
const b = (p, name) => p.getByRole('button', { name }).first();
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
async function focus(p) {
  const f = p.getByRole('button', { name: /^Choose a focus/ });
  if ((await f.getAttribute('aria-expanded')) === 'false') await f.click();
}
async function setup(p, { shots = false } = {}) {
  await p.getByLabel("Player's first name").fill('Sam');
  await p.getByLabel('Position').fill('winger');
  if (shots) await shot(p, '01-setup-player');
  await b(p, 'Next').click();
  if (shots) await shot(p, '02-setup-room');
  await b(p, 'Next').click();
  await b(p, 'Next').click();
  if (shots) await shot(p, '03-setup-priorities');
  await b(p, 'Next').click();
  if (shots) await shot(p, '04-setup-demonstrations');
  await b(p, 'Next').click();
  await p.getByLabel('Parent PIN (4 digits)').fill(PIN);
  if (shots) await shot(p, '05-setup-backup-pin');
  await b(p, 'Finish set-up').click();
  await p.getByRole('heading', { level: 1, name: /Week of/ }).waitFor();
}
async function parent(p, section) {
  await b(p, 'Parent mode').click();
  const pin = p.getByLabel('PIN', { exact: true });
  if (await pin.isVisible().catch(() => false)) { await pin.fill(PIN); await b(p, 'Open').click(); }
  if (section) await b(p, section).click();
}
async function put(p, store, rows) {
  await p.evaluate(({ store, rows }) => new Promise((res, rej) => {
    const r = indexedDB.open('home-training');
    r.onsuccess = () => { const tx = r.result.transaction(store, 'readwrite'); for (const row of rows) tx.objectStore(store).put(row); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); };
  }), { store, rows });
}
async function patchSettings(p, patch) {
  await p.evaluate((patch) => new Promise((res) => { const r = indexedDB.open('home-training'); r.onsuccess = () => { const tx = r.result.transaction('settings', 'readwrite'); const st = tx.objectStore('settings'); st.get('main').onsuccess = (e) => st.put({ ...e.target.result, ...patch }); tx.oncomplete = () => res(); }; }), patch);
}

/** Fictional history: 8 weeks of sessions and benchmark results (plan/05 style sample data). */
async function seed(p) {
  await put(p, 'placements', [['scanning', 1], ['feinting', 5], ['dribbling', 5], ['control', 3]].map(([areaId, s]) => ({ areaId, startSession: s, proposed: s, overridden: false, explanation: 'sample', date: '2026-09-10T17:00:00.000Z' })));
  const plan = [
    ['2026-09-15', 'scanning', 1], ['2026-09-18', 'feinting', 5], ['2026-09-22', 'control', 3], ['2026-09-25', 'dribbling', 5],
    ['2026-09-29', 'scanning', 2], ['2026-10-02', 'control', 4], ['2026-10-06', 'feinting', 6], ['2026-10-09', 'dribbling', 6],
    ['2026-10-14', 'scanning', 3], ['2026-10-20', 'control', 5], ['2026-10-23', 'dribbling', 7], ['2026-10-27', 'feinting', 7],
    ['2026-11-03', 'scanning', 4],
  ];
  const recs = plan.map(([d, areaId, n], i) => ({ id: `r${i}`, runId: `run${i}`, kind: 'programme', areaId, sessionNumber: n, sessionId: `${areaId}-${n}`, date: `${d}T17:00:00.000Z`, endedAt: `${d}T17:20:00.000Z`, status: 'completed', reasons: [], plannedMinutes: 20, blocks: [], pauses: [], trial: false, appVersion: '0.1.0', contentVersion: '0.3.0', layoutVersion: 1 }));
  recs.push({ ...recs[0], id: 'rp', runId: 'runp', areaId: 'feinting', sessionNumber: 8, sessionId: 'feinting-8', date: '2026-11-04T17:00:00.000Z', status: 'stopped', reasons: ['stopped'] });
  await put(p, 'sessionRecords', recs);
  const cond = (cueLevel) => ({ layoutVersion: 1, cueLevel, floor: 'hard', recorded: false, recordedBy: 'parent' });
  const res = (id, rec, date, benchmarkId, areaId, cueLevel, values) => ({ id, sessionRecordId: rec, blockIndex: 4, attempt: 1, date: `${date}T17:18:00.000Z`, benchmarkId, areaId, conditions: cond(cueLevel), values });
  await put(p, 'benchmarkResults', [
    res('b1', 'r8', '2026-10-14', 'SB', 'scanning', '3', { kind: 'SB', correct: 7 }),
    res('b2', 'r12', '2026-11-03', 'SB', 'scanning', '3', { kind: 'SB', correct: 9 }),
    res('b3', 'r2', '2026-09-22', 'CB', 'control', 'std', { kind: 'CB', cb1: { left: 14, right: 20 }, cb2: { left: 2, right: 4 } }),
    res('b4', 'r5', '2026-10-02', 'CB', 'control', 'std', { kind: 'CB', cb1: { left: 16, right: 21 }, cb2: { left: 3, right: 4 } }),
    res('b5', 'r10', '2026-10-23', 'DB', 'dribbling', 'headup', { kind: 'DB', right: { timeS: 10.4, errors: 1, digits: 6 }, left: { timeS: 11.6, errors: 2, digits: 5 } }),
    res('b6', 'r11', '2026-10-27', 'FB', 'feinting', 'pace', { kind: 'FB', right: { sell: 8, exit: 9, eyes: 7 }, left: { sell: 7, exit: 7, eyes: 5 } }),
  ]);
  await put(p, 'advancements', [{ areaId: 'control', from: 'st1', to: 'st2', date: '2026-10-10T19:00:00.000Z', decision: 'confirmed', criteriaText: 'CB-2 >= 7/10 with left >= 3/5 twice', author: 'parent' }]);
  await put(p, 'coachNotes', [{ date: '2026-10-28T19:00:00.000Z', author: 'coach via parent', target: { kind: 'drill', id: 'F3' }, body: 'Smaller scissors, faster exit touch.' }]);
  await put(p, 'milestones', [{ id: 'first:scanning', date: '2026-09-15', text: 'x', shownAt: '2026-09-15' }, { id: 'first:feinting', date: '2026-09-18', text: 'x', shownAt: 'x' }, { id: 'first:control', date: '2026-09-22', text: 'x', shownAt: 'x' }, { id: 'first:dribbling', date: '2026-09-25', text: 'x', shownAt: 'x' }, { id: 'ten', date: 'x', text: 'x', shownAt: 'x' }]);
  await p.reload();
  await p.getByRole('heading', { level: 1 }).waitFor();
}

// ---------- 1. Set-up, home, progress ----------
{
  const p = await newPage();
  await setup(p, { shots: true });
  await seed(p);
  await patchSettings(p, { cueEngine: false });
  await p.reload();
  await p.getByRole('heading', { level: 1, name: /Week of/ }).waitFor();
  await p.waitForTimeout(500);
  await shot(p, '06-home');
  await b(p, 'Progress').click();
  await shot(p, '20-progress-week');
  await b(p, 'Skills').click();
  await p.screenshot({ path: `${OUT}/21-progress-skills.png`, fullPage: true });
  await b(p, 'Drills').click();
  await p.locator('li', { hasText: 'CB · V-pulls' }).getByRole('button').click();
  await b(p, '1 month ago').click();
  await shot(p, '22-progress-drill-comparison');
  await b(p, 'Back').click();
  await p.locator('li', { hasText: 'SB · Cue-behind' }).getByRole('button').click();
  await shot(p, '23-progress-drill-improvement');
  await b(p, 'Home').click().catch(() => {});
  await p.goto(URL_);
  await focus(p);
  await b(p, 'Build a longer session').click();
  await b(p, '45 min').click();
  await b(p, 'Dribbling S8').click();
  await b(p, 'Ball control S6').click();
  await p.screenshot({ path: `${OUT}/24-builder-45min.png`, fullPage: true });
  // A session: Feinting S8 starts with F3 (coach note), then F7, then the FB rubric.
  await p.goto(URL_);
  await focus(p);
  const card = p.locator('.card.row', { hasText: 'Feinting · Stage 2 · Session 8' });
  if (await card.getByRole('checkbox').isChecked()) await card.getByRole('checkbox').click();
  await card.getByRole('button', { name: 'Start' }).click();
  await p.clock.runFor(3_000);
  await shot(p, '07-countdown');
  await p.clock.runFor(30_000);
  await shot(p, '08-practice-warmup');
  await p.clock.runFor(160_000);
  await shot(p, '09-demo-view-with-coach-note');
  await b(p, '▶ Start block').click();
  await p.clock.runFor(10_500 + 120_000);
  await shot(p, '10-practice-timer');
  await b(p, 'PAUSE').click();
  await shot(p, '11-practice-paused');
  await b(p, 'RESUME').click();
  await p.clock.runFor(250_000);
  await shot(p, '12-end-of-drill-card');
  // F7 runs too, then the benchmark.
  await p.clock.runFor(21_000 + 61_000 + 21_000 + 10_500 + 361_000 + 21_000);
  await b(p, '▶ Start block').click();
  await p.clock.runFor(10_500 + 181_000);
  await shot(p, '13-benchmark-form-feint-rubric');
  // Blank result card (D10): one tap per number.
  for (const [label, n] of [['Right fake /10', 8], ['Right exit /10', 7], ['Right eyes /10', 8], ['Left fake /10', 5], ['Left exit /10', 6], ['Left eyes /10', 7]]) await p.getByRole('button', { name: `${label} ${n}`, exact: true }).click();
  await b(p, 'Confirm').click();
  await p.waitForTimeout(400);
  await shot(p, '14-end-of-drill-card-comparison');
  await b(p, /^Next/).click();
  await p.clock.runFor(62_000);
  await p.getByRole('heading', { name: 'Session saved' }).waitFor();
  await p.clock.resume();
  await p.waitForTimeout(500);
  await shot(p, '15-session-summary');
  await p.context().close();
}

// ---------- 2. Cue drills and the slalom timer ----------
{
  const p = await newPage();
  await setup(p);
  await parent(p, /^Placement/);
  for (const [area, n] of [['Feinting', 11], ['Dribbling', 7]]) {
    await p.locator('.card', { hasText: area }).getByRole('button', { name: /Place without a baseline/ }).click();
    await p.getByLabel('Start at session').selectOption(String(n));
    await p.getByLabel('Reason (logged)').fill('screenshots');
    await b(p, 'Save').click();
  }
  // Cue drill builder.
  await b(p, 'Parent menu').click();
  await b(p, /^Cue drills/).click();
  await shot(p, '30-cue-drills-builder');
  await p.locator('tr', { hasText: '(cue-defender)' }).getByRole('button', { name: 'Edit' }).click();
  await p.screenshot({ path: `${OUT}/31-cue-drill-editor.png`, fullPage: true });
  await p.getByRole('button', { name: 'Close', exact: true }).click();
  await b(p, 'Close parent mode').click();
  // F6 with word cues (BIT / HELD / BLOCKED): the D3 fallback when the 3D defender is off.
  await patchSettings(p, { flags: { defender3d: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false } });
  await p.reload();
  await focus(p);
  const card = p.locator('.card.row', { hasText: 'Feinting · Stage 3 · Session 11' });
  if (await card.getByRole('checkbox').isChecked()) await card.getByRole('checkbox').click();
  await card.getByRole('button', { name: 'Start' }).click();
  await p.clock.runFor(191_000);
  await b(p, '▶ Start block').click();
  await p.clock.runFor(10_500);
  const seen = new Set();
  for (let i = 0; i < 400 && seen.size < 3; i++) {
    await p.clock.runFor(100);
    const w = p.locator('.cue-word');
    if (await w.count()) {
      const t = (await w.innerText()).trim();
      if (!seen.has(t)) { seen.add(t); await shot(p, `32-cue-${t.toLowerCase()}`); }
    }
  }
  await b(p, 'STOP').click();
  await p.waitForTimeout(300);
  await p.goto(URL_);
  // The 3D defender shots (60 and docs/screens/defender) come from e2e/shots-defender.spec.ts (see docs/screens/README.md).
  // Arrow cue (from the cue drill preview) and the head-up slalom timer.
  await parent(p, /^Cue drills/);
  await p.locator('tr', { hasText: '(cue-exit)' }).getByRole('button', { name: 'Edit' }).click();
  await b(p, 'Preview 30 s').click();
  for (let i = 0; i < 200; i++) { await p.clock.runFor(100); if (await p.locator('.cue-screen svg').count()) break; }
  await shot(p, '33-cue-arrow');
  await p.locator('.practice.cue').click();
  await p.getByRole('button', { name: 'Close', exact: true }).click();
  await b(p, 'Close parent mode').click();
  await patchSettings(p, { cueEngine: false });
  await p.reload();
  await focus(p);
  const d7 = p.locator('.card.row', { hasText: 'Dribbling · Stage 2 · Session 7' });
  if (await d7.getByRole('checkbox').isChecked()) await d7.getByRole('checkbox').click();
  await d7.getByRole('button', { name: 'Start' }).click();
  await p.clock.runFor(191_000);
  await b(p, '▶ Start block').click();
  await p.clock.runFor(10_500 + 20_000);
  await shot(p, '34-head-up-digits');
  await b(p, 'DONE').click().catch(() => {});
  await b(p, /^Next/).click();
  await p.clock.runFor(61_000);
  await b(p, 'Skip block').click();
  await b(p, '▶ Start block').click();
  await p.clock.runFor(10_500 + 3_000);
  await shot(p, '35-slalom-ready');
  await p.clock.runFor(5_100 + 9_700);
  await shot(p, '36-slalom-finish-target');
  await p.context().close();
}

// ---------- 3. Feint video evaluation (camera) ----------
{
  const p = await newPage();
  await setup(p);
  await parent(p, /^Camera set-up/);
  await p.getByLabel(/^Camera on/).click();
  await p.waitForTimeout(500);
  await shot(p, '40-camera-section');
  await p.locator('.card.row', { hasText: 'Feinting (L2' }).getByRole('button', { name: 'Set up' }).click();
  await p.waitForTimeout(2500);
  await shot(p, '41-camera-reference-photo');
  await b(p, 'Take reference photo').click();
  const img = p.locator('img[alt="Reference photo"]');
  await img.waitFor();
  const tap = async (x, y) => { const bb = await img.boundingBox(); await p.mouse.click(bb.x + x * bb.width, bb.y + y * bb.height); };
  for (const [x, y] of [[0.5, 0.95], [0.5, 0.5], [0.72, 0.35], [0.28, 0.35], [0.6, 0.7]]) await tap(x, y);
  await shot(p, '42-camera-floor-calibration');
  await b(p, 'Next: zones').click();
  const zones = [[[0.05, 0.3], [0.95, 0.3], [0.98, 0.98], [0.02, 0.98]], [[0.62, 0.2], [0.8, 0.2], [0.8, 0.35], [0.62, 0.35]], [[0.2, 0.2], [0.38, 0.2], [0.38, 0.35], [0.2, 0.35]], [[0.3, 0.05], [0.7, 0.05], [0.7, 0.15], [0.3, 0.15]], [[0.2, 0.54], [0.8, 0.54], [0.8, 0.63], [0.2, 0.63]]];
  for (let i = 0; i < zones.length; i++) { for (const [x, y] of zones[i]) await tap(x, y); if (i < zones.length - 1) await b(p, 'Next zone').click(); }
  await shot(p, '43-camera-zones-and-tripwire');
  await b(p, 'Next: mirror check').click();
  await b(p, /It shows on the LEFT/).click();
  await b(p, 'Save camera set-up').click();
  await p.waitForTimeout(500);
  await b(p, 'Parent menu').click();
  await b(p, /^Placement/).click();
  await p.locator('.card', { hasText: 'Feinting' }).getByRole('button', { name: /Place without a baseline/ }).click();
  await p.getByLabel('Start at session').selectOption('9');
  await p.getByLabel('Reason (logged)').fill('screenshots');
  await b(p, 'Save').click();
  await b(p, 'Close parent mode').click();
  await patchSettings(p, { flags: { defender3d: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false } });
  await p.reload();
  await focus(p);
  const card = p.locator('.card.row', { hasText: 'Feinting · Stage 3 · Session 9' });
  if (await card.getByRole('checkbox').isChecked()) await card.getByRole('checkbox').click();
  await card.getByRole('button', { name: 'Start' }).click();
  await p.clock.runFor(191_000);
  for (let i = 0; i < 40; i++) { await p.clock.runFor(1_000); if (await p.getByText('Camera set up as before.').count()) break; }
  await shot(p, '44-demo-framing-check');
  await b(p, '▶ Start block').click();
  await p.clock.resume();
  await p.waitForTimeout(12_000);
  for (let i = 0; i < 60; i++) { if (await p.locator('.cue-screen svg').count()) break; await p.waitForTimeout(100); }
  await shot(p, '45-recording-cue-block');
  await p.waitForTimeout(15_000);
  await b(p, 'DONE').click();
  await p.locator('.endcard .repstrip').waitFor({ timeout: 90_000 }).catch(() => {});
  await b(p, 'Repeat').click();
  await b(p, 'STOP').click();
  await p.getByRole('heading', { name: 'Session saved' }).waitFor();
  // The fake webcam has no player in it, so the real analysis judges nothing. Replace it with
  // fictional sample numbers to show what a 16-rep reactive feint block's scorecard looks like.
  // Wait for the real analysis of the recorded block, then overwrite it with the sample.
  let clipId;
  for (let i = 0; i < 120 && !clipId; i++) {
    clipId = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('home-training'); r.onsuccess = () => { r.result.transaction('blockAnalyses').objectStore('blockAnalyses').getAll().onsuccess = (e) => res(e.target.result[0]?.clipId); }; }));
    if (!clipId) await p.waitForTimeout(1000);
  }
  const vals = ['LEFT', 'RIGHT'];
  const reps = Array.from({ length: 16 }, (_, i) => {
    const cue = 1800 + i * 10000 + (i % 4) * 90;
    const early = i === 3 || i === 11;
    const wrong = i === 7;
    const unable = i === 13;
    return { repIndex: i, cueTimeMs: cue, cueValue: vals[i % 2], onsetMs: cue + 230 + (i % 3) * 20, exitMs: cue + (early ? 120 : 380 + (i % 5) * 25), exitDir: (wrong ? vals[(i + 1) % 2] : vals[i % 2]).toLowerCase(), decisionCorrect: unable ? undefined : !wrong, headUpAtExit: i % 5 !== 0, zoneEvents: [], confidence: unable ? 0.4 : 0.9, flags: unable ? ['body lost'] : wrong ? ['gate and hips disagree'] : [], status: unable ? 'unableToAssess' : 'ok' };
  });
  await put(p, 'repAnalyses', reps.map((r) => ({ id: `${clipId}:${r.repIndex}`, clipId, repIndex: r.repIndex, data: r })));
  await put(p, 'blockAnalyses', [{ id: clipId, clipId, date: new Date().toISOString(), data: { reps: 16, validReps: 15, accuracy: 14 / 15, accuracyByCue: { LEFT: { correct: 8, of: 8 }, RIGHT: { correct: 6, of: 7 } }, reactivitySlope: 0.91, reactivityBand: [0.74, 1.08], headUpRate: 0.8, flaggedRepIndexes: [13, 7, 11], enoughReps: true, poseUsed: true, analysedFps: 15, analysisMs: 41000 } }]);
  await p.reload();
  await p.getByRole('heading', { level: 1 }).waitFor();
  await parent(p, /^Clips/);
  await p.locator('ul.clean li').first().getByRole('button', { name: 'Open' }).click();
  await p.waitForTimeout(1500);
  await p.locator('video').evaluate((v) => { v.pause(); v.currentTime = 1.2; });
  await p.waitForTimeout(500);
  await shot(p, '46-clip-player');
  await p.setViewportSize({ width: 1366, height: 1300 });
  await p.getByRole('heading', { name: 'Camera scorecard' }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/47-feint-scorecard-flagged-reps.png`, fullPage: true });
  await p.setViewportSize({ width: 1366, height: 768 });
  await b(p, 'Parent menu').click();
  await b(p, /^Pose speed test/).click();
  await shot(p, '48-pose-speed-test');
  await p.context().close();
}
// ---------- 5. Plan update (parts 15–18) ----------
{
  const p = await newPage(false);
  await setup(p);
  await seed(p);
  await p.reload();
  await p.getByRole('heading', { level: 1, name: /Week of/ }).waitFor();
  await p.waitForTimeout(500);
  await shot(p, '50-home-start-my-session');
  await parent(p, /^Room profiles/);
  await p.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await shot(p, '51-room-profile-size');
  await b(p, 'Next').click();
  await b(p, 'Take room photo').waitFor();
  await p.waitForTimeout(1200);
  await b(p, 'Take room photo').click();
  const tap = async (x, y) => {
    const bb = await p.getByTestId('room-photo').boundingBox();
    await p.mouse.click(bb.x + x * bb.width, bb.y + y * bb.height);
  };
  await tap(0.15, 0.3);
  await p.getByLabel('Next anchor is a').selectOption('Bookcase edge');
  await tap(0.85, 0.28);
  await shot(p, '52-room-profile-anchors');
  await b(p, 'Next').click();
  for (const [x, y] of [[0.08, 0.97], [0.92, 0.97], [0.78, 0.42], [0.22, 0.42]]) await tap(x, y);
  await shot(p, '53-room-profile-safe-floor');
  await b(p, 'Next').click();
  await b(p, /^L2 /).click();
  await shot(p, '54-room-profile-cones');
  await b(p, 'Confirm L2 positions').click();
  await b(p, 'Save and close').click();
  await b(p, 'Parent menu').click();
  await b(p, /^3D defender test/).click();
  await b(p, 'Commit right').click();
  await p.waitForTimeout(2600);
  await shot(p, '55-defender-3d-commit');
  await b(p, 'Hold').click();
  await p.waitForTimeout(2600);
  await shot(p, '56-defender-3d-hold');
  await b(p, 'Parent menu').click();
  await b(p, /^Validation/).click();
  await p.screenshot({ path: `${OUT}/57-validation.png`, fullPage: true });
  await b(p, 'Parent menu').click();
  await b(p, /^Learning/).click();
  await p.screenshot({ path: `${OUT}/58-learning.png`, fullPage: true });
  await b(p, 'Parent menu').click();
  await b(p, /^Balls/).click();
  await b(p, 'Register new ball').click();
  await p.waitForTimeout(1200);
  await shot(p, '59-ball-registration');
  await p.context().close();
}
await browser.close();
console.log('done');
