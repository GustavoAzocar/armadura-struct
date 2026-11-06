import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Crosshair,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
} from 'lucide-react';
import {
  add,
  bounds,
  distance,
  format,
  geometry,
  local,
  mul,
  nearest,
  path,
  sampled,
  sub,
  vertices,
  world,
} from '../domain/geometry';
import { maskPrimitives } from '../cad/import';
import { projectPoints } from '../domain/model';
import type { Bar, Point, Primitive, Project, Tool } from '../domain/types';
export type CadHandle = { fit: () => void; zoom: (factor: number) => void };
type Props = {
  project: Project;
  tool: Tool;
  selected: string[];
  setSelected: (ids: string[]) => void;
  onPoint: (p: Point) => void;
  onPrimitive: (p: Primitive) => void;
  onFinish: () => void;
  onBarChange: (id: string, patch: Partial<Bar>) => void;
  draft: Point[];
  grid: boolean;
  snap: boolean;
  ortho: boolean;
  light: boolean;
  setTool: (t: Tool) => void;
  onCursor: (p: Point) => void;
  showDimensions: boolean;
};
export default forwardRef<CadHandle, Props>(function CadCanvas(props, ref) {
  const {
    project,
    tool,
    selected,
    setSelected,
    onPoint,
    draft,
    grid,
    snap,
    ortho,
    light,
  } = props;
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState({ x: 2800, y: -300, s: 0.12 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const [drag, setDrag] = useState<{ screen: Point; view: typeof view } | null>(
    null,
  );
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(
    null,
  );
  const [grip, setGrip] = useState<{
    id: string;
    index: number;
    point: Point;
  } | null>(null);
  const space = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(host.current);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = () => {
      space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  const masks = useMemo(
    () =>
      project.masks.map((m) => {
        const items = maskPrimitives(m);
        const paths = new Map<string, string[]>();
        for (const p of items) {
          if (p.text || !p.points.length) continue;
          if (!paths.has(p.layer)) paths.set(p.layer, []);
          paths
            .get(p.layer)!
            .push(
              p.points
                .map((v, i) => `${i ? 'L' : 'M'}${v.x},${v.y}`)
                .join(' ') + (p.closed ? ' Z' : ''),
            );
        }
        return {
          mask: m,
          items,
          paths: [...paths].map(([layer, d]) => ({ layer, d: d.join(' ') })),
        };
      }),
    [project.masks],
  );
  const allPoints = useMemo(
    () => [
      ...projectPoints(project),
      ...masks.flatMap((m) => m.items.flatMap((i) => i.points)),
    ],
    [project, masks],
  );
  const fit = () => {
    const b = bounds(allPoints);
    const s = Math.max(
      0.00001,
      Math.min(
        2,
        (size.w - 360) / Math.max(b.width, 500),
        (size.h - 170) / Math.max(b.height, 500),
      ),
    );
    setView({
      x: b.x + b.width / 2 + 60 / s,
      y: b.y + b.height / 2,
      s,
    });
  };
  useImperativeHandle(ref, () => ({
    fit,
    zoom: (f) =>
      setView((v) => ({ ...v, s: Math.max(0.000001, Math.min(20, v.s * f)) })),
  }));
  useEffect(() => {
    if (size.w > 0) fit();
  }, [project.masks.length, size.w === 900]); // fit after a new reference, not after every edit
  const scr = (p: Point) => ({
    x: (p.x - view.x) * view.s + size.w / 2,
    y: (view.y - p.y) * view.s + size.h / 2,
  });
  const fromScreen = (p: Point) => ({
    x: (p.x - size.w / 2) / view.s + view.x,
    y: view.y - (p.y - size.h / 2) / view.s,
  });
  const eventScreen = (e: { clientX: number; clientY: number }) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const linework = useMemo(
    () => [
      ...masks.flatMap((m) => m.items.filter((p) => !p.text)),
      ...project.bars.map((b) => ({
        points: sampled(geometry(b).segments).map((v) => world(v, b)),
      })),
    ],
    [masks, project.bars],
  );
  const snapAt = (raw: Point) => {
    let target: Point | undefined,
      best = 10 / view.s;
    if (snap) {
      for (const chain of linework) {
        for (let i = 0; i < chain.points.length; i++) {
          const a = chain.points[i];
          const d = distance(a, raw);
          if (d < best) {
            best = d;
            target = a;
          }
          if (i > 0) {
            const prev = chain.points[i - 1],
              mid = mul(add(prev, a), 0.5),
              dm = distance(mid, raw);
            if (dm < best) {
              best = dm;
              target = mid;
            }
          }
        }
      }
    }
    let p = target ?? raw;
    if (ortho && draft.length) {
      const a = draft.at(-1)!;
      p =
        Math.abs(p.x - a.x) >= Math.abs(p.y - a.y)
          ? { x: p.x, y: a.y }
          : { x: a.x, y: p.y };
      if (target && distance(p, target) > 0.001) target = undefined;
    }
    setSnapPoint(target ?? null);
    return p;
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const screen = eventScreen(e),
      p = snapAt(fromScreen(screen));
    svg.current?.setPointerCapture(e.pointerId);
    if (e.button === 1 || tool === 'pan' || space.current) {
      setDrag({ screen, view });
      return;
    }
    if (tool === 'select') {
      for (const b of project.bars.filter(
        (b) => selected.includes(b.id) && b.kind === 'free',
      ))
        for (let i = 0; i < b.points.length; i++)
          if (distance(world(b.points[i], b), p) < 9 / view.s) {
            setGrip({ id: b.id, index: i, point: p });
            return;
          }
      let hit: string | undefined,
        best = 9 / view.s;
      for (const b of project.bars) {
        const ps = sampled(geometry(b).segments).map((v) => world(v, b));
        for (let i = 1; i < ps.length; i++) {
          const d = distance(p, nearest(p, ps[i - 1], ps[i]));
          if (d < best) {
            best = d;
            hit = b.id;
          }
        }
      }
      if (!hit) {
        for (const d of project.details) {
          const b = project.bars.find((b) => b.id === d.barId);
          if (!b) continue;
          const pts = sampled(geometry(b).segments).map((v) =>
            add(v, d.origin),
          );
          for (let i = 1; i < pts.length; i++)
            if (distance(p, nearest(p, pts[i - 1], pts[i])) < best) {
              hit = b.id;
              break;
            }
        }
      }
      if (hit) {
        setSelected(
          e.shiftKey
            ? selected.includes(hit)
              ? selected.filter((id) => id !== hit)
              : [...selected, hit]
            : [hit],
        );
      } else {
        if (!e.shiftKey) setSelected([]);
        setMarquee({ start: p, end: p });
      }
    } else if (tool === 'follow') {
      let best = 16 / view.s,
        hit: Primitive | undefined;
      for (const m of masks)
        for (const item of m.items) {
          if (item.text) continue;
          const pts = item.closed
            ? [...item.points, item.points[0]]
            : item.points;
          for (let i = 1; i < pts.length; i++) {
            const d = distance(p, nearest(p, pts[i - 1], pts[i]));
            if (d < best) {
              best = d;
              hit = item;
            }
          }
        }
      if (hit) props.onPrimitive(hit);
    } else onPoint(p);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const screen = eventScreen(e);
    if (drag) {
      setView({
        ...drag.view,
        x: drag.view.x - (screen.x - drag.screen.x) / view.s,
        y: drag.view.y + (screen.y - drag.screen.y) / view.s,
      });
      return;
    }
    const p = snapAt(fromScreen(screen));
    setCursor(p);
    props.onCursor(p);
    if (marquee) setMarquee({ ...marquee, end: p });
    if (grip) setGrip({ ...grip, point: p });
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
    if (grip) {
      const b = project.bars.find((b) => b.id === grip.id)!;
      props.onBarChange(b.id, {
        points: b.points.map((p, i) =>
          i === grip.index ? local(grip.point, b) : p,
        ),
      });
      setGrip(null);
    }
    if (marquee) {
      const box = bounds([marquee.start, marquee.end]);
      if (box.width + box.height > 5 / view.s) {
        const inside = (p: Point) =>
          p.x >= box.x &&
          p.x <= box.x + box.width &&
          p.y >= box.y &&
          p.y <= box.y + box.height;
        setSelected(
          project.bars
            .filter((b) =>
              vertices(b)
                .map((p) => world(p, b))
                .every(inside),
            )
            .map((b) => b.id),
        );
      }
      setMarquee(null);
    }
    setDrag(null);
  };
  const stroke = 1 / view.s;
  const textSize = 11 / view.s;
  const renderBar = (b: Bar, origin = b.origin, isDetail = false) => {
    const edited =
      grip?.id === b.id
        ? {
            ...b,
            points: b.points.map((p, i) =>
              i === grip.index ? local(grip.point, b) : p,
            ),
          }
        : b;
    const g = geometry(edited),
      active = selected.includes(b.id);
    const color = g.errors.length ? '#e76472' : b.color;
    const tr = `translate(${origin.x} ${origin.y}) rotate(${isDetail ? 0 : b.rotation})`;
    return (
      <g
        key={`${b.id}-${isDetail ? 'detail' : 'bar'}-${origin.x}-${origin.y}`}
        transform={tr}
      >
        {active && (
          <path
            d={path(g.segments)}
            fill="none"
            stroke={color}
            strokeWidth={8 * stroke}
            opacity="0.15"
          />
        )}
        <path
          d={path(g.segments)}
          fill="none"
          stroke={color}
          strokeWidth={(active ? 2.7 : 2) * stroke}
          strokeLinejoin="round"
        />
        <g transform={`translate(0 ${-90}) scale(1 -1)`}>
          <text
            fill={color}
            fontSize={textSize}
            fontFamily="Inter, sans-serif"
            fontWeight="600"
          >
            {b.mark}{' '}
            <tspan fontWeight="400">
              {b.quantity} Ø{format(b.diameter, b.diameter % 1 ? 1 : 0)} · C=
              {format(g.length / 10)} cm
            </tspan>
            {isDetail && (
              <tspan fill={light ? '#6a7283' : '#71829d'}> · rebatimento</tspan>
            )}
          </text>
        </g>
        {props.showDimensions &&
          (isDetail || b.kind === 'stirrup') &&
          g.vertices.slice(0, -1).map((p, i) => {
            if (b.kind === 'stirrup' && ![3, 4].includes(i)) return null;
            const q = g.vertices[i + 1];
            if (distance(p, q) < 100) return null;
            const mid = mul(add(p, q), 0.5);
            return (
              <g
                key={i}
                transform={`translate(${mid.x + (p.x === q.x ? -45 : 0)} ${mid.y + (p.x === q.x ? 0 : 45)}) scale(1 -1)`}
              >
                <text
                  textAnchor="middle"
                  fill={light ? '#67748a' : '#8999b1'}
                  fontSize={9 * stroke}
                >
                  {format(distance(p, q) / 10, 0)}
                </text>
              </g>
            );
          })}
        {active &&
          !isDetail &&
          b.kind === 'free' &&
          g.vertices.map((p, i) => (
            <rect
              key={i}
              x={p.x - 3.5 * stroke}
              y={p.y - 3.5 * stroke}
              width={7 * stroke}
              height={7 * stroke}
              fill={light ? '#fff' : '#122039'}
              stroke={color}
              strokeWidth={stroke}
            />
          ))}
      </g>
    );
  };
  const gridStep = 10 ** Math.ceil(Math.log10(55 / view.s));
  const origin = scr({ x: 0, y: 0 });
  return (
    <div className={`cad-host ${light ? 'cad-light' : ''}`} ref={host}>
      <svg
        ref={svg}
        className={`cad-svg ${tool === 'pan' || drag ? 'panning' : tool === 'select' ? 'selecting' : 'drawing'}`}
        aria-label="Área de desenho CAD"
        data-testid="cad-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          setDrag(null);
          setGrip(null);
          setMarquee(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onFinish();
        }}
        onWheel={(e) => {
          const p = fromScreen(eventScreen(e));
          const f = Math.exp(-e.deltaY * 0.0015);
          setView((v) => {
            const s = Math.max(0.000001, Math.min(20, v.s * f));
            return {
              s,
              x: p.x - ((p.x - v.x) * v.s) / s,
              y: p.y - ((p.y - v.y) * v.s) / s,
            };
          });
        }}
      >
        <defs>
          <pattern
            id="grid"
            x={origin.x % (gridStep * view.s)}
            y={origin.y % (gridStep * view.s)}
            width={gridStep * view.s}
            height={gridStep * view.s}
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r="1" fill={light ? '#d5dbe6' : '#27344c'} />
          </pattern>
        </defs>
        {grid && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g
          transform={`translate(${size.w / 2 - view.x * view.s} ${size.h / 2 + view.y * view.s}) scale(${view.s} ${-view.s})`}
        >
          {masks.map(({ mask, items, paths }) => (
            <g
              key={mask.id}
              opacity={mask.opacity}
              fill="none"
              stroke={light ? '#7e899b' : '#8090aa'}
              strokeWidth={stroke}
            >
              {paths.map(({ layer, d }) => (
                <path key={layer} d={d} />
              ))}
              {items
                .filter((p) => p.text)
                .map((p, i) => (
                  <g
                    key={i}
                    transform={`translate(${p.points[0].x} ${p.points[0].y}) rotate(${p.textRotation ?? 0}) scale(1 -1)`}
                  >
                    <text
                      fill={light ? '#7e899b' : '#8090aa'}
                      stroke="none"
                      fontSize={p.textHeight}
                    >
                      {p.text}
                    </text>
                  </g>
                ))}
            </g>
          ))}
          {project.bars.map((b) => renderBar(b))}
          {project.details.map((d) => {
            const b = project.bars.find((b) => b.id === d.barId);
            return b ? renderBar(b, d.origin, true) : null;
          })}
          {project.bars
            .filter((b) => b.distribution)
            .map((b) => {
              const end = b.distribution!.end;
              return (
                <g key={b.id} stroke={b.color} strokeWidth={stroke}>
                  <line
                    x1={b.origin.x}
                    y1={b.origin.y}
                    x2={end.x}
                    y2={end.y}
                    strokeDasharray={`${4 * stroke} ${4 * stroke}`}
                  />
                  {Array.from({ length: Math.min(b.quantity, 150) }, (_, i) => {
                    const p = add(
                      b.origin,
                      mul(
                        sub(end, b.origin),
                        i / Math.max(1, Math.min(b.quantity, 150) - 1),
                      ),
                    );
                    return (
                      <line
                        key={i}
                        x1={p.x}
                        y1={p.y - 25}
                        x2={p.x}
                        y2={p.y + 25}
                      />
                    );
                  })}
                  <g
                    transform={`translate(${(b.origin.x + end.x) / 2} ${(b.origin.y + end.y) / 2 + 65}) scale(1 -1)`}
                  >
                    <text
                      fill={b.color}
                      stroke="none"
                      fontSize={textSize}
                      textAnchor="middle"
                    >
                      {b.quantity} un. · c/
                      {format(
                        distance(b.origin, end) /
                          Math.max(1, b.quantity - 1) /
                          10,
                      )}{' '}
                      cm
                    </text>
                  </g>
                </g>
              );
            })}
          {draft.length > 0 && cursor && (
            <g
              stroke="#57d8de"
              strokeWidth={1.5 * stroke}
              fill="none"
              strokeDasharray={`${5 * stroke} ${4 * stroke}`}
            >
              {tool === 'stirrup' ? (
                <rect
                  x={Math.min(draft[0].x, cursor.x)}
                  y={Math.min(draft[0].y, cursor.y)}
                  width={Math.abs(cursor.x - draft[0].x)}
                  height={Math.abs(cursor.y - draft[0].y)}
                />
              ) : (
                <path
                  d={[...draft, cursor]
                    .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
                    .join(' ')}
                />
              )}
            </g>
          )}
          {snapPoint && (
            <rect
              x={snapPoint.x - 5 * stroke}
              y={snapPoint.y - 5 * stroke}
              width={10 * stroke}
              height={10 * stroke}
              fill="none"
              stroke="#44dec0"
              strokeWidth={stroke}
            />
          )}
          {marquee && (
            <rect
              x={Math.min(marquee.start.x, marquee.end.x)}
              y={Math.min(marquee.start.y, marquee.end.y)}
              width={Math.abs(marquee.end.x - marquee.start.x)}
              height={Math.abs(marquee.end.y - marquee.start.y)}
              fill="#4b71e8"
              fillOpacity="0.12"
              stroke="#4b71e8"
              strokeWidth={stroke}
            />
          )}
        </g>
        {cursor && tool !== 'select' && tool !== 'pan' && (
          <g
            stroke={light ? '#8090ab' : '#60718d'}
            opacity="0.65"
            pointerEvents="none"
          >
            <line
              x1={scr(cursor).x - 20}
              x2={scr(cursor).x + 20}
              y1={scr(cursor).y}
              y2={scr(cursor).y}
            />
            <line
              x1={scr(cursor).x}
              x2={scr(cursor).x}
              y1={scr(cursor).y - 20}
              y2={scr(cursor).y + 20}
            />
          </g>
        )}
      </svg>
      <div className="canvas-heading">
        <span className="live-dot" /> MODELO 2D{' '}
        <span className="canvas-slash">/</span>
        <span>Dimensões em milímetros</span>
      </div>
      <div className="canvas-context">
        <span>VISTA SUPERIOR</span>
        <b>XY</b>
      </div>
      {project.bars.length === 0 && project.masks.length === 0 && (
        <div className="canvas-empty">
          <Crosshair size={40} />
          <h2>Seu próximo detalhe começa aqui.</h2>
          <p>Importe uma fôrma DXF/DWG ou desenhe sua primeira armadura.</p>
          <button onClick={() => props.setTool('bar')}>Desenhar barra</button>
        </div>
      )}
      <div className="axis-widget">
        <span className="axis-x">X</span>
        <span className="axis-y">Y</span>
        <i />
      </div>
      <div className="canvas-tools">
        <button
          title="Selecionar (V)"
          aria-label="Selecionar"
          className={tool === 'select' ? 'active' : ''}
          onClick={() => props.setTool('select')}
        >
          <MousePointer2 size={16} />
        </button>
        <button
          title="Pan (H)"
          aria-label="Pan"
          onClick={() => props.setTool('pan')}
        >
          <Hand size={16} />
        </button>
        <span />
        <button
          title="Afastar"
          aria-label="Afastar"
          onClick={() => setView((v) => ({ ...v, s: v.s / 1.3 }))}
        >
          <Minus size={15} />
        </button>
        <button
          title="Ajustar à tela (F)"
          aria-label="Ajustar à tela"
          onClick={fit}
        >
          <Maximize2 size={16} />
        </button>
        <button
          title="Aproximar"
          aria-label="Aproximar"
          onClick={() => setView((v) => ({ ...v, s: v.s * 1.3 }))}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="canvas-scale">
        {format(gridStep, 0)} mm <span />
      </div>
    </div>
  );
});
