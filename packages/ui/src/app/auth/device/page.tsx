'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

type Phase = 'input' | 'authorizing' | 'success' | 'error';

export default function DeviceAuthPage() {
  const [userCode, setUserCode] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleAuthorize() {
    if (!userCode.trim()) return;
    setPhase('authorizing');
    setErrorMessage(null);

    try {
      // In the full implementation, this would:
      // 1. Verify the user code against Auth0
      // 2. Show consent screen
      // 3. Approve the device code
      // For now we redirect to Auth0's hosted verification page
      const verifyUrl = new URL('/authorize', window.location.origin);
      verifyUrl.searchParams.set('user_code', userCode.trim().toUpperCase());

      // Simulate authorization - in production this would go through Auth0's
      // device verification flow. The hosted Auth0 page handles the actual
      // consent; this page serves as a branded entry point.
      window.location.href = `${process.env.NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL ?? ''}/activate?user_code=${encodeURIComponent(userCode.trim().toUpperCase())}`;
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : 'Authorization failed.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-root)] p-4">
      <Panel className="w-full max-w-md space-y-6 p-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-subtle)]">
            <Terminal className="h-6 w-6 text-[var(--accent-strong)]" />
          </div>
          <h1 className="font-[var(--font-display)] text-xl font-semibold text-[var(--text-primary)]">
            Authorize CLI
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Enter the code shown in your terminal to connect your CLI to 0ctx Cloud.
          </p>
        </div>

        {/* Input phase */}
        {phase === 'input' && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="user-code"
                className="mb-1.5 block text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]"
              >
                Device Code
              </label>
              <input
                id="user-code"
                type="text"
                value={userCode}
                onChange={e => setUserCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-12 w-full rounded-xl border border-[var(--border-muted)] bg-[var(--surface-raised)] px-4 text-center font-mono text-lg tracking-[0.2em] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAuthorize();
                }}
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!userCode.trim()}
              onClick={handleAuthorize}
            >
              Authorize Device
            </Button>
          </div>
        )}

        {/* Authorizing phase */}
        {phase === 'authorizing' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-strong)]" />
            <p className="text-sm text-[var(--text-secondary)]">Redirecting to authorization…</p>
          </div>
        )}

        {/* Success phase */}
        {phase === 'success' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="h-8 w-8 text-[var(--success-fg)]" />
            <p className="text-sm font-medium text-[var(--text-primary)]">Device authorized</p>
            <p className="text-xs text-[var(--text-muted)]">
              You can close this window and return to your terminal.
            </p>
          </div>
        )}

        {/* Error phase */}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <XCircle className="h-8 w-8 text-[var(--danger-fg)]" />
            <p className="text-sm font-medium text-[var(--text-primary)]">Authorization failed</p>
            {errorMessage && (
              <p className="text-xs text-[var(--text-muted)]">{errorMessage}</p>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPhase('input');
                setErrorMessage(null);
                setUserCode('');
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-[var(--text-muted)]">
          This page is used to authorize the 0ctx CLI. If you did not initiate this request from a terminal, you can safely close this window.
        </p>
      </Panel>
    </div>
  );
}
