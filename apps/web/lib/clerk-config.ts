// Explicit opt-in prevents the SDK from creating an accountless application.
export const clerkEnabled = process.env.NEXT_PUBLIC_CLERK_ENABLED === '1';
