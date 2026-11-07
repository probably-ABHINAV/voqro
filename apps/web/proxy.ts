import {clerkMiddleware} from '@clerk/nextjs/server';
import {NextResponse} from 'next/server';
import type {NextFetchEvent, NextRequest} from 'next/server';
import {clerkEnabled} from './lib/clerk-config';

const proxyEnabled = process.env.CLERK_FRONTEND_API_PROXY_ENABLED === '1';
const proxyURL = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
const authenticate = clerkEnabled || proxyEnabled ? clerkMiddleware({
  frontendApiProxy: {enabled: proxyEnabled},
  ...(proxyURL ? {authorizedParties: [new URL(proxyURL).origin]} : {}),
}) : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // The provider proxy can be verified on the production hostname before
  // enabling Clerk UI or changing the application's existing login.
  if (!clerkEnabled && !(proxyEnabled && (request.nextUrl.pathname === '/__clerk' || request.nextUrl.pathname.startsWith('/__clerk/')))) return NextResponse.next();
  return authenticate ? authenticate(request, event) : NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/api/(.*)', '/__clerk/(.*)'],
};
