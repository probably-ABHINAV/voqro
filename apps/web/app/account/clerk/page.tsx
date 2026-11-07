import {redirect} from 'next/navigation';
import Link from 'next/link';
import {clerkEnabled} from '@/lib/clerk-config';

export default function ClerkAccountPage() {
  if (!clerkEnabled) return <main id="main-content" className="auth-form-wrap"><section className="auth-form"><h1>Use your existing sign-in.</h1><p>Clerk has not been activated for this workspace.</p><Link className="btn btn-primary" href="/login">Sign in to Voqro</Link></section></main>;
  redirect('/login');
}
