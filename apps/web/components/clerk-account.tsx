'use client';

import {SignIn, SignUp, UserButton, UserProfile, useAuth, useClerk} from '@clerk/nextjs';
import {exchangeClerkSession} from '@/lib/clerk-exchange';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {Button, ErrorNotice, Loading} from './ui';

export function ClerkAccount() {
  const {isLoaded, isSignedIn, sessionId, getToken} = useAuth();
  const {signOut} = useClerk();
  const query = useSearchParams();
  const signingOut = query.get('signout') === '1';
  const managing = query.get('manage') === '1';
  const didSignOut = useRef(false);
  const exchange = useRef<{session: string; promise: Promise<void>} | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLoaded || !signingOut || didSignOut.current) return;
    didSignOut.current = true;
    void signOut({redirectUrl: '/login'}).catch(() => {
      setError('Sign-out could not complete. Please try again.');
      didSignOut.current = false;
    });
  }, [isLoaded, signingOut, signOut]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !sessionId || signingOut || managing) return;
    let active = true;
    setError('');
    if (exchange.current?.session !== sessionId) {
      const promise = (async () => {
        const token = await getToken();
        if (!token) throw Error('Your sign-in expired. Please sign in again.');
        await exchangeClerkSession(token);
      })();
      exchange.current = {session: sessionId, promise};
    }
    // Share one exchange across React effect replays. Each mounted subscriber
    // can complete navigation without creating duplicate backend sessions.
    void exchange.current.promise.then(() => {
      if (active) window.location.replace('/workspace');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Your workspace could not be opened.'); });
    return () => { active = false; };
  }, [isLoaded, isSignedIn, sessionId, signingOut, managing, getToken, attempt]);

  function retry() { exchange.current = null; setError(''); setAttempt(value => value + 1); }

  return <main id="main-content" className="min-h-screen flex items-center justify-center p-5"><section className="w-full flex justify-center"><div className={managing ? "w-full max-w-4xl" : "auth-form"}>
    <Link href="/" className="eyebrow">Voqro</Link>
    {error && <ErrorNotice message={error} onRetry={!signingOut && !managing ? retry : undefined}/>}
    {!isLoaded || signingOut ? <Loading label={signingOut ? 'Signing out…' : 'Loading sign-in…'}/> : !isSignedIn ? <>
      {query.get('mode') === 'signup' ? <SignUp appearance={{elements:{rootBox:{width:"100%"},cardBox:{width:"100%"}}}} routing="hash" signInUrl="/login" forceRedirectUrl="/login"/> : <SignIn appearance={{elements:{rootBox:{width:"100%"},cardBox:{width:"100%"}}}} routing="hash" signUpUrl="/login?mode=signup" forceRedirectUrl="/login"/>}
    </> : managing ? <><UserProfile routing="hash"/><Link className="btn mt-5" href="/workspace">Return to workspace</Link></> : error ? <><UserButton/><Button className="mt-5" onClick={() => void signOut({redirectUrl: '/login'})}>Sign out</Button></> : <Loading label="Opening your workspace…"/>}
    <div className="auth-links"><Link href="/">← Agency website</Link></div>
  </div></section></main>;
}
