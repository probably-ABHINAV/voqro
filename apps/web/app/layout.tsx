import type {Metadata} from 'next';
import {ClerkProvider} from '@clerk/nextjs';
import {clerkEnabled, disconnectedPreview} from '@/lib/clerk-config';
import './globals.css';
export const metadata:Metadata={title:{default:'Voqro · Good work, together',template:'%s · Voqro'},description:'A considered home for creator partnerships, campaigns and the people who make them happen.'};
export default function RootLayout({children}:{children:React.ReactNode}){
 if(disconnectedPreview)return <html lang="en"><body><main id="main-content" style={{maxWidth:640,margin:'15vh auto',padding:24}}><p>VOQRO · Branch preview</p><h1>This preview is not connected</h1><p>This build has no test backend. Sign-in and saved work are available on the live website.</p><a href="https://voqro.vercel.app">Open Voqro</a></main></body></html>;
 if(clerkEnabled&&(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY))throw new Error('Clerk is enabled but its application keys are missing.');
 const content=<><a className="skip-link" href="#main-content">Skip to content</a>{children}</>;
 return <html lang="en" data-scroll-behavior="smooth"><body>{clerkEnabled?<ClerkProvider signInUrl="/login" signUpUrl="/login?mode=signup" afterSignOutUrl="/login">{content}</ClerkProvider>:content}</body></html>;
}
