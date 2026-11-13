import { useMemo, useRef, type MouseEvent } from 'react';
import { bounds } from '../domain/geometry';
import type { PaperPrimitive, PaperRect } from '../domain/paper';
import type { Point } from '../domain/types';
import { PaperLines } from './SheetCanvas';

type PreviewProps = {
  size?: { width: number; height: number };
  lines: PaperPrimitive[];
  regions?: {
    box: PaperRect;
    label: string;
    kind: 'useful' | 'seal' | 'field';
  }[];
  points?: Point[];
  onPick?: (point: Point) => void;
  snapToVertex?: boolean;
  label: string;
};

const validBox = (box: PaperRect) =>
  [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
  box.width > 0 &&
  box.height > 0;

export default function SheetTemplatePreview({
  size,
  lines,
  regions = [],
  points = [],
  onPick,
  snapToVertex = false,
  label,
}: PreviewProps) {
  const paper = useRef<SVGGElement>(null);
  const vertices = useMemo(() => lines.flatMap((line) => line.points), [lines]);
  const frame = size && validBox({ x: 0, y: 0, ...size }) ? size : undefined;
  const box = frame ? { x: 0, y: 0, ...frame } : bounds(vertices);
  const padding = Math.max(box.width, box.height, 1) * 0.04;
  const markerSize = Math.max(box.width, box.height, 1) * 0.009;
  const pick = (event: MouseEvent<SVGSVGElement>) => {
    const matrix = paper.current?.getScreenCTM();
    if (!matrix || !onPick) return;
    const selected = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    if (snapToVertex && vertices.length) {
      let nearest = vertices[0];
      let best = Infinity;
      for (const candidate of vertices) {
        const distance = Math.hypot(
          selected.x - candidate.x,
          selected.y - candidate.y,
        );
        if (distance < best) {
          nearest = candidate;
          best = distance;
        }
      }
      onPick(nearest);
    } else if (
      frame &&
      selected.x >= 0 &&
      selected.y >= 0 &&
      selected.x <= frame.width &&
      selected.y <= frame.height
    ) {
      onPick({
        x: Number(selected.x.toFixed(2)),
        y: Number(selected.y.toFixed(2)),
      });
    }
  };
  return (
    <svg
      className={`sheet-template-preview${onPick ? ' picking' : ''}`}
      role="img"
      aria-label={label}
      viewBox={`${box.x - padding} ${-box.y - box.height - padding} ${box.width + 2 * padding} ${box.height + 2 * padding}`}
      onClick={onPick ? pick : undefined}
    >
      <g ref={paper} transform="scale(1 -1)">
        {frame && (
          <rect
            width={frame.width}
            height={frame.height}
            className="sheet-template-paper"
          />
        )}
        <PaperLines lines={lines} />
        {regions
          .filter(({ box }) => validBox(box))
          .map(({ box, label, kind }, i) => (
            <g key={i} className={`sheet-template-region ${kind}`}>
              <rect {...box} vectorEffect="non-scaling-stroke" />
              <text
                x={box.x + markerSize}
                y={-box.y - box.height + markerSize * 3}
                transform="scale(1 -1)"
                fontSize={markerSize * 2.3}
              >
                {label}
              </text>
            </g>
          ))}
        {points
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((point, i) => (
            <g key={i} className="sheet-template-marker">
              <circle
                cx={point.x}
                cy={point.y}
                r={markerSize}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={point.x + markerSize * 1.4}
                y={-point.y}
                transform="scale(1 -1)"
                fontSize={markerSize * 1.55}
              >
                {i + 1}
              </text>
            </g>
          ))}
      </g>
    </svg>
  );
}
