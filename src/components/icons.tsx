/** Иконки в духе SF Symbols: одна толщина 1.7, скруглённые концы, оптический размер 20. */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const box = (p: React.SVGProps<SVGSVGElement>) => ({ width: 20, height: 20, viewBox: '0 0 20 20', ...p })

export const IRegion = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" />
  </g></svg>
)
export const IScreen = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <rect x="2.5" y="4" width="15" height="10.5" rx="2" /><path d="M7 17h6" />
  </g></svg>
)
export const ICopy = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <rect x="7" y="7" width="10" height="10" rx="2.2" /><path d="M13 4.6A1.6 1.6 0 0 0 11.4 3H4.6A1.6 1.6 0 0 0 3 4.6v6.8A1.6 1.6 0 0 0 4.6 13" />
  </g></svg>
)
export const ISave = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <path d="M10 3v9.5M6.5 9.5 10 13l3.5-3.5M3.5 15.5h13" />
  </g></svg>
)
export const IChat = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <rect x="7.6" y="2.6" width="4.8" height="9" rx="2.4" /><path d="M4.6 9.4a5.4 5.4 0 0 0 10.8 0M10 14.8V17.4" />
  </g></svg>
)
export const IMixer = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <path d="M5 3v4.2M5 11.8V17M10 3v8.4M10 15.6V17M15 3v1.4M15 8.6V17" />
    <circle cx="5" cy="9.5" r="2" /><circle cx="10" cy="13.5" r="2" /><circle cx="15" cy="6.5" r="2" />
  </g></svg>
)
export const IPlay = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><path d="M6.5 4.4a.9.9 0 0 1 1.37-.77l8 5.1a.9.9 0 0 1 0 1.53l-8 5.1A.9.9 0 0 1 6.5 14.6z" fill="currentColor" /></svg>
)
export const IPause = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g fill="currentColor"><rect x="5.6" y="4" width="3.2" height="12" rx="1.3" /><rect x="11.2" y="4" width="3.2" height="12" rx="1.3" /></g></svg>
)
export const INext = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g fill="currentColor"><path d="M4 5.2a.8.8 0 0 1 1.22-.68l7 4.8a.8.8 0 0 1 0 1.36l-7 4.8A.8.8 0 0 1 4 14.8z" /><rect x="14" y="4.4" width="2.4" height="11.2" rx="1.2" /></g></svg>
)
export const IPrev = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g fill="currentColor"><path d="M16 5.2a.8.8 0 0 0-1.22-.68l-7 4.8a.8.8 0 0 0 0 1.36l7 4.8A.8.8 0 0 0 16 14.8z" /><rect x="3.6" y="4.4" width="2.4" height="11.2" rx="1.2" /></g></svg>
)
export const IVolume = (p: React.SVGProps<SVGSVGElement> & { level?: number }) => (
  <svg {...box(p)}><g {...S}>
    <path d="M4 7.6h2.4L10 4.4v11.2L6.4 12.4H4z" fill="currentColor" stroke="none" />
    {(p.level ?? 1) > 0.02 && <path d="M12.6 7.6a3.4 3.4 0 0 1 0 4.8" />}
    {(p.level ?? 1) > 0.5 && <path d="M14.8 5.4a6.5 6.5 0 0 1 0 9.2" />}
  </g></svg>
)
export const IMuted = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}>
    <path d="M4 7.6h2.4L10 4.4v11.2L6.4 12.4H4z" fill="currentColor" stroke="none" />
    <path d="M13 8l4 4M17 8l-4 4" />
  </g></svg>
)
export const IClose = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...box(p)}><g {...S}><path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" /></g></svg>
)
export const IGrip = (p: React.SVGProps<SVGSVGElement>) => (
  <svg width="4" height="36" viewBox="0 0 4 36" {...p}><rect width="4" height="36" rx="2" fill="currentColor" /></svg>
)
