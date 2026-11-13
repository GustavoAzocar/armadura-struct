import { memo, useMemo } from 'react';
import { dashArray } from '../domain/layers';
import { svgTextFont } from '../domain/textStyle';
import type { Primitive } from '../domain/types';
import { prepareCadPreview } from '../lib/cadPreview';

/** A translated preview changes its outer group, not these cached SVG children. */
export default memo(function CadPreview({
  lines,
  stroke,
  color = '#c084fc',
  active = false,
}: {
  lines: Primitive[];
  stroke: number;
  color?: string;
  active?: boolean;
}) {
  const items = useMemo(() => prepareCadPreview(lines), [lines]);
  return (
    <>
      {items.map((entry, i) => {
        const item = entry.item;
        return entry.kind === 'text' ? (
          <g
            key={i}
            transform={`translate(${item.points[0].x} ${item.points[0].y}) rotate(${item.textRotation ?? 0}) scale(1 -1)`}
          >
            <text
              fill={color}
              textRendering="geometricPrecision"
              fontSize={item.textHeight ?? 40}
              {...svgTextFont(item)}
              textAnchor={
                item.textAlign === 'right'
                  ? 'end'
                  : item.textAlign === 'center' ||
                      (!item.textAlign &&
                        ['COTAS', 'DISTRIBUICAO'].includes(
                          item.role ?? item.layer,
                        ))
                    ? 'middle'
                    : 'start'
              }
            >
              {item.text!.replace(/%%c/g, 'Ø')}
            </text>
          </g>
        ) : (
          <path
            key={i}
            d={entry.d}
            fill="none"
            stroke={color}
            strokeWidth={
              Math.max(
                active ? 2.4 : 1,
                ((item.resolvedStyle?.lineWidth ?? 0.18) * 96) / 25.4,
              ) * stroke
            }
            strokeDasharray={
              dashArray(item.resolvedStyle).join(' ') || undefined
            }
            data-layer-id={item.layerId}
            strokeLinecap="round"
          />
        );
      })}
    </>
  );
});
