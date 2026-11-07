import type {Metadata} from 'next';
import {Suspense} from 'react';
import {ClerkAccount} from '@/components/clerk-account';
import {clerkEnabled} from '@/lib/clerk-config';
import {AuthForm} from '@/components/auth-form';
export const metadata:Metadata={title:'Sign in'};
export default function Page(){return clerkEnabled?<Suspense fallback={<p>Loading sign-in…</p>}><ClerkAccount/></Suspense>:<AuthForm/>;}
