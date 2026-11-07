import {
  representationPoint,
  representationPoints as insertedPoints,
  representationPrimitives,
  showsPhysicalDescription,
} from '../domain/representations';
import {
  quantityLabel,
  detailTitle,
  assemblyLabel,
} from '../domain/detailQuantities';
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
import {
  annotationPrimitives,
  primitiveBounds,
  distributionOrigins,
  distributionPrimitives,
} from '../domain/drafting';
import { projectPoints } from '../domain/model';
import {
  detailEditorView,
  groupedDetailForObject,
  toggleDetailSelection,
} from '../domain/detailEditing';
import type { Bar, Point, Primitive, Project, Tool } from '../domain/types';
export type Camera = { x: number; y: number; s: number };
export type CadState = {
  view: Camera;
  overview: { projectId: string; view: Camera } | null;
};
export type CadHandle = {
  fit: () => void;
  zoom: (factor: number) => void;
  getState: () => CadState;
};
type Props = {
  project: Project;
  initialState?: CadState;
  tool: Tool;
  selected: string[];
  setSelected: (ids: string[]) => void;
  onPoint: (p: Point) => void;
  onPrimitive: (p: Primitive, polylineId?: string) => void;
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
  isolatedDetailId?: string;
  onEditDetail: (id: string) => void;
};
export default forwardRef<CadHandle, Props>(function CadCanvas(props, ref) {
  const {
    project: source,
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
  const project = useMemo(
    () => detailEditorView(source, props.isolatedDetailId),
    [source, props.isolatedDetailId],
  );
  const lastHit = useRef<string | null>(null);
  const overview = useRef<{
    projectId: string;
    view: { x: number; y: number; s: number };
  } | null>(props.initialState?.overview ?? null);
  const groupedIds = useMemo(
    () =>
      new Set(
        source.hierarchy.details.filter((d) => d.grouped).map((d) => d.id),
      ),
    [source.hierarchy.details],
  );
  const individual = (id: string) =>
    !!props.isolatedDetailId ||
    !groupedIds.has(source.hierarchy.objectDetails[id]);
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState(
    props.initialState?.view ?? { x: 2800, y: -300, s: 0.12 },
  );
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
  const annotations = useMemo(
    () =>
      project.annotations.map((a) => ({
        annotation: a,
        items: annotationPrimitives(a, source),
      })),
    [project],
  );
  const barGeometries = useMemo(
    () => new Map(source.bars.map((b) => [b.id, geometry(b)])),
    [source.bars],
  );
  const barDefinitions = useMemo(
    () => new Map(source.bars.map((b) => [b.id, b])),
    [source.bars],
  );
  const representationPoints = useMemo(
    () =>
      project.details.flatMap((d) => {
        const bar = barDefinitions.get(d.barId);
        return bar ? insertedPoints(bar, d) : [];
      }),
    [project.details, barDefinitions, barGeometries],
  );
  const allPoints = useMemo(
    () => [
      ...projectPoints(project),
      ...representationPoints,
      ...annotations.flatMap((a) => a.items.flatMap(primitiveBounds)),
      ...masks.flatMap((m) => m.items.flatMap(primitiveBounds)),
    ],
    [project, masks, annotations, representationPoints],
  );
  const groupBoxes = useMemo(() => {
    if (props.isolatedDetailId) return [];
    const grouped = new Map(
      source.hierarchy.details.filter((d) => d.grouped).map((d) => [d.id, d]),
    );
    const boxes = new Map<
      string,
      { x: number; y: number; right: number; top: number }
    >();
    const addPoints = (id: string, points: Point[]) => {
      const owner = source.hierarchy.objectDetails[id];
      if (!grouped.has(owner)) return;
      for (const point of points) {
        const old = boxes.get(owner);
        if (old) {
          old.x = Math.min(old.x, point.x);
          old.y = Math.min(old.y, point.y);
          old.right = Math.max(old.right, point.x);
          old.top = Math.max(old.top, point.y);
        } else
          boxes.set(owner, {
            x: point.x,
            y: point.y,
            right: point.x,
            top: point.y,
          });
      }
    };
    for (const bar of project.bars) {
      const pts = sampled(barGeometries.get(bar.id)!.segments);
      const origins = bar.distribution
        ? distributionOrigins(bar)
        : [bar.origin];
      for (const origin of origins)
        addPoints(
          bar.id,
          pts.map((v) => world(v, { ...bar, origin })),
        );
    }
    for (const d of project.details) {
      const bar = barDefinitions.get(d.barId);
      if (bar) addPoints(d.id, insertedPoints(bar, d));
    }
    for (const line of project.polylines) addPoints(line.id, line.points);
    for (const a of annotations)
      for (const item of a.items)
        addPoints(a.annotation.id, primitiveBounds(item));
    for (const m of masks)
      for (const item of m.items) addPoints(m.mask.id, primitiveBounds(item));
    return [...boxes].map(([id, box]) => ({
      id,
      name: detailTitle(source, id),
      ...box,
      width: box.right - box.x,
      height: box.top - box.y,
    }));
  }, [
    project,
    source.hierarchy,
    barGeometries,
    barDefinitions,
    annotations,
    masks,
    props.isolatedDetailId,
  ]);
  const fit = () => {
    const b = bounds(allPoints);
    const s = Math.max(
      0.00001,
      Math.min(
        2,
        Math.max(80, size.w - 180) / Math.max(b.width, 500),
        Math.max(80, size.h - 120) / Math.max(b.height, 500),
      ),
    );
    setView({
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
      s,
    });
  };
  useImperativeHandle(ref, () => ({
    fit,
    getState: () => ({ view, overview: overview.current }),
    zoom: (f) =>
      setView((v) => ({ ...v, s: Math.max(0.000001, Math.min(20, v.s * f)) })),
  }));
  const initialMaskCount = useRef(project.masks.length);
  const firstScopeEffect = useRef(true);
  useEffect(() => {
    if (
      size.w > 0 &&
      (!props.initialState || project.masks.length !== initialMaskCount.current)
    )
      fit();
  }, [project.masks.length, size.w === 900]); // fit after a new reference, not after every edit
  useEffect(() => {
    setGrip(null);
    setDrag(null);
    setMarquee(null);
    if (firstScopeEffect.current && props.initialState) {
      firstScopeEffect.current = false;
      return;
    }
    firstScopeEffect.current = false;
    if (props.isolatedDetailId) {
      if (!overview.current) overview.current = { projectId: project.id, view };
      fit();
    } else if (overview.current) {
      if (overview.current.projectId === project.id)
        setView(overview.current.view);
      overview.current = null;
    }
  }, [props.isolatedDetailId, project.id]);
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
      ...project.polylines.map((p) => ({
        ...p,
        points: p.closed ? [...p.points, p.points[0]] : p.points,
      })),
      ...annotations.flatMap((a) => a.items.filter((p) => !p.text)),
      ...project.bars.map((b) => ({
        points: sampled(geometry(b).segments).map((v) => world(v, b)),
      })),
    ],
    [masks, project.bars, project.polylines, annotations],
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
        (b) => selected.includes(b.id) && b.kind === 'free' && individual(b.id),
      ))
        for (let i = 0; i < b.points.length; i++)
          if (distance(world(b.points[i], b), p) < 9 / view.s) {
            setGrip({ id: b.id, index: i, point: p });
            return;
          }
      let hit: string | undefined,
        best = 9 / view.s;
      for (const b of project.bars) {
        const origins =
          b.distribution?.render === 'bars'
            ? distributionOrigins(b)
            : [b.origin];
        for (const origin of origins) {
          const ps = sampled(barGeometries.get(b.id)!.segments).map((v) =>
            world(v, { ...b, origin }),
          );
          for (let i = 1; i < ps.length; i++) {
            const d = distance(p, nearest(p, ps[i - 1], ps[i]));
            if (d < best) {
              best = d;
              hit = b.id;
            }
          }
        }
      }
      for (const object of [
        ...project.polylines.map((l) => ({
          id: l.id,
          items: [
            {
              ...l,
              layer: 'DESENHO',
              points: l.closed ? [...l.points, l.points[0]] : l.points,
            },
          ],
        })),
        ...annotations.map((a) => ({ id: a.annotation.id, items: a.items })),
      ]) {
        for (const item of object.items) {
          if ('text' in item && item.text) {
            if (distance(p, item.points[0]) < 14 / view.s) {
              hit = object.id;
              best = 0;
            }
            continue;
          }
          for (let i = 1; i < item.points.length; i++) {
            const d = distance(
              p,
              nearest(p, item.points[i - 1], item.points[i]),
            );
            if (d < best) {
              best = d;
              hit = object.id;
            }
          }
        }
      }
      if (!hit) {
        for (const d of project.details) {
          const b = barDefinitions.get(d.barId);
          if (!b) continue;
          const pts = insertedPoints(b, d);
          for (let i = 1; i < pts.length; i++)
            if (distance(p, nearest(p, pts[i - 1], pts[i])) < best) {
              hit = d.id;
              break;
            }
        }
      }
      if (!hit) {
        const box = groupBoxes.find(
          (b) =>
            p.x >= b.x - 12 / view.s &&
            p.x <= b.right + 12 / view.s &&
            p.y >= b.y - 12 / view.s &&
            p.y <= b.top + 24 / view.s,
        );
        if (box)
          hit = Object.keys(source.hierarchy.objectDetails).find(
            (id) => source.hierarchy.objectDetails[id] === box.id,
          );
      }
      lastHit.current = hit || null;
      if (hit) {
        setSelected(
          toggleDetailSelection(
            source,
            selected,
            hit,
            e.shiftKey,
            props.isolatedDetailId,
          ),
        );
      } else {
        if (!e.shiftKey) setSelected([]);
        setMarquee({ start: p, end: p });
      }
    } else if (tool === 'follow' || tool === 'convert') {
      let best = 16 / view.s,
        hit: Primitive | undefined,
        polylineId: string | undefined;
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
      if (tool === 'convert')
        for (const item of project.polylines.filter((l) => individual(l.id))) {
          const pts = item.closed
            ? [...item.points, item.points[0]]
            : item.points;
          for (let i = 1; i < pts.length; i++) {
            const d = distance(p, nearest(p, pts[i - 1], pts[i]));
            if (d < best) {
              best = d;
              hit = { ...item, layer: 'DESENHO' };
              polylineId = item.id;
            }
          }
        }
      if (hit) props.onPrimitive(hit, polylineId);
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
        const ids = [
          ...project.details
            .filter((d) => {
              const b = barDefinitions.get(d.barId);
              return b && insertedPoints(b, d).every(inside);
            })
            .map((d) => d.id),
          ...project.bars
            .filter((b) =>
              vertices(b)
                .map((p) => world(p, b))
                .every(inside),
            )
            .map((b) => b.id),
          ...project.polylines
            .filter((l) => l.points.every(inside))
            .map((l) => l.id),
          ...project.annotations
            .filter((a) => a.points.every(inside))
            .map((a) => a.id),
        ];
        setSelected(e.shiftKey ? [...new Set([...selected, ...ids])] : ids);
      }
      setMarquee(null);
    }
    setDrag(null);
  };
  const stroke = 1 / view.s;
  const textSize = 11 / view.s;
  const renderBar = (
    b: Bar,
    origin = b.origin,
    isDetail = false,
    showLabel = true,
  ) => {
    const edited =
      grip?.id === b.id
        ? {
            ...b,
            points: b.points.map((p, i) =>
              i === grip.index ? local(grip.point, b) : p,
            ),
          }
        : b;
    const g = grip?.id === b.id ? geometry(edited) : barGeometries.get(b.id)!,
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
        {showLabel && (isDetail || showsPhysicalDescription(source, b.id)) && (
          <g transform={`translate(0 ${-90}) scale(1 -1)`}>
            <text
              fill={color}
              fontSize={textSize}
              fontFamily="Inter, sans-serif"
              fontWeight="600"
            >
              {b.mark}{' '}
              <tspan fontWeight="400">
                {quantityLabel(source, b)} Ø
                {format(b.diameter, b.diameter % 1 ? 1 : 0)} · C=
                {format(g.length / 10)} cm
              </tspan>
              {assemblyLabel(b) && <tspan> · {assemblyLabel(b)}</tspan>}
              {isDetail && (
                <tspan fill={light ? '#6a7283' : '#71829d'}>
                  {' '}
                  · rebatimento
                </tspan>
              )}
            </text>
          </g>
        )}
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
          individual(b.id) &&
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
  const renderPrimitives = (
    items: Primitive[],
    color: string,
    active = false,
  ) =>
    items.map((item, i) =>
      item.text ? (
        <g
          key={i}
          transform={`translate(${item.points[0].x} ${item.points[0].y}) rotate(${item.textRotation ?? 0}) scale(1 -1)`}
        >
          <text
            fill={color}
            fontSize={Math.max(item.textHeight ?? 40, 10 * stroke)}
            textAnchor={
              item.layer === 'COTAS' || item.layer === 'DISTRIBUICAO'
                ? 'middle'
                : 'start'
            }
          >
            {item.text.replace(/%%c/g, 'Ø')}
          </text>
        </g>
      ) : (
        <path
          key={i}
          d={
            item.points
              .map((v, j) => `${j ? 'L' : 'M'}${v.x},${v.y}`)
              .join(' ') + (item.closed ? ' Z' : '')
          }
          fill="none"
          stroke={color}
          strokeWidth={(active ? 2.4 : 1) * stroke}
        />
      ),
    );
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
        onDoubleClick={() => {
          if (tool !== 'select' || props.isolatedDetailId || !lastHit.current)
            return;
          const detail = groupedDetailForObject(source, lastHit.current);
          if (detail) props.onEditDetail(detail.id);
        }}
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
          {project.polylines.map((l) => (
            <g key={l.id} data-testid="cad-polyline">
              {renderPrimitives(
                [{ ...l, layer: 'DESENHO' }],
                selected.includes(l.id) ? '#58bce8' : l.color,
                selected.includes(l.id),
              )}
            </g>
          ))}
          {project.bars.flatMap((b) =>
            b.distribution?.render === 'bars'
              ? distributionOrigins(b).map((origin, i) =>
                  renderBar(b, origin, false, i === 0),
                )
              : renderBar(b),
          )}
          {annotations.map(({ annotation: a, items }) => (
            <g key={a.id} data-testid="cad-annotation" data-kind={a.kind}>
              {renderPrimitives(
                items,
                selected.includes(a.id)
                  ? '#58bce8'
                  : light
                    ? '#394861'
                    : a.color,
                selected.includes(a.id),
              )}
            </g>
          ))}
          {project.details.map((d) => {
            const b = barDefinitions.get(d.barId);
            return b ? (
              <g key={d.id} data-representation-id={d.id}>
                {!d.rotation &&
                (d.scale ?? 1) === 1 &&
                (d.identification ?? 'legacy') === 'legacy'
                  ? renderBar(b, d.origin, true)
                  : renderPrimitives(
                      representationPrimitives(b, d, source, textSize),
                      b.color,
                      selected.includes(d.id),
                    )}
              </g>
            ) : null;
          })}
          {groupBoxes.map((box) => (
            <g
              key={box.id}
              data-testid="cad-detail-group"
              data-detail-id={box.id}
              pointerEvents="none"
            >
              <rect
                x={box.x - 12 * stroke}
                y={box.y - 12 * stroke}
                width={box.width + 24 * stroke}
                height={box.height + 24 * stroke}
                fill="none"
                stroke={light ? '#536fbb' : '#87a5ec'}
                opacity={
                  selected.some(
                    (id) => source.hierarchy.objectDetails[id] === box.id,
                  )
                    ? 1
                    : 0.4
                }
                strokeWidth={stroke}
                strokeDasharray={`${5 * stroke} ${4 * stroke}`}
              />
              <text
                transform={`translate(${box.x} ${box.top + 18 * stroke}) scale(1 -1)`}
                fill={light ? '#3e5694' : '#9db7f1'}
                fontSize={textSize}
              >
                {box.name}
              </text>
            </g>
          ))}
          {project.bars
            .filter((b) => b.distribution)
            .map((b) => (
              <g key={b.id} data-testid="cad-distribution">
                {renderPrimitives(
                  distributionPrimitives(b, undefined, source),
                  b.color,
                )}
              </g>
            ))}
          {draft.length === 2 &&
            cursor &&
            [
              'dimension-aligned',
              'dimension-orthogonal',
              'leader',
              'section',
              'section-arc',
            ].includes(tool) && (
              <g opacity=".65">
                {renderPrimitives(
                  annotationPrimitives(
                    {
                      id: 'preview',
                      kind: tool as import('../domain/types').AnnotationKind,
                      points: [...draft, cursor],
                      label: '',
                      textHeight: 50,
                      color: '#50cddd',
                    },
                    project,
                  ),
                  '#50cddd',
                )}
              </g>
            )}
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
      {project.bars.length === 0 &&
        project.masks.length === 0 &&
        project.polylines.length === 0 &&
        project.annotations.length === 0 && (
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
