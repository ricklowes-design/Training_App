import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary, ErrorScreen } from './ErrorBoundary';

describe('error screen (audit 2026-10-29, task 9)', () => {
  it('a caught render error shows "Something went wrong", Reload and a backup button', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    const b = new ErrorBoundary({ children: null });
    b.state = state;
    const html = renderToString(b.render() as React.ReactElement);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('boom');
    expect(html).toContain('Reload');
    expect(html).toContain('Download a backup');
  });

  it('the start-up variant explains storage', () => {
    const html = renderToString(createElement(ErrorScreen, { message: 'VersionError', lead: "The app's storage could not be opened." }));
    expect(html).toContain('storage could not be opened');
  });
});
