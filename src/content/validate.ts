import { CHECK_IDS } from '../domain/systemTest';
import { METRIC_LABELS } from '../domain/focus';
import { TEACH_MODES, type Programme } from './types';

// A small hand-written schema checker. Each problem is reported as
// "<where>: <what was expected>, found <what was there>" so a typo in the JSON
// file can be found without reading code.

type Check = (v: unknown, path: string, errs: string[]) => void;

const describe = (v: unknown): string => {
  if (v === null) return 'nothing (null)';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'string') return `text "${v.length > 30 ? v.slice(0, 30) + '…' : v}"`;
  if (typeof v === 'object') return 'a group of fields';
  if (v === undefined) return 'nothing (missing)';
  return `${typeof v} ${String(v)}`;
};

const str: Check = (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: expected text, found ${describe(v)}`);
};
const num: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${p}: expected a number, found ${describe(v)}`);
};
const posNum: Check = (v, p, e) => {
  if (typeof v !== 'number' || !(v > 0)) e.push(`${p}: expected a number above 0, found ${describe(v)}`);
};
const bool: Check = (v, p, e) => {
  if (typeof v !== 'boolean') e.push(`${p}: expected true or false, found ${describe(v)}`);
};
const nullOr =
  (c: Check): Check =>
  (v, p, e) => {
    if (v !== null) c(v, p, e);
  };
const optional =
  (c: Check): Check =>
  (v, p, e) => {
    if (v !== undefined) c(v, p, e);
  };
const oneOf =
  (...vals: string[]): Check =>
  (v, p, e) => {
    if (typeof v !== 'string' || !vals.includes(v)) e.push(`${p}: expected one of ${vals.join(', ')}, found ${describe(v)}`);
  };
const list =
  (c: Check): Check =>
  (v, p, e) => {
    if (!Array.isArray(v)) {
      e.push(`${p}: expected a list, found ${describe(v)}`);
      return;
    }
    v.forEach((item, i) => c(item, `${p}[${i}]`, e));
  };
const obj =
  (shape: Record<string, Check>): Check =>
  (v, p, e) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      e.push(`${p}: expected a group of fields, found ${describe(v)}`);
      return;
    }
    const o = v as Record<string, unknown>;
    for (const [k, c] of Object.entries(shape)) c(o[k], p ? `${p}.${k}` : k, e);
  };
const record =
  (c: Check): Check =>
  (v, p, e) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      e.push(`${p}: expected a group of fields, found ${describe(v)}`);
      return;
    }
    for (const [k, item] of Object.entries(v)) c(item, `${p}.${k}`, e);
  };
const anyObj: Check = (v, p, e) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) e.push(`${p}: expected a group of fields, found ${describe(v)}`);
};

const SIMPLE_BLOCKS = ['warmup', 'rest', 'log', 'transition', 'cooldown', 'mobility', 'break'];

const block: Check = (v, p, e) => {
  anyObj(v, p, e);
  if (typeof v !== 'object' || v === null) return;
  const b = v as Record<string, unknown>;
  oneOf(...SIMPLE_BLOCKS, 'work', 'benchmark')(b.type, `${p}.type`, e);
  posNum(b.minutes, `${p}.minutes`, e);
  if (b.type === 'work') {
    str(b.drillId, `${p}.drillId`, e);
    str(b.params, `${p}.params`, e);
  }
  if (b.type === 'benchmark') {
    str(b.benchmarkId, `${p}.benchmarkId`, e);
    str(b.cueLevel, `${p}.cueLevel`, e);
    optional(bool)(b.alsoCueAccuracy, `${p}.alsoCueAccuracy`, e);
    optional(bool)(b.coachTransferRequested, `${p}.coachTransferRequested`, e);
  }
};

const slot: Check = (v, p, e) => {
  anyObj(v, p, e);
  if (typeof v !== 'object' || v === null) return;
  const s = v as Record<string, unknown>;
  oneOf(...SIMPLE_BLOCKS, 'work', 'benchmark', 'quiz')(s.type, `${p}.type`, e);
  posNum(s.minutes, `${p}.minutes`, e);
  if (s.type === 'work') {
    num(s.area, `${p}.area`, e);
    oneOf('A', 'B', 'C')(s.from, `${p}.from`, e);
  }
  if (s.type === 'benchmark') num(s.area, `${p}.area`, e);
  if (s.type === 'quiz') str(s.drillId, `${p}.drillId`, e);
};

