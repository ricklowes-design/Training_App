import { useState } from 'react';
import { useData } from '../../app/data';
import { useNav } from '../../app/nav';
import { hashPin, validPin } from '../../app/pin';
import { db } from '../../db/db';

/** The parent PIN. Its own file so the app shell can ask for it without loading all of parent mode. */
export function PinGate({ onOk }: { onOk: () => void }) {
  const { settings } = useData();
  const { go } = useNav();
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const setting = !settings.pinHash;
  async function submit() {
    if (!validPin(pin)) return setMsg('Four digits.');
    if (setting) {
      await db.settings.update('main', { pinHash: await hashPin(pin) });
      onOk();
    } else if ((await hashPin(pin)) === settings.pinHash) onOk();
    else {
      setMsg('Wrong PIN.');
      setPin('');
    }
  }
  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <h1>Parent mode</h1>
      <div className="card stack">
        <label className="field">
          <span>{setting ? 'Choose a 4-digit PIN' : 'PIN'}</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {msg ? <p className="muted">{msg}</p> : null}
        <div className="row spread">
          <button className="btn" onClick={() => go({ name: 'home' })}>
            Back
          </button>
          <button className="btn primary" onClick={submit}>
            {setting ? 'Set PIN' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
}
