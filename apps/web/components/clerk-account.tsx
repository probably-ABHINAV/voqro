'use client';

import {SignIn, SignUp, UserButton, useAuth, useClerk} from '@clerk/nextjs';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {api} from '@/lib/api';
import type {IdentityConfig} from '@/lib/types';
import {Button, ErrorNotice, Field, Loading} from './ui';

export function ClerkAccount() {
  const {isLoaded, isSignedIn, getToken} = useAuth();
  const {signOut} = useClerk();
  const query = useSearchParams();
  const signingOut = query.get('signout') === '1';
  const didSignOut = useRef(false);
  const [config, setConfig] = useState<IdentityConfig | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);

  useEffect(() => { api<IdentityConfig>('identity/config').then(setConfig).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!isLoaded || !signingOut || didSignOut.current) return;
    didSignOut.current = true;
    void signOut({redirectUrl: '/login'}).catch(() => { setError('Sign-out could not complete. Please retry.'); didSignOut.current = false; });
  }, [isLoaded, signingOut, signOut]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const currentPassword = new FormData(form).get('current_password');
    setBusy(true); setError('');
    try {
      const token = await getToken();
      if (!token) throw Error('Sign in with Clerk before continuing.');
      const linking = config?.provider === 'Password';
      const response = await fetch(`/api/identity/clerk/${linking ? 'link' : 'exchange'}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000),
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify(linking ? {current_password: currentPassword} : {}),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Error('The workspace service is unavailable. Please retry.');
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Account verification failed.');
      if (linking) setLinked(true);
      else window.location.assign('/workspace');
    } catch (e) { setError((e as Error).message); }
    finally { form.reset(); setBusy(false); }
  }

  return <main id="main-content" className="auth-page"><section className="auth-form-wrap"><div className="auth-form">
    <Link href="/" className="eyebrow">Voqro</Link>
    <h1>{config?.provider === 'Password' ? 'Connect your account.' : 'Welcome back.'}</h1>
    {error && <ErrorNotice message={error}/>}
    {!isLoaded || (!config && !error) || signingOut ? <Loading label="Checking sign-in…"/> : !config?.clerk_available ? <p>Clerk sign-in is not active yet. <Link href="/login" className="underline">Use your existing sign-in</Link>.</p> : !isSignedIn ? <>
      <p className="muted mb-5">{config.provider === 'Password' ? 'Use the same email as your existing Voqro account. You’ll confirm your current Voqro password after signing in.' : 'Your verified email must have an agency membership or an owner-issued invitation.'}</p>
      {query.get('mode') === 'signup' ? <SignUp routing="hash" signInUrl="/account/clerk" forceRedirectUrl="/account/clerk"/> : <SignIn routing="hash" signUpUrl="/account/clerk?mode=signup" forceRedirectUrl="/account/clerk"/>}
    </> : <><UserButton/>{linked ? <><p className="notice">Your Clerk account is linked. Your existing workspace and permissions are preserved. Continue using your Voqro password until the agency activates Clerk sign-in.</p><Link className="btn btn-primary" href="/workspace">Return to workspace</Link></> : <form onSubmit={submit}>
      {config.provider === 'Password' && <><p className="muted my-5">First <Link className="underline" href="/login" target="_blank" rel="noopener">sign in to Voqro</Link> in this browser, then enter your current Voqro password to confirm the connection.</p><Field label="Current Voqro password"><input type="password" name="current_password" required autoComplete="current-password" maxLength={128}/></Field></>}
      <Button type="submit" disabled={busy} className="btn-primary mt-5">{busy ? 'Verifying…' : config.provider === 'Password' ? 'Link my existing account' : 'Open my workspace'}</Button>
    </form>}</>}
    <div className="auth-links"><Link href="/login">Back to sign-in</Link></div>
  </div></section></main>;
}