const programmeShape: Check = obj({
  version: str,
  generated: str,
  note: str,
  layouts: record(obj({ name: str, setup: str, start: optional(str), derivedFrom: optional(list(str)) })),
  stages: list(obj({ id: str, order: num, name: str, sessions: list(num) })),
  warmup: obj({ minutes20: posNum, minutes30: posNum, minutes45: posNum, minutes60: posNum, steps: list(str), basis: str }),
  drills: list(
    obj({
      id: str,
      areaId: str,
      name: str,
      layoutId: str,
      purpose: str,
      setupText: str,
      prescription: str,
      steps: optional(list(str)),
      stepsWall: optional(list(str)),
      teach: optional(record(obj({ why: optional(str), steps: list(str), read: optional(list(str)), success: str, commonError: str, easier: str, harder: str }))),
      cues: list(str),
      commonErrors: list(str),
      demo: obj({
        type: oneOf('none', 'youtube', 'own'),
        ref: str,
        ownDemoPlanned: bool,
        outsideSearchPhrase: nullOr(str),
        outsideMustShow: nullOr(str),
        status: str,
        title: optional(str),
        modes: optional(list(str)),
        startS: optional(num),
        endS: optional(num),
        alternatives: optional(list(obj({ ref: str, title: str, startS: optional(num), endS: optional(num) }))),
      }),
      safety: str,
      variants: obj({ solo: bool, partner: nullOr(obj({ required: bool })) }),
      mode: oneOf('timed', 'reps'),
      cueDrillId: optional(str),
      routine: optional(bool),
      scanModes: optional(list(str)),
      sets: optional(obj({ count: num, labels: optional(list(str)) })),
      defenderDrillId: optional(str),
    }),
  ),
  areas: list(obj({ id: str, name: str, priorityTags: list(str), benchmarkId: str })),
  sessions: list(obj({ id: str, areaId: str, number: num, stageId: str, durationMinutes: posNum, blocks: list(block) })),
  benchmarks: list(obj({ id: str, areaId: nullOr(str), name: str, metrics: list(str), cueLevels: list(str), protocol: str, rubric: optional(list(anyObj)) })),
  advancement: record(record(str)),
  cueDrills: list(
    obj({
      id: str,
      name: str,
      cueTypes: list(str),
      rule: str,
      howTo: optional(obj({ why: optional(str), expect: str, words: record(str), say: optional(str) })),
      durationS: posNum,
      soccerMeaning: str,
      values: optional(list(str)),
      trigger: optional(oneOf('rep', 'interval')),
      reps: optional(posNum),
      repPeriodS: optional(posNum),
      startToCueMinS: optional(num),
      startToCueMaxS: optional(num),
      tripwireDelayMinMs: optional(num),
      tripwireDelayMaxMs: optional(num),
      intervalMinS: optional(posNum),
      intervalMaxS: optional(posNum),
      displayS: optional(posNum),
      catchFraction: optional(num),
      catchTypes: optional(list(oneOf('noCue', 'blockedShaping', 'lateCue'))),
      numbers: optional(bool),
      secondCue: optional(obj({ onValue: str, fraction: num, delayMinMs: num, delayMaxMs: num, values: list(str) })),
    }),
  ),
  feedbackTemplates: record(str),
  voiceStyles: optional(record(obj({ name: str, note: optional(str), rate: posNum, pitch: posNum, lines: list(obj({ match: str, say: str })) }))),
  anchors: list(obj({ id: str, name: str, layoutId: str, drillId: str, conditions: anyObj, minutes: posNum, metrics: list(str) })),
  anchorCheck: obj({ everyDays: posNum, blocks: list(anyObj), recordType: oneOf('anchor'), unlocks: bool, countsTowardWeek: bool }),
  layoutGeometry: obj({
    defaults: obj({ roomLengthM: posNum, roomWidthM: posNum, floor: str, wallUsable: bool, cones: num }),
    slalom: obj({ cones: posNum, startFromWallM: num, stopZoneM: num, marginM: num, maxSpacingM: posNum, minSpacingM: posNum }),
    feintLane: obj({ startFromWallM: num, maxFeintConeM: posNum, gatePastConeM: posNum, gateWidthM: posNum, stopZoneM: posNum, narrow: optional(obj({ innerM: posNum, wallGapM: posNum, minGateM: posNum })), single: optional(obj({ minWidthM: posNum })) }),
    receiveBox: obj({ maxSideM: posNum, sideClearanceM: num, gateWidthM: posNum, cueScreenBehindM: num, narrow: optional(obj({ sideClearanceM: posNum, minSideM: posNum })), single: optional(obj({ minWidthM: posNum, coneGapM: posNum })) }),
    masterySquare: obj({ sideM: posNum }),
  }),
  baselines: list(obj({ areaId: str, blocks: list(block), questions: list(str), defaultStartSession: posNum })),
  placementRule: obj({ byYesCount: record(posNum) }),
  builder: obj({
    durations: list(posNum),
    templates: list(obj({ id: str, minutes: posNum, areas: posNum, light: optional(bool), slots: list(slot) })),
    noBall: obj({ minutes: posNum, slots: list(slot) }),
    restBetweenBlocksS: num,
    countdownS: num,
  }),
  quiz: obj({ items: posNum, answerS: posNum, drillId: str, options: list(str) }),
  advancementRules: list(
    obj({
      areaId: str,
      from: str,
      to: str,
      benchmarkId: optional(str),
      cueLevels: optional(list(str)),
      drillIds: optional(list(str)),
      consecutive: num,
      checks: list(obj({ metric: str, op: oneOf('>=', '<='), value: num })),
      parentChecks: optional(list(str)),
      requiresTransfer: optional(bool),
    }),
  ),
  regression: record(str),
  priorities: list(str),
  coreMoveDrills: list(str),
  benchmarkCueDrills: optional(record(str)),
  benchmarkLayouts: optional(record(str)),
  systemTest: optional(obj({ title: str, note: optional(str), blocks: list(obj({ layoutId: str, drillId: str, minutes: posNum, tests: str, checks: list(str) })), parentChecks: list(obj({ id: str, question: str })) })),
  focusMetricConfig: record(
    obj({ primary: list(str), supporting: list(str), experimental: list(str), progressionEligible: list(str), qualityGuardrails: optional(list(str)) }),
  ),
  reactionModesProgression: list(str),
  defenderArchetypes: list(obj({ id: str, label: str, notes: optional(str) })),
  scanModes: list(obj({ id: str, label: str, note: str, requires: nullOr(str) })),
  capstone: obj({ id: str, name: str, chain: list(str), note: str, components: list(obj({ id: str, label: str, minReps: posNum, minAgreement: posNum, procedure: str, scoresTests: optional(list(str)) })) }),
  defenderDrills: list(
    obj({
      id: str,
      name: str,
      rule: str,
      reps: posNum,
      repPeriodS: posNum,
      approachMinS: posNum,
      approachMaxS: posNum,
      approachAngleMaxDeg: num,
      archetypes: list(oneOf('earlyCommit', 'holding', 'reactive', 'benchmarkOpponent')),
      difficulty: posNum,
      allowedModes: optional(list(str)),
      note: optional(str),
    }),
  ),
});

