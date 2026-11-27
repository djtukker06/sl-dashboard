import type { Platform } from '@/lib/social/types';

// Kleine lijniconen voor social (zelfde stijl als de rest van de shell: 1.6 lijn, currentColor).

export function PlatformIcoon({ platform, grootte = 16, titel }: { platform: Platform; grootte?: number; titel?: string }) {
  const label = titel ?? (platform === 'instagram' ? 'Instagram' : 'Facebook');
  if (platform === 'instagram') {
    return (
      <svg className="so-icoon" width={grootte} height={grootte} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" role="img" aria-label={label}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg className="so-icoon" width={grootte} height={grootte} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" role="img" aria-label={label}>
      <circle cx="12" cy="12" r="9" />
      <path d="M13.2 20.8v-6.9h2.3l.4-2.7h-2.7V9.5c0-.8.3-1.3 1.4-1.3h1.4V5.8c-.3 0-1.1-.1-2-.1-2 0-3.4 1.2-3.4 3.4v2.1H8.3v2.7h2.3v6.9" />
    </svg>
  );
}

export function Icoon({ naam, grootte = 16 }: { naam: 'plus' | 'omhoog' | 'omlaag' | 'links' | 'rechts' | 'kruis' | 'video' | 'beeld' | 'tekst' | 'hart' | 'reactie' | 'bewaar' | 'deel' | 'sleep'; grootte?: number }) {
  const p = { className: 'so-icoon', width: grootte, height: grootte, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (naam) {
    case 'plus':
      return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case 'omhoog':
      return <svg {...p}><path d="m6 15 6-6 6 6" /></svg>;
    case 'omlaag':
      return <svg {...p}><path d="m6 9 6 6 6-6" /></svg>;
    case 'links':
      return <svg {...p}><path d="m15 6-6 6 6 6" /></svg>;
    case 'rechts':
      return <svg {...p}><path d="m9 6 6 6-6 6" /></svg>;
    case 'kruis':
      return <svg {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case 'video':
      return <svg {...p}><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2.5v9L17 14" /></svg>;
    case 'beeld':
      return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></svg>;
    case 'tekst':
      return <svg {...p}><path d="M5 6h14M5 11h14M5 16h9" /></svg>;
    case 'hart':
      return <svg {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>;
    case 'reactie':
      return <svg {...p}><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1-4.2A8 8 0 1 1 20 12Z" /></svg>;
    case 'bewaar':
      return <svg {...p}><path d="M6 4h12v16l-6-4-6 4V4Z" /></svg>;
    case 'deel':
      return <svg {...p}><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" /></svg>;
    case 'sleep':
      return <svg {...p}><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></svg>;
  }
}
