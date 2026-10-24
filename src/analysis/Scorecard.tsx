import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import type { BlockAnalysis, RepAnalysis } from './types';
import { THRESHOLDS } from './compute';
import { chancePct, chanceTail } from '../domain/chance';

const pct = (x?: number) => (x === undefined ? '—' : `${Math.round(100 * x)}%`);

/** Rep strip (plan/13 §13.2): green = correct; amber = possible early route commitment (with evidence); red = wrong; grey = unable to assess; white = not judged by the camera. */
export function RepStrip({ reps }: { reps: RepAnalysis[] }) {
  return (
    <div className="repstrip" aria-label="Reps">
      {reps.map((r) => {
        const early = !!r.possibleEarlyRouteCommitment;
        const colour =
          r.status === 'unableToAssess' ? '#6b7684' : r.decisionCorrect === false ? '#ff5c5c' : early ? '#ffb020' : r.decisionCorrect ? '#3ddc84' : '#f5f7fa';
        return (
          <span key={r.repIndex} style={{ color: colour }} title={`rep ${r.repIndex + 1}`}>
            {r.status === 'unableToAssess' ? '○' : '●'}
          </span>
        );
      })}
    </div>
  );
}

const REACTION_LABEL: Record<string, string> = { commit: 'committed', hold: 'held', delay: 'late reaction', commitOpposite: 'committed early', commitThenRecover: 'committed then recovered' };

/** The weaker link in one sentence (part 16 §6): never a combined score. */
export function takeaway(a: BlockAnalysis): string | null {
  const by = Object.entries(a.correctByDefenderAction ?? {}).filter(([, v]) => v.of >= 2);
  if (!by.length) return null;
  const worst = by.sort((x, y) => x[1].correct / x[1].of - y[1].correct / y[1].of)[0];
  if (worst[1].correct === worst[1].of) return 'Right exit against every defender action the camera could judge.';
  return `Weakest against a defender that ${REACTION_LABEL[worst[0]] ?? worst[0]}: ${worst[1].correct}/${worst[1].of} right.`;
}