/** Cross-references: ids that must point at something that exists, and minutes that must add up. */
function crossCheck(p: Programme, errs: string[]): void {
  const drillIds = new Set(p.drills.map((d) => d.id));
  const areaIds = new Set(p.areas.map((a) => a.id));
  const benchIds = new Set(p.benchmarks.map((b) => b.id));
  const stageIds = new Set(p.stages.map((s) => s.id));
  const seen = new Set<string>();
  for (const d of p.drills) {
    if (seen.has(d.id)) errs.push(`drills: the id "${d.id}" is used twice`);
    seen.add(d.id);
    if (!areaIds.has(d.areaId)) errs.push(`drill ${d.id}: areaId "${d.areaId}" is not one of the areas`);
    if (!p.layouts[d.layoutId]) errs.push(`drill ${d.id}: layoutId "${d.layoutId}" is not one of the layouts`);
  }
  const sessionKeys = new Set<string>();
  p.sessions.forEach((s) => {
    const where = `session ${s.id}`;
    if (!areaIds.has(s.areaId)) errs.push(`${where}: areaId "${s.areaId}" is not one of the areas`);
    if (!stageIds.has(s.stageId)) errs.push(`${where}: stageId "${s.stageId}" is not one of the stages`);
    const key = `${s.areaId}#${s.number}`;
    if (sessionKeys.has(key)) errs.push(`${where}: ${s.areaId} session ${s.number} appears twice`);
    sessionKeys.add(key);
    const total = s.blocks.reduce((t, b) => t + b.minutes, 0);
    if (total !== s.durationMinutes) errs.push(`${where}: blocks add up to ${total} minutes but durationMinutes is ${s.durationMinutes}`);
    s.blocks.forEach((b, i) => {
      if (b.type === 'work' && b.drillId !== 'choice' && !drillIds.has(b.drillId)) errs.push(`${where} block ${i + 1}: drill "${b.drillId}" does not exist`);
      if (b.type === 'benchmark' && !benchIds.has(b.benchmarkId)) errs.push(`${where} block ${i + 1}: benchmark "${b.benchmarkId}" does not exist`);
    });
  });
  for (const a of p.areas) {
    if (!benchIds.has(a.benchmarkId)) errs.push(`area ${a.id}: benchmarkId "${a.benchmarkId}" does not exist`);
    if (!p.baselines.some((b) => b.areaId === a.id)) errs.push(`area ${a.id}: no baseline defined`);
  }
  for (const t of p.builder.templates) {
    const total = t.slots.reduce((s, x) => s + x.minutes, 0);
    if (total !== t.minutes) errs.push(`builder template ${t.id}: slots add up to ${total} minutes but minutes is ${t.minutes}`);
  }
  const nb = p.builder.noBall.slots.reduce((s, x) => s + x.minutes, 0);
  if (nb !== p.builder.noBall.minutes) errs.push(`builder.noBall: slots add up to ${nb} minutes but minutes is ${p.builder.noBall.minutes}`);
  const cueIds = new Set(p.cueDrills.map((c) => c.id));
  for (const d of p.drills) if (d.cueDrillId && !cueIds.has(d.cueDrillId)) errs.push(`drill ${d.id}: cueDrillId "${d.cueDrillId}" is not one of the cue drills`);
  for (const c of p.cueDrills) if (!c.values?.length && c.trigger) errs.push(`cue drill ${c.id}: needs a list of values`);
  for (const an of p.anchors) if (!drillIds.has(an.drillId)) errs.push(`anchor ${an.id}: drill "${an.drillId}" does not exist`);
  for (const d of p.drills) if (!p.focusMetricConfig[d.id]) errs.push(`drill ${d.id}: no focusMetricConfig entry (part 16 §6)`);
  for (const [id, f] of Object.entries(p.focusMetricConfig)) {
    if (!drillIds.has(id)) errs.push(`focusMetricConfig ${id}: drill does not exist`);
    if (!f.primary.length || f.primary.length > 2) errs.push(`focusMetricConfig ${id}: needs one or two primary measures`);
    for (const m of f.progressionEligible) if (f.experimental.includes(m)) errs.push(`focusMetricConfig ${id}: experimental measure "${m}" cannot be progression-eligible`);
  }
  // Only progression-eligible measures can move a stage (task 5.1): each rule's benchmark must measure one.
  for (const r of p.advancementRules) {
    const b = p.benchmarks.find((x) => x.id === r.benchmarkId);
    if (!b) continue;
    const eligible = new Set(p.drills.filter((d) => d.areaId === r.areaId).flatMap((d) => (p.focusMetricConfig[d.id]?.progressionEligible ?? []).flatMap((m) => m.split('+'))));
    if (!b.metrics.some((m) => eligible.has(m))) errs.push(`advancement rule ${r.areaId} ${r.from}->${r.to}: benchmark ${b.id} measures nothing progression-eligible in this area`);
  }
  const defIds = new Set(p.defenderDrills.map((x) => x.id));
  for (const d of p.drills) if (d.defenderDrillId && !defIds.has(d.defenderDrillId)) errs.push(`drill ${d.id}: defenderDrillId "${d.defenderDrillId}" is not one of the defender drills`);
  for (const x of p.defenderDrills) for (const m of x.allowedModes ?? []) if (!p.reactionModesProgression.includes(m)) errs.push(`defender drill ${x.id}: "${m}" is not one of the reaction modes`);
  const modeIds = new Set(p.scanModes.map((m) => m.id));
  for (const d of p.drills) for (const m of d.scanModes ?? []) if (!modeIds.has(m)) errs.push(`drill ${d.id}: scan mode "${m}" is not one of the scan modes`);
  // Teaching per training mode (Brief R01): known modes, three steps, and a 3D version for every defender drill.
  for (const d of p.drills) {
    for (const [m, t] of Object.entries(d.teach ?? {})) {
      if (!(TEACH_MODES as readonly string[]).includes(m)) errs.push(`drill ${d.id}: unknown teaching mode "${m}" (known: ${TEACH_MODES.join(', ')})`);
      if (t && t.steps.length !== 3) errs.push(`drill ${d.id} teaching ${m}: three steps expected, found ${t.steps.length}`);
    }
    for (const m of d.demo.modes ?? []) if (!['defender3d', 'cueFallback', 'cue', 'anchorFixed', 'plain'].includes(m)) errs.push(`drill ${d.id}: demo mode "${m}" is not a training mode`);
    if (d.defenderDrillId && !d.teach?.defender3d) errs.push(`drill ${d.id}: runs with the 3D defender but has no "defender3d" teaching`);
    if (d.defenderDrillId && d.cueDrillId && !d.teach?.cue) errs.push(`drill ${d.id}: has a word/arrow fallback but no "cue" teaching`);
  }
  // Every measure a drill names must be one the app knows.
  for (const [id, f] of Object.entries(p.focusMetricConfig)) {
    for (const m of [...f.primary, ...f.supporting, ...f.experimental, ...f.progressionEligible, ...(f.qualityGuardrails ?? [])]) if (!(m in METRIC_LABELS)) errs.push(`focusMetricConfig ${id}: unknown measure "${m}"`);
  }
  const st = p.systemTest;
  if (st) {
    const seen: string[] = [];
    for (const b of st.blocks) {
      const d = p.drills.find((x) => x.id === b.drillId);
      if (!d) errs.push(`system test: drill "${b.drillId}" does not exist`);
      else if (d.layoutId !== b.layoutId) errs.push(`system test ${b.drillId}: drill uses ${d.layoutId}, not ${b.layoutId}`);
      for (const c of b.checks) if (!(CHECK_IDS as readonly string[]).includes(c)) errs.push(`system test ${b.drillId}: unknown check "${c}"`);
      // Each layout once, so the cones move as few times as possible.
      if (seen.includes(b.layoutId) && seen[seen.length - 1] !== b.layoutId) errs.push(`system test ${b.drillId}: layout ${b.layoutId} comes back after another layout (extra cone moves)`);
      if (!seen.includes(b.layoutId) || seen[seen.length - 1] !== b.layoutId) seen.push(b.layoutId);
    }
  }
  for (const r of p.advancementRules) {
    if (!areaIds.has(r.areaId)) errs.push(`advancement rule ${r.areaId} ${r.from}->${r.to}: unknown area`);
    if (r.benchmarkId && !benchIds.has(r.benchmarkId)) errs.push(`advancement rule ${r.areaId} ${r.from}->${r.to}: benchmark "${r.benchmarkId}" does not exist`);
  }
}

