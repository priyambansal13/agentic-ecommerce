import { getSession } from '@ac/bff';
import { SiteHeader } from '@ac/ui';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Admin · Agentic Commerce' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SiteHeader current="/admin" user={session && { name: session.name, roles: session.roles }} returnTo="/admin" />
        {children}
      </body>
    </html>
  );
}
