import type { ReactNode } from 'react';
import type { IconComponent, IconProps } from './maskIcons';

/** Technical symbols on the shared 24px drafting grid, readable at 18px. */
function icon(name: string, drawing: ReactNode): IconComponent {
  const Icon = ({ size = 24, strokeWidth = 1.6, className }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`armature-icon armature-icon-${name} ${className ?? ''}`}
    >
      {drawing}
    </svg>
  );
  Icon.displayName = `ArmatureIcon(${name})`;
  return Icon;
}
const stirrup = <path d="M8 7l-3-3v15h14V4H8l4 4" />;
const bar = <path d="M3 18l5-12h9l4 7" />;
const table = (
  <>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M3 9h18M3 15h18M10 3v18" />
  </>
);
export const FreeBarIcon = icon('bar', bar);
export const StirrupIcon = icon('stirrup', stirrup);
export const StirrupCriteriaIcon = icon(
  'stirrup-criteria',
  <>
    {stirrup}
    <path d="M15 11v10m-3-6h6" />
    <circle cx="15" cy="15" r="2" fill="var(--ribbon-icon-background,white)" />
  </>,
);
export const RepeatStirrupIcon = icon(
  'repeat',
  <>
    <path d="M3 8V4h11v11h-4M7 12V8h11v11h-4M11 16v-4h11v11H11v-7l3 3" />
  </>,
);
export const BeamClampIcon = icon(
  'beam-clamp',
  <path d="M3 4v14h18V4M3 4l3 3m15-3-3 3" />,
);
export const BeamClampCriteriaIcon = icon(
  'beam-clamp-criteria',
  <>
    <path d="M3 4v14h12M15 4v5M3 4l3 3" />
    <path d="M18 11v10m-5-5h10" />
    <circle cx="18" cy="16" r="2" />
  </>,
);
// Malha de fios soldados, com as pontas sobrando além dos cruzamentos.
const mesh = <path d="M2 4h13M2 9h13M2 14h13M4 2v14M9 2v14M14 2v14" />;
export const WeldedMeshIcon = icon(
  'welded-mesh',
  <>
    {mesh}
    <path d="M19 14v8m-4-4h8" />
  </>,
);
export const WeldedMeshCriteriaIcon = icon(
  'welded-mesh-criteria',
  <>
    {mesh}
    <path d="M19 12v10m-5-5h10" />
    <circle cx="19" cy="17" r="2" fill="var(--ribbon-icon-background,white)" />
  </>,
);
export const RepresentationIcon = icon(
  'representation',
  <>
    <path d="M3 4h7v6M3 20h13v-6M13 5l7 7-7 7" />
    <path d="M3 12h7" strokeDasharray="2 2" />
  </>,
);
export const ConvertBarIcon = icon(
  'convert',
  <>
    <path d="M3 8l4-5h8" strokeDasharray="2 2" />
    <path d="M3 21l5-8h13M15 4l5 4-5 4" />
  </>,
);
export const FollowFormIcon = icon(
  'follow',
  <>
    <path d="M3 21V3h18" strokeDasharray="3 2" />
    <path d="M7 20V7h12M16 4l4 3-4 3" />
  </>,
);
export const InterpretBarIcon = icon(
  'interpret',
  <>
    <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5" />
    <path d="M6 16l4-8h7l2 4" />
  </>,
);
export const LengthAngleIcon = icon(
  'length-angle',
  <>
    <path d="M3 18h17L11 4M3 21v-6m17 6v-6M11 15a6 6 0 0 0 4-5" />
  </>,
);
export const LengthenBarIcon = icon(
  'lengthen',
  <>
    <path d="M3 19l6-12h6M15 7h7m-4-4 4 4-4 4" />
    <path d="M14 3v8" strokeDasharray="2 2" />
  </>,
);
export const JoinBarIcon = icon(
  'join',
  <>
    <path d="M2 8h13l4 5M5 16h17M9 5v14m6-14v14" />
  </>,
);
export const SplitBarIcon = icon(
  'split',
  <>
    <path d="M2 12h7m6 0h7M13 3l-3 6 4 6-3 6" />
  </>,
);
export const RangeBarIcon = icon(
  'range',
  <>
    <path d="M3 12h18M5 5v14m5-14v14m5-14v14m5-14v14" />
  </>,
);
export const ScheduleIcon = icon('schedule', table);
export const RefreshScheduleIcon = icon(
  'refresh',
  <>
    <path d="M3 12V3h17v6M3 7h17M8 3v9M10 18a5 5 0 0 0 9 2m2-5a5 5 0 0 0-9-2M10 14v4h4m7 1v-4h-4" />
  </>,
);
export const LockScheduleIcon = icon(
  'lock',
  <>
    <path d="M3 19V3h17v6M3 8h17M8 3v16" />
    <rect x="12" y="14" width="10" height="8" rx="1" />
    <path d="M14 14v-3a3 3 0 0 1 6 0v3" />
  </>,
);
export const UnlockScheduleIcon = icon(
  'unlock',
  <>
    <path d="M3 19V3h17v6M3 8h17M8 3v16" />
    <rect x="12" y="14" width="10" height="8" rx="1" />
    <path d="M14 14v-3a3 3 0 0 1 6 0" />
  </>,
);
export const InsertScheduleIcon = icon(
  'insert',
  <>
    <path d="M13 21H3V3h17v9M3 8h17M8 3v18M3 14h9M18 14v8m-4-4h8" />
  </>,
);
export const RenumberIcon = icon(
  'renumber',
  <>
    <path d="M3 4h3v5M3 9h6M3 14h5v3H3v4h5M12 6h9m-9 6h9m-9 6h9" />
  </>,
);