/** Things that load but deserve a look (shown on Parent → Content, never stop the app). */
export function contentWarnings(p: Programme): string[] {
  const out: string[] = [];
  for (const r of p.advancementRules) {
    // Part 15 D12 asks for evidence on two different days; a stage rule asking for fewer is listed for the coach.
    if (r.to !== 'exit' && r.consecutive < 2)
      out.push(`Advancement ${r.areaId} ${r.from}→${r.to} needs passes on ${r.consecutive} day${r.consecutive === 1 ? '' : 's'}; stage advancement usually needs two different days. Ask the coach whether this is intended.`);
  }
  return out;
}

export type ValidationResult = { ok: true; programme: Programme } | { ok: false; errors: string[] };

/** Line and column of a character offset, for JSON syntax errors. */
function lineCol(text: string, pos: number): string {
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `line ${line}, column ${col}`;
}

export function parseProgramme(text: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = /position (\d+)/.exec(msg);
    const where = m ? ` near ${lineCol(text, Number(m[1]))}` : '';
    return { ok: false, errors: [`The content file is not valid JSON${where}: ${msg}`] };
  }
  return validateProgramme(data);
}

export function validateProgramme(data: unknown): ValidationResult {
  const errors: string[] = [];
  programmeShape(data, '', errors);
  if (errors.length === 0) crossCheck(data as Programme, errors);
  return errors.length ? { ok: false, errors } : { ok: true, programme: data as Programme };
}
