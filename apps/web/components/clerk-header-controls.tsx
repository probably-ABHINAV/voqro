'use client';

import {UserButton, useAuth, useClerk} from '@clerk/nextjs';
import {useState} from 'react';
import {api} from '@/lib/api';
import {clerkEnabled} from '@/lib/clerk-config';
import {WorkspaceSwitcher} from './workspace-switcher';
import {Button} from './ui';

export function ClerkHeaderControls({organizationsEnabled}:{organizationsEnabled?:boolean}) {
  return clerkEnabled ? <ActiveClerkControls organizationsEnabled={organizationsEnabled}/> : null;
}

function ActiveClerkControls({organizationsEnabled}:{organizationsEnabled?:boolean}) {
  const {isLoaded, isSignedIn} = useAuth();
  const {signOut} = useClerk();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!isLoaded || !isSignedIn) return null;

  async function logout() {
    setBusy(true); setError('');
    try {
      // End the local session when available. Clerk sign-out must still run if
      // that session already expired or the app backend cannot be reached.
      try { await api('logout', {}); } catch { /* Provider revocation denies subsequent backend access. */ }
      await signOut({redirectUrl: '/login'});
    } catch { setError('Log out could not finish. Please try again.'); setBusy(false); }
  }

  return <div className="flex items-center gap-3 flex-wrap" role="group" aria-label="Account controls">
    {organizationsEnabled&&<WorkspaceSwitcher/>}
    <UserButton userProfileMode="modal"/>
    <Button onClick={() => void logout()} disabled={busy}>{busy ? 'Logging out…' : 'Log out'}</Button>
    {error && <span role="alert" className="text-sm">{error}</span>}
  </div>;
}
