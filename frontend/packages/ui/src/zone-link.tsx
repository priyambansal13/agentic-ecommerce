import type { AnchorHTMLAttributes } from 'react';

/**
 * Link to ANOTHER zone (/, /shop, /account, /seller, /admin). Must be a hard navigation (plain <a>):
 * each zone is a separate Next.js app, so next/link's client-side routing can't cross zones.
 * Inside a zone, use next/link as usual.
 */
export function ZoneLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
