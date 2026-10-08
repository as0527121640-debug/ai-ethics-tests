import type { ReactNode } from 'react';

function Icon({ size = 16, children, fill = 'none' }: { size?: number; children: ReactNode; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Globe = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
    <path d="M3 12h18M5 7h14M5 17h14" />
  </svg>
);
export const Close = () => <Icon size={18}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const Search = () => <Icon><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
export const Warn = () => <Icon size={14}><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.5" /></Icon>;
export const Info = () => <Icon size={16}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></Icon>;
export const ArrowLeft = () => <Icon size={18}><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>;
export const Shuffle = () => <Icon><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></Icon>;
export const Chevron = ({ open }: { open: boolean }) => (
  <span style={{ display: 'inline-flex', transform: open ? 'rotate(-90deg)' : 'none' }}>
    <Icon size={14}><path d="M15 6l-6 6 6 6" /></Icon>
  </span>
);
export const Pause = () => <Icon fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Icon>;
export const Play = () => <Icon fill="currentColor"><path d="M18 5v14L7 12z" /></Icon>;
export const Key = () => <Icon><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></Icon>;
export const Download = () => <Icon><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const Trash = () => <Icon><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Icon>;
