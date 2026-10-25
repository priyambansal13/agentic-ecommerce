import { cartCount, getSession } from '@ac/bff';
import { SiteHeader } from '@ac/ui';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Shop · Agentic Commerce' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const count = session?.realm === 'staff' ? 0 : await cartCount();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SiteHeader current="/shop" user={session && { name: session.name, roles: session.roles }} returnTo="/shop" cartCount={count} />
        {children}
      </body>
    </html>
  );
}
