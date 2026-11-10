import type { ComponentType, ReactNode } from 'react';

/**
 * Small drafting icons for the Máscaras tab (AS issue #119).
 *
 * Drawn on the same 24 × 24 grid, stroke and caps as the vector icons already
 * used by the ribbon, so they sit next to them without a visual seam. Each
 * command gets its own symbol: the compact ribbon no longer shows a caption,
 * so two commands must never share a drawing.
 */
export type IconProps = {
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
};
export type IconComponent = ComponentType<IconProps>;

function icon(name: string, body: ReactNode): IconComponent {
  const Icon = ({ size = 24, strokeWidth = 2, className }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['mask-icon', `mask-icon-${name}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
  Icon.displayName = `MaskIcon(${name})`;
  return Icon;
}

const dash = { strokeDasharray: '2.5 2.5' } as const;

/** Copiar propriedades: attributes travel from a source to a target. */
export const MatchPropertiesIcon = icon(
  'match-properties',
  <>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <path d="M5.5 8.5l3-3" />
    <rect x="13" y="13" width="8" height="8" rx="1" {...dash} />
    <path d="M13 7h4a2 2 0 0 1 2 2v1.5" />
    <path d="M17 9l2 2 2-2" />
  </>,
);

/** Ajustar escala: a reference square resized along its diagonal. */
export const ScaleIcon = icon(
  'scale',
  <>
    <rect x="3" y="12" width="9" height="9" rx="1" />
    <path d="M3 8V4a1 1 0 0 1 1-1h4" {...dash} />
    <path d="M21 16v4a1 1 0 0 1-1 1h-4" {...dash} />
    <path d="M12 12l8-8" />
    <path d="M15 4h5v5" />
  </>,
);

/** Offset: an existing line and its parallel copy at a set distance. */
export const OffsetIcon = icon(
  'offset',
  <>
    <path d="M3 5h18" />
    <path d="M3 19h18" {...dash} />
    <path d="M12 8v8" />
    <path d="M10 10l2-2 2 2" />
    <path d="M10 14l2 2 2-2" />
  </>,
);

/** Ajustar (trim): the part beyond the limit is removed. */
export const TrimIcon = icon(
  'trim',
  <>
    <path d="M14 3v18" />
    <path d="M3 12h11" />
    <path d="M14 12h7" {...dash} />
    <path d="M16.5 6.5l3 3" />
    <path d="M19.5 6.5l-3 3" />
  </>,
);

/** Estender (extend): the segment is prolonged up to the limit. */
export const ExtendIcon = icon(
  'extend',
  <>
    <path d="M20 3v18" />
    <path d="M3 12h7" />
    <path d="M10 12h7" {...dash} />
    <path d="M14.5 9l3 3-3 3" />
  </>,
);

/** Medir distância: query between two picked points. */
export const MeasureDistanceIcon = icon(
  'measure-distance',
  <>
    <path d="M3 18h4" />
    <path d="M5 16v4" />
    <path d="M17 6h4" />
    <path d="M19 4v4" />
    <path d="M7.5 15.5l9-7" {...dash} />
  </>,
);

/** Medir contorno: perimeter traced around a closed outline. */
export const MeasureContourIcon = icon(
  'measure-contour',
  <>
    <path d="M4 8l6-4 10 3-2 11-11 2z" strokeDasharray="3 2.2" />
    <circle cx="4" cy="8" r="1.6" fill="currentColor" />
    <path d="M13 3.5l2.8 1.3-1.6 2.6" />
  </>,
);

/** Cota ortogonal: horizontal/vertical dimension with extension lines. */
export const DimensionOrthogonalIcon = icon(
  'dimension-orthogonal',
  <>
    <path d="M4 21V8" />
    <path d="M20 21V8" />
    <path d="M4 12h16" />
    <path d="M7 9l-3 3 3 3" />
    <path d="M17 9l3 3-3 3" />
    <path d="M7 20h10" strokeWidth={1} />
  </>,
);

/** Cota alinhada: dimension that follows an inclined segment. */
export const DimensionAlignedIcon = icon(
  'dimension-aligned',
  <>
    <path d="M9 21L21 9" strokeWidth={1} />
    <path d="M9 21l-4-4" />
    <path d="M21 9l-4-4" />
    <path d="M5 17L17 5" />
    <path d="M8 17H5v-3" />
    <path d="M14 5h3v3" />
  </>,
);

/** Linha: a segment between two endpoints. */
export const LineIcon = icon(
  'line',
  <>
    <path d="M6.5 17.5l11-11" />
    <rect x="3" y="17" width="4" height="4" rx="0.5" />
    <rect x="17" y="3" width="4" height="4" rx="0.5" />
  </>,
);

/** Retângulo: closed four-sided outline from opposite corners. */
export const RectangleIcon = icon(
  'rectangle',
  <>
    <rect x="3" y="6" width="18" height="12" rx="0.5" />
    <circle cx="3" cy="18" r="1.3" fill="currentColor" />
    <circle cx="21" cy="6" r="1.3" fill="currentColor" />
  </>,
);

/** Círculo: centre and radius. */
export const CircleIcon = icon(
  'circle',
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <path d="M12 12h9" {...dash} />
  </>,
);

/** Polilinha: connected segments with visible vertices. */
export const PolylineIcon = icon(
  'polyline',
  <>
    <path d="M3 19l5-9 5 5 8-11" />
    <circle cx="8" cy="10" r="1.4" fill="currentColor" />
    <circle cx="13" cy="15" r="1.4" fill="currentColor" />
  </>,
);

/** Nova máscara: an empty drawing sheet being added. */
export const NewMaskIcon = icon(
  'new-mask',
  <>
    <path d="M12 3L3 7.5 12 12l9-4.5z" />
    <path d="M3 12l9 4.5 3-1.5" />
    <path d="M19 14v6" />
    <path d="M16 17h6" />
  </>,
);

/** Importar: files brought into the project. */
export const ImportMasksIcon = icon(
  'import-masks',
  <>
    <path d="M12 3v11" />
    <path d="M8 10l4 4 4-4" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </>,
);

/** Associar: masks linked to a project context. */
export const AssociateMasksIcon = icon(
  'associate-masks',
  <>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </>,
);
