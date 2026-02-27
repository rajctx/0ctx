'use client';

/**
 * /auth/device — Device code entry page for CLI authentication.
 *
 * Flow:
 *   1. CLI opens this page (usually with ?user_code=XXXX-XXXX pre-filled via
 *      verificationUriComplete). User sees their code already filled in.
 *   2. On submit we redirect to Auth0's /activate endpoint with the code.
 *   3. Auth0 handles consent / login. After approval, the device code is
 *      resolved server-side and the CLI's polling loop receives the tokens.
 *
 * useSearchParams must be wrapped in Suspense per Next.js App Router rules.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

type Phase = 'input' | 'authorizing' | 'error';

function DeviceAuthForm() {
  const searchParams = useSearchParams();
  const prefilledCode = (searchParams.get('user_code') ?? '').toUpperCase();

  const [userCode, setUserCode] = useState(prefilledCode);
  const [phase, setPhase] = useState<Phase>('input');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-submit when the code arrives via verificationUriComplete URL param
  useEffect(() => {
    if (prefilledCode) {
      doAuthorize(prefilledCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doAuthorize(code: string) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setPhase('authorizing');
    setErrorMessage(null);

    const auth0Issuer = process.env.NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL;
    if (!auth0Issuer) {
      setPhase('error');
      setErrorMessage('Auth server not configured. Contact support.');
      return;
    }

    // Redirect to Auth0's device activation endpoint.
    // Auth0 shows its own consent UI; after approval it resolves the device
    // code so the CLI polling loop can exchange it for tokens.
    const activateUrl = new URL('/activate', auth0Issuer);
    activateUrl.searchParams.set('user_code', trimmed);
    window.location.href = activateUrl.toString();
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
                autoFocus={!prefilledCode}
                autoComplete="off"
                spellCheck={false}
                className="h-12 w-full rounded-xl border border-[var(--border-muted)] bg-[var(--surface-raised)] px-4 text-center font-mono text-lg tracking-[0.2em] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
                onKeyDown={e => { if (e.key === 'Enter') doAuthorize(userCode); }}
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!userCode.trim()}
              onClick={() => doAuthorize(userCode)}
            >
              Authorize Device
            </Button>
          </div>
        )}

        {/* Authorizing — in-flight redirect */}
        {phase === 'authorizing' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-strong)]" />
            <p className="text-sm text-[var(--text-secondary)]">Redirecting to Auth0…</p>
          </div>
        )}

        {/* Error */}
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
              onClick={() => { setPhase('input'); setErrorMessage(null); setUserCode(''); }}
            >
              Try again
            </Button>
          </div>
        )}

        <p className="text-center text-[10px] text-[var(--text-muted)]">
          Only proceed if you initiated this from your terminal.
          You can safely close this window otherwise.
        </p>
      </Panel>
    </div>
  );
}

export default function DeviceAuthPage() {
  return (
    <Suspense>
      <DeviceAuthForm />
    </Suspense>
  );
}
