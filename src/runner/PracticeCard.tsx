import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { logHistory, useData } from '../app/data';
import { currentSetup, familyForBlock } from '../camera/clips';
import type { Programme } from '../content/types';
import type { RepAnalysis } from '../analysis/types';
import { cueDrillFor } from '../cue/resolve';
import type { CueLogEntry } from '../cue/engine';
import { db } from '../db/db';
import type { RunBlock } from '../domain/plans';

// After a "Try it" round: each rep in plain words, from the camera when it saw the rep. Facts only
// (what the screen said, whether she looked, which way she went); nothing is counted or kept as a result.

type Verdict = { word: string; looked?: boolean; right?: boolean; why?: string };

export function practiceVerdicts(log: CueLogEntry[], reps: RepAnalysis[]): Verdict[] {
  return log
    .filter((e) => e.value)
    .map((e) => {
      const r = reps.find((x) => x.repIndex === e.rep);
      return {
        word: e.value!,
        looked: r?.looksBeforeTouch === undefined ? undefined : r.looksBeforeTouch > 0,
        right: r?.status === 'unableToAssess' ? undefined : r?.decisionCorrect,
        why: r?.status === 'unableToAssess' ? 'the camera could not see this rep clearly' : r?.flags.includes('no exit seen') ? 'no move out of the middle was seen' : undefined,
      };
    });
}

export function PracticeCard(props: { p: Programme; block: RunBlock; recordId?: string; blockIndex: number; log: CueLogEntry[]; onAgain: () => void; onInstructions: () => void; onReal: () => void }) {
  const { p, block, recordId, blockIndex, log, onAgain, onInstructions, onReal } = props;
  const cue = cueDrillFor(p, block);
  const { settings, cameraSetups } = useData();
  const cameraOn = settings.camera.enabled;
  const areaSetUp = !!currentSetup(cameraSetups, familyForBlock(p, block));
  const data = useLiveQuery(async () => {
    if (!recordId) return { clip: false as const };
    const clips = await db.clips.where('sessionRecordId').equals(recordId).filter((c) => c.blockIndex === blockIndex && c.attempt === 0).sortBy('date');
    const clip = clips[clips.length - 1];
    if (!clip) return { clip: false as const };
    const a = await db.blockAnalyses.get(clip.id);
    const reps = a ? (await db.repAnalyses.where('clipId').equals(clip.id).sortBy('repIndex')).map((r) => r.data as RepAnalysis) : [];
    return { clip: true as const, blob: clip.blob, done: !!a, reps };
  }, [recordId, blockIndex]);
  const verdicts = practiceVerdicts(log, data?.clip ? data.reps : []);
  const judged = verdicts.filter((v) => v.right !== undefined);
  const mark = (x: boolean | undefined) => (x === undefined ? '–' : x ? '✓' : '✗');
  const [url, setUrl] = useState<string>();
  const blob = data?.clip ? data.blob : undefined;
  useEffect(() => {
    if (!blob?.size) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const checkTogether = 'so check together: for each word, did the first touch go the way the instructions say?';

  async function turnRecordingOn() {
    await db.settings.update('main', { camera: { ...settings.camera, enabled: true } });
    await logHistory('parent', 'camera', 'recording turned on from the Try-it card');
  }

  return (
    <div className="endcard" data-testid="practice-card">
      <div className="title">Try it: how did it go?</div>
      {!cameraOn ? (
        <div className="stack" data-testid="practice-recording-off">
          <p className="then">Recording is off in the app, {checkTogether}</p>
          <p className="muted">The Chromebook's camera permission only lets Chrome use the webcam; the app also has its own switch.</p>
          <div className="actions">
            <button className="btn go" onClick={turnRecordingOn}>
              Turn recording on, then Try again
            </button>
          </div>
        </div>
      ) : !data?.clip ? (
        <p className="then">Nothing was recorded this round (the camera did not start, or is still saving), {checkTogether}</p>
      ) : !areaSetUp ? (
        <p className="then" data-testid="practice-no-area-setup">
          Recorded. The app can only judge each rep after the one-time camera set-up for this drill area (Parent → Camera set-up), {checkTogether} Watch it back below.
        </p>
      ) : !data.done ? (
        <p className="then">Checking the recording…</p>
      ) : (
        <p className="then">
          {judged.length ? `Right way on ${judged.filter((v) => v.right).length} of ${judged.length} the camera could judge.` : 'The camera could not judge these reps; check together.'}
        </p>
      )}
      {url ? <video src={url} controls muted playsInline style={{ maxWidth: '100%', maxHeight: '40vh', borderRadius: 12 }} data-testid="practice-clip" /> : null}
      <table className="data practice-reps">
        <thead>
          <tr>
            <th>Rep</th>
            <th>The screen said</th>
            <th>Looked first</th>
            <th>Right way</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {verdicts.map((v, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <span className="pill info">{v.word}</span>
              </td>
              <td>{data?.clip && data.done && areaSetUp ? mark(v.looked) : '–'}</td>
              <td>{data?.clip && data.done && areaSetUp ? mark(v.right) : '–'}</td>
              <td className="muted">{v.right === false ? (cue?.howTo?.words[v.word] ?? cue?.rule) : v.why ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button className="btn" onClick={onAgain}>
          Try again
        </button>
        <button className="btn" onClick={onInstructions}>
          Back to the instructions
        </button>
        <button className="btn go" onClick={onReal}>
          ▶ Start the real drill
        </button>
      </div>
    </div>
  );
}
