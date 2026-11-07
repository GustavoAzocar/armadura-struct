import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Point, Project, Sheet } from '../domain/types';
import { bounds } from '../domain/geometry';
import { primitiveBounds } from '../domain/drafting';
import { drawingPrimitives } from '../domain/drawingPrimitives';
import { detailEditorView } from '../domain/detailEditing';
import { sheetSize } from '../domain/sheets';
import type { CadHandle, CadState, Camera } from './CadCanvas';

type Props = {
  project: Project;
  sheet: Sheet;
  initialState?: CadState;
  selectedView?: string;
  pan: boolean;
  onSelect: (id?: string) => void;
  onMove: (id: string, origin: Point) => void;
  onOpenDrawing: (id: string) => void;
};
export default forwardRef<CadHandle, Props>(function SheetCanvas(
  {
    project,
    sheet,
    initialState,
    selectedView,
    pan,
    onSelect,
    onMove,
    onOpenDrawing,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const clipPrefix = useId().replace(/:/g, '');
  const lastViewHit = useRef<string | undefined>(undefined);
  const paper = sheetSize(sheet);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState<Camera>(
    initialState?.view ?? { x: paper.width / 2, y: paper.height / 2, s: 1 },
  );
  const [drag, setDrag] = useState<{
    start: Point;
    camera: Camera;
    id?: string;
    origin?: Point;
    delta: Point;
  } | null>(null);
  const placements = project.hierarchy.placements.filter(
    (v) => v.sheetId === sheet.id,
  );
  const preview = useMemo(() => {
    const result = new Map<
      string,
      {
        lines: ReturnType<typeof drawingPrimitives>;
        box: ReturnType<typeof bounds>;
      }
    >();
    for (const placement of project.hierarchy.placements) {
      if (placement.sheetId !== sheet.id || result.has(placement.drawingId))
        continue;
      const drawing = project.hierarchy.drawings.find(
        (d) => d.id === placement.drawingId,
      );
      if (!drawing) continue;
      const lines = drawingPrimitives(
        detailEditorView(project, drawing.detailId),
        project,
      );
      result.set(drawing.id, {
        lines,
        box: bounds(lines.flatMap(primitiveBounds)),
      });
    }
    return result;
  }, [project, sheet.id]);
  const fit = () =>
    setView({
      x: paper.width / 2,
      y: paper.height / 2,
      s: Math.max(
        0.05,
        Math.min((size.w - 70) / paper.width, (size.h - 85) / paper.height),
      ),
    });
  useImperativeHandle(ref, () => ({
    fit,
    zoom: (f) =>
      setView((v) => ({ ...v, s: Math.max(0.05, Math.min(50, v.s * f)) })),
    getState: () => ({ view, overview: null }),
  }));
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  const firstFit = useRef(!initialState);
  useEffect(() => {
    if (firstFit.current && size.w !== 900) {
      fit();
      firstFit.current = false;
    }
  }, [size.w, size.h]);
  useEffect(() => {
    if (!initialState) fit();
  }, [sheet.format, sheet.orientation]);
  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  return (
    <div className="sheet-canvas-host" ref={host}>
      <div className="sheet-preview-label">
        {sheet.name} · {sheet.format} · {paper.width} × {paper.height} mm ·
        Prévia de layout
      </div>
      <svg
        ref={svg}
        data-testid="sheet-canvas"
        aria-label={`Prévia da folha ${sheet.name}`}
        width={size.w}
        height={size.h}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          const at = screenPoint(e),
            factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setView((v) => {
            const s = Math.max(0.05, Math.min(50, v.s * factor));
            return {
              s,
              x: v.x + (at.x - size.w / 2) * (1 / v.s - 1 / s),
              y: v.y - (at.y - size.h / 2) * (1 / v.s - 1 / s),
            };
          });
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return;
          e.preventDefault();
          const id =
            !pan && e.button === 0
              ? ((e.target as Element)
                  .closest('[data-view-id]')
                  ?.getAttribute('data-view-id') ?? undefined)
              : undefined;
          const placement = placements.find((v) => v.id === id);
          lastViewHit.current = id;
          if (e.button === 0 && !pan) onSelect(id);
          if (id || pan || e.button === 1) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({
              start: screenPoint(e),
              camera: view,
              id,
              origin: placement?.origin,
              delta: { x: 0, y: 0 },
            });
          }
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const at = screenPoint(e),
            delta = {
              x: (at.x - drag.start.x) / drag.camera.s,
              y: -(at.y - drag.start.y) / drag.camera.s,
            };
          if (!drag.id)
            setView({
              ...drag.camera,
              x: drag.camera.x - delta.x,
              y: drag.camera.y - delta.y,
            });
          else setDrag({ ...drag, delta });
        }}
        onPointerUp={() => {
          if (
            drag?.id &&
            drag.origin &&
            Math.hypot(drag.delta.x, drag.delta.y) > 0.01
          )
            onMove(drag.id, {
              x: drag.origin.x + drag.delta.x,
              y: drag.origin.y + drag.delta.y,
            });
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={(e) => {
          if (pan) return;
          const id =
            (e.target as Element)
              .closest('[data-view-id]')
              ?.getAttribute('data-view-id') ?? lastViewHit.current;
          const placement = placements.find((v) => v.id === id);
          if (placement) onOpenDrawing(placement.drawingId);
        }}
      >
        <g
          transform={`translate(${size.w / 2 - view.x * view.s} ${size.h / 2 + view.y * view.s}) scale(${view.s} ${-view.s})`}
        >
          <rect
            className="paper"
            x={0}
            y={0}
            width={paper.width}
            height={paper.height}
          />
          <rect
            x={10}
            y={10}
            width={paper.width - 20}
            height={paper.height - 20}
            fill="none"
            stroke="#cbd0d9"
            strokeWidth={0.35}
            pointerEvents="none"
          />
          {!placements.length && (
            <text
              x={paper.width / 2}
              y={-paper.height / 2}
              transform="scale(1 -1)"
              textAnchor="middle"
              fontSize="5"
              fill="#7b8498"
            >
              Folha vazia · coloque um desenho pelo gerenciador
            </text>
          )}
          {placements.map((v) => {
            const data = preview.get(v.drawingId),
              drawing = project.hierarchy.drawings.find(
                (d) => d.id === v.drawingId,
              );
            if (!data || !drawing) return null;
            const delta = drag?.id === v.id ? drag.delta : { x: 0, y: 0 };
            const { width: w, height: h } = v.frame,
              b = data.box;
            const scale = Math.max(
              0.000001,
              Math.min(
                (w - 6) / Math.max(1, b.width),
                (h - 10) / Math.max(1, b.height),
              ),
            );
            const title = `${project.hierarchy.details.find((d) => d.id === drawing.detailId)?.name} · ${drawing.name}`;
            const clipId = `${clipPrefix}-${v.id}`;
            return (
              <g
                key={v.id}
                data-view-id={v.id}
                data-testid="sheet-view"
                transform={`translate(${v.origin.x + delta.x} ${v.origin.y + delta.y}) rotate(${v.rotation})`}
                className={v.id === selectedView ? 'selected' : ''}
              >
                <title>{title} · duplo clique para editar o desenho</title>
                <rect className="sheet-view-frame" width={w} height={h} />
                <clipPath id={clipId}>
                  <rect
                    x={2}
                    y={2}
                    width={Math.max(1, w - 4)}
                    height={Math.max(1, h - 4)}
                  />
                </clipPath>
                <g clipPath={`url(#${clipId})`} pointerEvents="none">
                  <g
                    transform={`translate(${w / 2} ${h / 2 - 2}) scale(${scale}) translate(${-b.x - b.width / 2} ${-b.y - b.height / 2})`}
                  >
                    {data.lines.map((line, i) =>
                      line.text ? (
                        <text
                          key={i}
                          transform={`translate(${line.points[0]?.x ?? 0} ${line.points[0]?.y ?? 0}) rotate(${line.textRotation ?? 0}) scale(1 -1)`}
                          fontSize={line.textHeight ?? 40}
                          fill="#31405e"
                        >
                          {line.text.replace(/%%c/g, 'Ø')}
                        </text>
                      ) : (
                        <path
                          key={i}
                          d={
                            line.points
                              .map((p, j) => `${j ? 'L' : 'M'}${p.x},${p.y}`)
                              .join(' ') + (line.closed ? ' Z' : '')
                          }
                          fill="none"
                          stroke={
                            line.layer === 'MASCARA' ? '#a9afbb' : '#30477f'
                          }
                          strokeWidth={0.25 / scale}
                        />
                      ),
                    )}
                  </g>
                  <text
                    x={3}
                    y={-h + 4}
                    transform="scale(1 -1)"
                    fontSize={Math.min(3, h / 5)}
                    fill="#5d677c"
                  >
                    {title}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="sheet-canvas-help">
        Duplo clique na vista: editar desenho · arraste: posicionar · roda: zoom
        · botão do meio: navegar
      </div>
      <button className="sheet-fit" onClick={fit}>
        Ajustar folha
      </button>
    </div>
  );
});
