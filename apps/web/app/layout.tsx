import type {Metadata} from 'next';
import {ClerkProvider} from '@clerk/nextjs';
import {clerkEnabled} from '@/lib/clerk-config';
import './globals.css';
export const metadata:Metadata={title:{default:'Voqro · Good work, together',template:'%s · Voqro'},description:'A considered home for creator partnerships, campaigns and the people who make them happen.'};
export default function RootLayout({children}:{children:React.ReactNode}){
 if(clerkEnabled&&(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY))throw new Error('Clerk is enabled but its application keys are missing.');
 const content=<><a className="skip-link" href="#main-content">Skip to content</a>{children}</>;
 return <html lang="en" data-scroll-behavior="smooth"><body>{clerkEnabled?<ClerkProvider signInUrl="/account/clerk" signUpUrl="/account/clerk?mode=signup">{content}</ClerkProvider>:content}</body></html>;
}
