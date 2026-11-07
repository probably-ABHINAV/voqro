import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {clerkEnabled} from '@/lib/clerk-config';
import {AuthForm} from '@/components/auth-form';
export const metadata:Metadata={title:'Accept invitation',robots:{index:false,follow:false}};
export default function Page(){if(clerkEnabled)redirect('/login?mode=signup');return <AuthForm mode="register"/>;}