/** Block scorecard (task 3.5): Basic by default, Advanced on toggle. Below the confidence threshold a rep is unable to assess, never scored. */
export function Scorecard({ analysis: a, reps }: { analysis: BlockAnalysis; reps: RepAnalysis[] }) {
  const [advanced, setAdvanced] = useState(false);
  const unable = reps.filter((r) => r.status === 'unableToAssess').length;
  const byCue = Object.entries(a.accuracyByCue);
  const decided = byCue.reduce((n, [, v]) => n + v.of, 0);
  const correct = byCue.reduce((n, [, v]) => n + v.correct, 0);
  const isDefender = !!a.correctByDefenderAction;
  const tk = takeaway(a);
  return (
    <div className="card stack">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>Camera scorecard</h3>
        <button className="btn small" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}>
          {advanced ? 'Basic' : 'Advanced'}
        </button>
      </div>
      <RepStrip reps={reps} />
      <p className="muted">Camera estimates (not yet validated against a parent's frame reading); unable-to-assess reps are left out, never counted as wrong.</p>
      {!a.enoughReps ? <p className="pill warn">Fewer than {THRESHOLDS.minValidReps} reps could be assessed: rates are shown but not used for criteria.</p> : null}
      <table className="data">
        <tbody>
          {decided ? (
            <tr>
              <th>{isDefender ? 'Right response to the defender (camera-judged reps)' : 'Correct (camera-judged reps)'}</th>
              <td>
                {correct}/{decided}
                {isDefender ? '' : ` · ${byCue.map(([k, v]) => `${k} ${v.correct}/${v.of}`).join(' · ')}`}
              </td>
            </tr>
          ) : null}
          {decided && !isDefender && a.looksBeforeTouchRate !== undefined ? (
            <tr>
              <th>Chance model (3 balanced outcomes)</th>
              <td>guessing reaches {correct}/{decided} or better in {chancePct(chanceTail(correct, decided, 3))}% of blocks — a group-level clue, never proof for one rep</td>
            </tr>
          ) : null}
          {a.changeOfMind ? (
            <tr>
              <th>Adapted when the defender changed (recovered)</th>
              <td>
                {a.changeOfMind.correct}/{a.changeOfMind.of}
              </td>
            </tr>
          ) : null}
          {a.medianTimeToExitMs !== undefined ? (
            <tr>
              <th>Time to the right exit after the defender moved (median)</th>
              <td>
                {Math.round(a.medianTimeToExitMs)} ms ± {a.timingUncertaintyMs ?? '?'} ms
              </td>
            </tr>
          ) : null}
          <tr>
            <th>Unable to assess</th>
            <td>
              {unable} of {a.reps} reps {a.poseUsed ? '' : '· pose off (zones and motion only)'}
            </td>
          </tr>
        </tbody>
      </table>
      {tk ? <p>{tk}</p> : null}
      {advanced ? (
        <table className="data">
          <tbody>
            {isDefender
              ? Object.entries(a.correctByDefenderAction!).map(([k, v]) => (
                  <tr key={k}>
                    <th>Defender {REACTION_LABEL[k] ?? k}</th>
                    <td>
                      {v.correct}/{v.of}
                    </td>
                  </tr>
                ))
              : null}
            {a.technique ? (
              <tr>
                <th>Feint technique (observedExecution / estimatedTechnique / unableToAssess)</th>
                <td>
                  {a.technique.observedExecution} / {a.technique.estimatedTechnique} / {a.technique.unableToAssess}
                </td>
              </tr>
            ) : null}
            {a.possibleEarlyRouteCommitments !== undefined ? (
              <tr>
                <th>Possible early route commitment (with timing evidence; an initial fake is not counted)</th>
                <td>{a.possibleEarlyRouteCommitments}</td>
              </tr>
            ) : null}
            {a.medianDeceptionRatio !== undefined ? (
              <tr>
                <th>Fake ÷ exit hip shift (estimate, exploratory)</th>
                <td>{a.medianDeceptionRatio.toFixed(2)}</td>
              </tr>
            ) : null}
            {a.preCommitRate !== undefined ? (
              <tr>
                <th>Old pre-commit rate (&lt; 200 ms rule, retired)</th>
                <td>{pct(a.preCommitRate)}</td>
              </tr>
            ) : null}
            {a.ranIntoDefenderRate !== undefined ? (
              <tr>
                <th>Ran into the defender (BLOCKED on the shaping side)</th>
                <td>{pct(a.ranIntoDefenderRate)}</td>
              </tr>
            ) : null}
            {a.waitedRate !== undefined ? (
              <tr>
                <th>Waited for permission (no-cue reps)</th>
                <td>{pct(a.waitedRate)}</td>
              </tr>
            ) : null}
            {a.reactivitySlope !== undefined ? (
              <tr>
                <th>Reactivity slope (exploratory; near 1 = exits track the cue)</th>
                <td>
                  {a.reactivitySlope.toFixed(2)} (band {a.reactivityBand?.map((x) => x.toFixed(2)).join(' to ')})
                </td>
              </tr>
            ) : null}
            {a.exitTimeReactiveVsSimple !== undefined ? (
              <tr>
                <th>Time to exit on reactive reps ÷ simple reps (same block)</th>
                <td>{a.exitTimeReactiveVsSimple.toFixed(2)}</td>
              </tr>
            ) : null}
            {a.headUpRate !== undefined ? (
              <tr>
                <th>Head up at exit</th>
                <td>{pct(a.headUpRate)}</td>
              </tr>
            ) : null}
            {a.looksBeforeTouchRate !== undefined ? (
              <tr>
                <th>Head turned before the touch (orientation proxy, not proof of seeing)</th>
                <td>
                  {pct(a.looksBeforeTouchRate)}
                  {a.medianLastLookToTouchMs !== undefined ? ` · last look → touch ${Math.round(a.medianLastLookToTouchMs)} ms (median)` : ''}
                </td>
              </tr>
            ) : null}
            {!isDefender && byCue.length ? (
              <tr>
                <th>By cue</th>
                <td>{byCue.map(([k, v]) => `${k} ${v.correct}/${v.of}`).join(' · ')}</td>
              </tr>
            ) : null}
            {a.ball ? (
              <tr>
                <th>Ball tracking ({a.ball.status}; {a.ball.detector ?? 'colour'}; experimental until validated)</th>
                <td>
                  seen in {Math.round(a.ball.seenShare * 100)}% of frames · {a.ball.gateEvents.length} gate crossings · touches {a.ball.touches.confirmed} confirmed, {a.ball.touches.possible} possible
                </td>
              </tr>
            ) : null}
            <tr>
              <th>Analysed at</th>
              <td>{a.analysedFps} fps</td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {advanced ? (
        <table className="data">
          <thead>
            <tr>
              <th>Rep</th>
              <th>Cue / defender</th>
              <th>Exit</th>
              <th>Right?</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.repIndex}>
                <td>{r.repIndex + 1}</td>
                <td>{r.defenderReaction ? REACTION_LABEL[r.defenderReaction] ?? r.defenderReaction : r.cueValue ?? '—'}</td>
                <td>{r.exitDir ?? '—'}</td>
                <td>{r.decisionCorrect === undefined ? 'not judged' : r.decisionCorrect ? 'yes' : 'no'}</td>
                <td>
                  {r.status === 'unableToAssess' ? 'unableToAssess' : r.techniqueStatus ?? 'estimate'}
                  {r.possibleEarlyRouteCommitment ? ` · ${r.possibleEarlyRouteCommitment}` : ''}
                  {r.flags.length ? ` · ${r.flags.join(', ')}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/** Scorecard for a block of the current session, once its analysis is saved (it usually arrives during the next block). */
export function LiveScorecard({ sessionRecordId, blockIndex, attempt }: { sessionRecordId: string; blockIndex: number; attempt: number }) {
  const data = useLiveQuery(async () => {
    const clip = await db.clips.where('sessionRecordId').equals(sessionRecordId).filter((c) => c.blockIndex === blockIndex && c.attempt === attempt).first();
    if (!clip) return { clip: false as const };
    const a = await db.blockAnalyses.get(clip.id);
    const reps = a ? (await db.repAnalyses.where('clipId').equals(clip.id).sortBy('repIndex')).map((r) => r.data) : [];
    return { clip: true as const, a: a?.data, reps };
  }, [sessionRecordId, blockIndex, attempt]);
  if (!data?.clip) return null;
  if (!data.a) return <p className="then">Recorded. The camera scorecard appears when the analysis finishes.</p>;
  return (
    <div className="then">
      <RepStrip reps={data.reps} />
    </div>
  );
}
