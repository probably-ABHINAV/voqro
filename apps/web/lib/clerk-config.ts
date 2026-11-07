// Explicit opt-in prevents the SDK from creating an accountless application.
export const disconnectedPreview = process.env.NEXT_PUBLIC_DISCONNECTED_PREVIEW === '1';
export const clerkEnabled = !disconnectedPreview && process.env.NEXT_PUBLIC_CLERK_ENABLED === '1';
