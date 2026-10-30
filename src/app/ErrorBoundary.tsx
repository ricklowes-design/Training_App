import { Component, type ReactNode } from 'react';
import { db } from '../db/db';
import { backupFileName, exportBackup } from '../db/backup';
import { downloadText } from '../ui/widgets';
import { APP_VERSION, logHistory } from './data';

// Audit 2026-10-29, task 9: no failure leaves a blank page or an endless "Loading…".

/** The screen shown when something went wrong: saved sessions are safe, with Reload and a backup download. */
export function ErrorScreen({ message, lead }: { message: string; lead?: string }) {
  return (
    <div className="page stack" data-testid="error-screen">
      <h1>Something went wrong</h1>
      <p>{lead ?? 'Saved sessions are still on this Chromebook.'}</p>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
        {message}
      </pre>
      <div className="row">
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
        <button className="btn" onClick={() => void exportBackup(db, APP_VERSION).then((b) => downloadText(backupFileName(), JSON.stringify(b, null, 1))).catch(() => undefined)}>
          Download a backup
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    void logHistory('app', 'error', error.message).catch(() => undefined);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorScreen message={error.message} />;
  }
}
