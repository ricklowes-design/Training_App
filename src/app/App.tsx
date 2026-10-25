import { flushQueue } from './notify';
import { useEffect, useState } from 'react';
import { loadProgrammeFile, type ContentLoad } from '../content/load';
import { db } from '../db/db';
import { BaselineQuestions } from '../screens/BaselineQuestions';
import { Builder } from '../screens/Builder';
import { DrillView } from '../screens/DrillView';
import { Home } from '../screens/Home';
import { Parent } from '../screens/parent/Parent';
import { Progress } from '../screens/Progress';
import { Runner } from '../runner/Runner';
import { Setup } from '../screens/Setup';
import { StartScreen } from '../screens/StartScreen';
import { Summary } from '../screens/Summary';
import { DataProvider, ensureSettings, useData } from './data';
import { checkCapabilities } from './capabilities';
import { pruneClips } from '../camera/clips';
import { NavCtx, type Route } from './nav';

function Loading() {
  return (
    <div className="page">
      <p className="muted">Loading…</p>
    </div>
  );
}

export function ContentError({ errors }: { errors: string[] }) {
  return (
    <div className="page">
      <h1>The programme content has a problem</h1>
      <p>The app could not use <code>content/programme.json</code>. Fix the file and reload. Nothing saved on this device has been changed.</p>
      <div className="error-box">
        <ul>
          {errors.slice(0, 30).map((e, i) => (
            <li key={i} className="mono">
              {e}
            </li>
          ))}
        </ul>
        {errors.length > 30 ? <p>…and {errors.length - 30} more.</p> : null}
      </div>
    </div>
  );
}

function Router() {
  const data = useData();
  const [route, setRoute] = useState<Route>(data.settings.firstRunDone ? { name: 'home' } : { name: 'setup' });
  const [parentUnlocked, setParentUnlocked] = useState(false);
  const [nonce, setNonce] = useState(0);
  const go = (r: Route) => {
    setNonce((n) => n + 1);
    setRoute(r);
    window.scrollTo(0, 0);
  };
  let screen;
  switch (route.name) {
    case 'home':
      screen = <Home />;
      break;
    case 'setup':
      screen = <Setup />;
      break;
    case 'start':
      screen = <StartScreen plan={route.plan} />;
      break;
    case 'run':
      screen = <Runner plan={route.plan} trial={route.trial} key={nonce} />;
      break;
    case 'summary':
      screen = <Summary runId={route.runId} />;
      break;
    case 'progress':
      screen = <Progress tab={route.tab} />;
      break;
    case 'drill':
      screen = <DrillView drillKey={route.key} />;
      break;
    case 'builder':
      screen = <Builder />;
      break;
    case 'baselineQuestions':
      screen = <BaselineQuestions recordId={route.recordId} />;
      break;
    case 'parent':
      screen = <Parent section={route.section} arg={route.arg} />;
      break;
  }
  return <NavCtx.Provider value={{ route, go, parentUnlocked, setParentUnlocked }}>{screen}</NavCtx.Provider>;
}

export function App() {
  const [content, setContent] = useState<ContentLoad | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadProgrammeFile().then(setContent);
    ensureSettings()
      .then(async () => {
        const st = await db.settings.get('main');
        await pruneClips(st?.camera.retentionDays ?? 30).catch(() => 0);
        // Completion messages that could not be sent last time (offline) go now.
        void flushQueue().catch(() => undefined);
        // WebGL capability check (task 0.1); the measured 3D frame rate is kept from the defender test.
        const cap = checkCapabilities();
        await db.settings.update('main', { capabilities: { ...st?.capabilities, ...cap } });
        // Ask Chrome to keep this site's data (plan/08 §8.2).
        if (navigator.storage?.persist) {
          const granted = await navigator.storage.persist().catch(() => false);
          await db.settings.update('main', { persistGranted: granted });
        }
      })
      .finally(() => setReady(true));
  }, []);

  if (!content || !ready) return <Loading />;
  if (!content.ok) return <ContentError errors={content.errors} />;
  return (
    <DataProvider base={content.programme} loading={<Loading />}>
      <Router />
    </DataProvider>
  );
}
