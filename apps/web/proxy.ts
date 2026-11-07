import {clerkMiddleware} from '@clerk/nextjs/server';
import {NextResponse} from 'next/server';
import {clerkEnabled} from './lib/clerk-config';

const authenticate = clerkEnabled ? clerkMiddleware() : null;
export default authenticate ?? (() => NextResponse.next());

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/api/(.*)'],
};
