import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:{default:'Voqro · Good work, together',template:'%s · Voqro'},description:'A considered home for creator partnerships, campaigns and the people who make them happen.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body></html>;}
