import { modalIsOpen, textComposition } from '../domain/shortcuts';
import { displayedBarGeometry } from '../domain/stirrupGeometry';
import { beamClampViewPoints } from '../domain/beamClampViews';
import {
  helixOutline,
  helixPrimitives,
  helixViewPoints,
} from '../domain/helixViews';
import { annotationCadDefaults } from '../domain/cadDefaults';
import {
  hitMaskCadEntity,
  type MaskCadEntity,
  type MaskEntityRef,
} from '../domain/maskCadEditing';
import { styledDrafting } from '../domain/cadDefaults';
import type {
  FollowEdge,
  FollowChain,
  previewFollow,
} from '../domain/followForm';
import { physicalBarTextPrimitives } from '../domain/drawingPrimitives';
import {
  visibilityProjection,
  visibilityReview,
  visibilityState,
} from '../domain/visibility';
import { drawingPrimitives } from '../domain/drawingPrimitives';
import { weldedMeshPrimitives } from '../domain/weldedMeshDrawing';
import { objectState, layerState } from '../domain/layerProfiles';
import { stylePrimitive, resolveStyle, dashArray } from '../domain/layers';
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
  useLayoutEffect,
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
import { insideTextBox, svgTextFont } from '../domain/textStyle';
import { paperPrimitiveBounds } from '../domain/paperText';
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
import type {
  Bar,
  Mask,
  Point,
  Primitive,
  Project,
  Tool,
} from '../domain/types';
import { symbolRenderMasks } from '../domain/symbolRender';
import { useFramePublisher } from './useFramePublisher';
import CadPreview from './CadPreview';
import { flushSync } from 'react-dom';
import { modelPoint, panCamera, zoomCamera } from '../lib/cadNavigation';
import {
  cadDiagnosticNow,
  recordCadWork,
  measureCadWork,
  setCadDiagnosticScene,
} from '../lib/cadDiagnostics';
import {
  createSnapIndex,
  defaultSnapModes,
  maskSnapSource,
  resolveObjectSnap,
  snapModeLabels,
  type SnapModes,
  type SnapSource,
  type SnapCandidate,
} from '../domain/objectSnaps';
import { pathCurve, roundCurve } from '../domain/maskCadGeometry';
import {
  acquireSnapGuides,
  snapGuideCandidates,
  snapGuidePath,
  type SnapAcquisition,
} from '../domain/objectSnapGuides';
export type Camera = { x: number; y: number; s: number };
type Pan = { screen: Point; view: Camera };
type Marquee = { start: Point; end: Point };
type Grip = { id: string; index: number; point: Point };
type SnapFeedback = {
  candidate: SnapCandidate | null;
  limited: boolean;
  acquired: SnapAcquisition;
};
type PointerFeedback = {
  point: Point;
  raw: Point;
  snap: SnapFeedback;
  started?: number;
};
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
  maskSidePick?: boolean;
  maskEditing?: {
    entities: MaskCadEntity[];
    targetMaskId: string;
    all?: boolean;
    stage: 'limits' | 'targets';
    selectedTarget?: string;
  };
  onMaskEntityPick?: (
    ref: MaskEntityRef | undefined,
    point: Point,
    tolerance: number,
  ) => void;
  onMaskEntityHover?: (
    ref: MaskEntityRef | undefined,
    point: Point,
    tolerance?: number,
  ) => void;
  maskCadOverlay?: {
    limits: Primitive[];
    change: Primitive[];
    mode: 'trim' | 'extend';
  };
  highlightedMaskId?: string;
  followInteraction?: {
    mode: 'edges' | 'side';
    available: FollowEdge[];
    selected: FollowEdge[];
    chain?: FollowChain;
    preview?: ReturnType<typeof previewFollow>;
    sidePoint?: Point;
  };
  onFollowEdge?: (key: string) => void;
  nativeDrawing?: boolean;
  onNativePick?: (maskId: string, entityId: string) => void;
  extraSnapPoints?: Point[];
  previewLines?: Primitive[];
  /** Preview geometry is retained in its original pose during whole-mask move. */
  previewTranslation?: Point;
  dimensionPresentation?: import('../domain/maskDimensions').DimensionPresentation;
  previewBase?: Point;
  /** Explicit command base; null disables relations for projected/vertex edits. */
  snapBase?: Point | null;
  snapContext?: string;
  snapLinear?: boolean;
  mirrorAxis?: { base: Point; end: Point };
  onContextRequest: (ids: string[], point: Point, screen: Point) => void;
  commandActive?: boolean;
  layerContext?: string;
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
  snapModes?: Readonly<SnapModes>;
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
    () =>
      visibilityProjection(
        detailEditorView(source, props.isolatedDetailId),
        props.layerContext ?? 'model',
        'visible',
      ),
    [source, props.isolatedDetailId, props.layerContext],
  );
  useEffect(
    () =>
      setCadDiagnosticScene({
        bars: source.bars.length,
        representations: source.details.length,
        masks: source.masks.length,
        maskPrimitives: source.masks.reduce(
          (n, m) => n + m.primitives.length,
          0,
        ),
      }),
    [source],
  );
  const capturable = useMemo(
    () =>
      visibilityProjection(project, props.layerContext ?? 'model', 'capture'),
    [project, props.layerContext],
  );
  const review = useMemo(() => {
    if (!visibilityState(source, props.layerContext ?? 'model').showHidden)
      return { lines: [] as Primitive[], issue: '' };
    try {
      return {
        lines: drawingPrimitives(
          visibilityReview(
            detailEditorView(source, props.isolatedDetailId),
            props.layerContext ?? 'model',
          ),
          source,
        ).map((p) => ({
          ...p,
          resolvedStyle: p.resolvedStyle
            ? { ...p.resolvedStyle, color: '#f59e0b', fill: 'none' as const }
            : undefined,
        })),
        issue: '',
      };
    } catch (e) {
      return {
        lines: [] as Primitive[],
        issue: `Realce indisponível: ${(e as Error).message} Use a lista de objetos para recuperar ou encerrar o realce.`,
      };
    }
  }, [source, props.layerContext, props.isolatedDetailId]);
  const ghosts = review.lines;
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
  const [hasMeasuredSize, setHasMeasuredSize] = useState(false);
  const [view, setRenderedView] = useState(
    props.initialState?.view ?? { x: 2800, y: -300, s: 0.12 },
  );
  // Logical input advances immediately; React receives only the latest frame.
  const camera = useRef(view);
  const cameraFrame = useFramePublisher(setRenderedView);
  const setView = (next: Camera | ((previous: Camera) => Camera)) => {
    camera.current = typeof next === 'function' ? next(camera.current) : next;
    cameraFrame.push(camera.current);
  };
  const [cursor, setCursor] = useState<Point | null>(null);
  const [snapPoint, setSnapPoint] = useState<SnapCandidate | null>(null);
  const [snapLimited, setSnapLimited] = useState(false);
  const [drag, setDrag] = useState<Pan | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [grip, setGrip] = useState<Grip | null>(null);
  const panInput = useRef<Pan | null>(null);
  const marqueeInput = useRef<Marquee | null>(null);
  const gripInput = useRef<Grip | null>(null);
  const space = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setHasMeasuredSize(true);
    });
    ro.observe(host.current);
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        e.target === document.body &&
        !e.defaultPrevented &&
        !modalIsOpen() &&
        !textComposition(e)
      ) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = () => {
      space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', up);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', up);
    };
  }, []);
  const drawable = (m: Mask) => {
    const items = maskPrimitives(m).map((item) =>
      stylePrimitive(source, m, item),
    );
    const paths = new Map<string, { d: string[]; item: Primitive }>();
    for (const p of items) {
      if (p.text || !p.points.length) continue;
      const key = JSON.stringify([p.layer, p.resolvedStyle, p.closed]);
      if (!paths.has(key)) paths.set(key, { d: [], item: p });
      paths
        .get(key)!
        .d.push(
          p.points.map((v, i) => `${i ? 'L' : 'M'}${v.x},${v.y}`).join(' ') +
            (p.closed ? ' Z' : ''),
        );
    }
    return {
      mask: m,
      items,
      capture: objectState(source, props.layerContext ?? 'model', m).capture,
      texts: items.filter((p) => p.text),
      paths: [...paths].map(([key, group]) => ({
        key,
        item: group.item,
        d: group.d.join(' '),
      })),
    };
  };
  const masks = useMemo(
    () => project.masks.map(drawable),
    [project.masks, source, props.layerContext],
  );
  /** Instances draw from the shared definition; they are not capturable mask entities. */
  const symbolDrawables = useMemo(
    () => symbolRenderMasks(project).map(drawable),
    [project.symbols, project.symbolInstances, source, props.layerContext],
  );
  const drawn = useMemo(
    () => [...masks, ...symbolDrawables],
    [masks, symbolDrawables],
  );

  const annotations = useMemo(
    () =>
      project.annotations.map((a) => ({
        annotation: a,
        items: annotationPrimitives(a, source).map((item) =>
          stylePrimitive(source, a, item),
        ),
      })),
    [project],
  );
  // Telas soldadas: o mesmo desenho das exportações (peças, fios, identificação).
  const meshes = useMemo(
    () =>
      (project.weldedMeshes ?? []).map((l) => ({
        launch: l,
        items: weldedMeshPrimitives(l).map((item) =>
          stylePrimitive(source, l, item),
        ),
      })),
    [project, source],
  );
  const barGeometries = useMemo(
    () => new Map(source.bars.map((b) => [b.id, geometry(b)])),
    [source.bars],
  );
  const barDefinitions = useMemo(
    () => new Map(source.bars.map((b) => [b.id, b])),
    [source.bars],
  );
  // Camera/cursor updates must not rebuild physical geometry, captions or insertions.
  // These caches are local to this canvas and invalidated by immutable project edits.
  const barPresentations = useMemo(
    () =>
      new Map(
        project.bars.map((b) => {
          // The helix body is drawn from its own projection; the back half,
          // axis and limits keep their own line styles.
          const helix =
            b.kind === 'helix' ? helixPrimitives(b, (q) => q) : undefined;
          const body = (item: Primitive) =>
            item.layer === 'ARMADURAS' && !item.style;
          return [
            b.id,
            {
              path: helix
                ? helix
                    .filter(body)
                    .map(
                      (item) =>
                        item.points
                          .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
                          .join(' ') + (item.closed ? ' Z' : ''),
                    )
                    .join(' ')
                : b.beamClamp
                  ? beamClampViewPoints(b)
                      .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
                      .join(' ')
                  : path(
                      (displayedBarGeometry(b) ?? barGeometries.get(b.id)!)
                        .segments,
                    ),
              lines: (helix ?? [])
                .filter((item) => !body(item))
                .map((item) => styledDrafting(source, b, item, 'ARMADURAS')),
              texts: physicalBarTextPrimitives(
                { ...b, origin: { x: 0, y: 0 }, rotation: 0 },
                source,
              ).map((item) =>
                b.drafting ? styledDrafting(source, b, item) : item,
              ),
              style: resolveStyle(source, b, 'ARMADURAS'),
              origins:
                b.distribution?.render === 'bars'
                  ? distributionOrigins(b)
                  : [b.origin],
            },
          ] as const;
        }),
      ),
    [project.bars, barGeometries, source],
  );
  const representations = useMemo(
    () =>
      project.details.flatMap((d) => {
        const b = barDefinitions.get(d.barId);
        return b
          ? [
              {
                detail: d,
                bar: b,
                items: representationPrimitives(b, d, source).map((item) =>
                  styledDrafting(source, d, item, 'REBATIMENTOS'),
                ),
              },
            ]
          : [];
      }),
    [project.details, barDefinitions, source],
  );
  const polylineItems = useMemo(
    () =>
      project.polylines.map((l) => ({
        line: l,
        item: stylePrimitive(source, l, { ...l, layer: 'DESENHO' }),
      })),
    [project.polylines, source.layers],
  );
  const distributions = useMemo(
    () =>
      project.bars
        .filter((b) => b.distribution)
        .map((b) => ({
          bar: b,
          items: distributionPrimitives(b, undefined, source).map((item) =>
            styledDrafting(source, b, item, 'ARMADURAS'),
          ),
        })),
    [project.bars, source],
  );
  const representationPoints = useMemo(
    () =>
      project.details.flatMap((d) => {
        const bar = barDefinitions.get(d.barId);
        return bar
          ? [
              ...insertedPoints(bar, d),
              ...(d.label
                ? representationPrimitives(bar, d, source)
                    .filter((p) => p.text)
                    .flatMap(primitiveBounds)
                : []),
            ]
          : [];
      }),
    [project.details, barDefinitions, barGeometries],
  );
  const staticPoints = useMemo(
    () => [
      ...projectPoints(project),
      ...ghosts.flatMap(primitiveBounds),
      ...representationPoints,
      ...annotations.flatMap((a) => a.items.flatMap(primitiveBounds)),
      ...drawn.flatMap((m) => m.items.flatMap(primitiveBounds)),
    ],
    [project, drawn, annotations, representationPoints, ghosts],
  );
  const previewPoints = useMemo(
    () => (props.previewLines ?? []).flatMap(primitiveBounds),
    [props.previewLines],
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
      const pts =
        bar.kind === 'helix'
          ? helixViewPoints(bar)
          : bar.beamClamp
            ? beamClampViewPoints(bar)
            : sampled(barGeometries.get(bar.id)!.segments);
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
    for (const m of drawn)
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
    drawn,
    props.isolatedDetailId,
  ]);
  const fit = () => {
    const b = bounds([
      ...staticPoints,
      ...previewPoints.map((p) =>
        props.previewTranslation ? add(p, props.previewTranslation) : p,
      ),
    ]);
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
    getState: () => ({ view: camera.current, overview: overview.current }),
    zoom: (f) =>
      setView((v) => ({ ...v, s: Math.max(0.000001, Math.min(20, v.s * f)) })),
  }));
  const initialMaskCount = useRef(project.masks.length);
  const cameraContext = useRef<{
    projectId: string;
    detailId?: string;
    masks: number;
    measured: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const previous = cameraContext.current;
    const scopeChanged =
      !previous ||
      previous.projectId !== project.id ||
      previous.detailId !== props.isolatedDetailId;
    const autoFitChanged =
      !previous ||
      previous.projectId !== project.id ||
      previous.masks !== project.masks.length ||
      (!previous.measured && hasMeasuredSize);
    cameraContext.current = {
      projectId: project.id,
      detailId: props.isolatedDetailId,
      masks: project.masks.length,
      measured: hasMeasuredSize,
    };

    // Scope and mask-count changes belong to one camera transition. A passive
    // auto-fit must never overwrite the saved overview after leaving isolation.
    if (scopeChanged) {
      panInput.current = null;
      gripInput.current = null;
      marqueeInput.current = null;
      setGrip(null);
      setDrag(null);
      setMarquee(null);
      if (!previous && props.initialState) return;
      if (props.isolatedDetailId) {
        if (!overview.current || overview.current.projectId !== project.id)
          overview.current = { projectId: project.id, view: camera.current };
        if (hasMeasuredSize) fit();
        return;
      }
      const saved = overview.current;
      overview.current = null;
      if (saved?.projectId === project.id) {
        setView(saved.view);
        return;
      }
    }
    // The first measurement can equal the 900 px placeholder. Later resizes
    // (including Focus) preserve navigation rather than implicitly fitting it.
    if (
      hasMeasuredSize &&
      autoFitChanged &&
      size.w > 0 &&
      (!props.initialState || project.masks.length !== initialMaskCount.current)
    )
      fit();
  }, [
    props.isolatedDetailId,
    project.id,
    project.masks.length,
    hasMeasuredSize,
  ]);
  const scr = (p: Point) => ({
    x: (p.x - view.x) * view.s + size.w / 2,
    y: (view.y - p.y) * view.s + size.h / 2,
  });
  const fromScreen = (p: Point) => modelPoint(camera.current, size, p);
  const eventScreen = (e: { clientX: number; clientY: number }) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const linework = useMemo(
    () => [
      ...masks.flatMap((m) =>
        m.items.filter(
          (p) =>
            !p.text &&
            m.capture &&
            (!p.layerId ||
              layerState(source, props.layerContext ?? 'model', p.layerId)
                .capture),
        ),
      ),
      ...capturable.polylines.map((p) => ({
        ...p,
        points: p.closed ? [...p.points, p.points[0]] : p.points,
      })),
      ...annotations
        .filter(
          (a) =>
            objectState(source, props.layerContext ?? 'model', a.annotation)
              .capture,
        )
        .flatMap((a) => a.items.filter((p) => !p.text)),
      ...capturable.bars.map((b) => ({
        points: (b.kind === 'helix'
          ? helixViewPoints(b)
          : b.beamClamp
            ? beamClampViewPoints(b)
            : sampled(geometry(b).segments)
        ).map((v) => world(v, b)),
      })),
    ],
    [masks, capturable, annotations],
  );
  const snapSources = useMemo(() => {
    const sources: SnapSource[] = [];
    const addPath = (id: string, points: Point[], closed = false) => {
      try {
        sources.push({ id, curve: pathCurve(points, closed) });
      } catch {
        /* No usable finite curve. */
      }
    };
    for (const m of masks) {
      if (!m.capture || !m.mask.visible) continue;
      let visibleIndex = 0;
      m.mask.primitives.forEach((p, i) => {
        if (m.mask.layers[p.layer] === false) return;
        const rendered = m.items[visibleIndex++];
        if (
          !rendered ||
          (rendered.layerId &&
            !layerState(source, props.layerContext ?? 'model', rendered.layerId)
              .capture)
        )
          return;
        sources.push(maskSnapSource(m.mask, p, i));
      });
    }
    for (const p of capturable.polylines)
      addPath(`polyline:${p.id}`, p.points, !!p.closed);
    for (const a of annotations) {
      if (
        !objectState(source, props.layerContext ?? 'model', a.annotation)
          .capture
      )
        continue;
      a.items.forEach((p, i) => {
        if (!p.text)
          addPath(`annotation:${a.annotation.id}:${i}`, p.points, !!p.closed);
      });
    }
    for (const b of capturable.bars) {
      if (b.kind === 'helix' || b.beamClamp) {
        addPath(
          `bar:${b.id}`,
          (b.kind === 'helix'
            ? helixViewPoints(b)
            : beamClampViewPoints(b)
          ).map((v) => world(v, b)),
        );
        continue;
      }
      barGeometries.get(b.id)!.segments.forEach((s, i) => {
        const id = `bar:${b.id}:${i}`;
        if (s.type === 'line') addPath(id, [world(s.a, b), world(s.b, b)]);
        else
          try {
            sources.push({
              id,
              curve: roundCurve(
                world(s.center, b),
                s.radius,
                s.startAngle + (b.rotation * Math.PI) / 180,
                s.angle,
              ),
            });
          } catch {
            /* Invalid bend. */
          }
      });
    }
    return sources;
  }, [
    masks,
    capturable,
    annotations,
    barGeometries,
    source,
    props.layerContext,
  ]);
  const snapIndex = useMemo(
    () => createSnapIndex(snapSources, linework),
    [snapSources, linework],
  );
  const snapModes = props.snapModes ?? defaultSnapModes;
  const snapBase =
    props.snapBase === null ? undefined : (props.snapBase ?? draft.at(-1));
  const guideActive =
    !props.maskSidePick &&
    !props.maskEditing &&
    !['select', 'pan', 'follow', 'convert'].includes(tool) &&
    (!!props.nativeDrawing || ['bar', 'polyline'].includes(tool) || !!snapBase);
  const acquiredRef = useRef<SnapAcquisition>({});
  const [acquired, setAcquired] = useState<SnapAcquisition>({});
  const publishSnap = (feedback: SnapFeedback) => {
    setSnapPoint(feedback.candidate);
    setSnapLimited(feedback.limited);
    setAcquired((old) =>
      old.extension?.id === feedback.acquired.extension?.id &&
      old.extension?.end === feedback.acquired.extension?.end &&
      old.parallel?.id === feedback.acquired.parallel?.id
        ? old
        : feedback.acquired,
    );
  };
  const snapFeedback = useRef<SnapFeedback>({
    candidate: null,
    limited: false,
    acquired: {},
  });
  const feedbackFrame = useFramePublisher<PointerFeedback>((feedback) => {
    if (feedback.started !== undefined)
      recordCadWork('pointer.feedback', performance.now() - feedback.started);
    setCursor(feedback.point);
    publishSnap(feedback.snap);
    setMarquee(marqueeInput.current);
    setGrip(gripInput.current);
    measureCadWork('cursor.consumer', () => props.onCursor(feedback.point));
    if (props.maskSidePick)
      props.onMaskEntityHover?.(undefined, feedback.raw, 3 / camera.current.s);
    if (props.maskEditing?.stage === 'targets') {
      const state = props.maskEditing;
      const hit = hitMaskCadEntity(
        state.entities,
        feedback.raw,
        10 / camera.current.s,
        (entity) =>
          entity.mask.id === state.targetMaskId &&
          (!state.selectedTarget || state.selectedTarget === entity.ref.key),
      );
      props.onMaskEntityHover?.(hit?.ref, feedback.raw);
    }
  });
  useLayoutEffect(() => {
    // A queued frame belongs to this immutable scene and command, never the next.
    feedbackFrame.cancel();
    panInput.current = null;
    gripInput.current = null;
    marqueeInput.current = null;
    setDrag(null);
    setGrip(null);
    setMarquee(null);
    return () => feedbackFrame.cancel();
  }, [
    source,
    tool,
    props.layerContext,
    props.snapContext,
    props.maskSidePick,
    props.maskEditing?.stage,
    props.maskEditing?.targetMaskId,
  ]);
  useLayoutEffect(() => {
    feedbackFrame.cancel();
    acquiredRef.current = {};
    setAcquired({});
  }, [
    snap,
    snapModes,
    snapIndex,
    tool,
    snapBase?.x,
    snapBase?.y,
    props.snapContext,
    props.snapLinear,
    guideActive,
    ortho,
  ]);
  useEffect(() => {
    setSnapPoint(null);
    setSnapLimited(false);
  }, [
    snap,
    snapModes,
    snapIndex,
    tool,
    view,
    size,
    snapBase?.x,
    snapBase?.y,
    props.snapContext,
  ]);
  const snapAt = (raw: Point, immediate = true) =>
    measureCadWork('snap', () => {
      const guideOptions = {
        enabled: snap,
        active: guideActive,
        modes: snapModes,
        tolerance: 10 / camera.current.s,
        base: snapBase,
        linear: !!props.snapLinear,
      };
      const next = acquireSnapGuides(
        snapIndex,
        raw,
        acquiredRef.current,
        guideOptions,
      );
      // Acquisition consumes every input, even when presentation is coalesced.
      acquiredRef.current = next;
      const result = resolveObjectSnap(snapIndex, raw, {
        enabled: snap,
        modes: snapModes,
        tolerance: 10 / camera.current.s,
        extra: props.extraSnapPoints,
        base: snapBase,
        guides: snapGuideCandidates(snapIndex, next, raw, guideOptions),
      });
      let target = result.candidate;
      let p = target?.point ?? raw;
      if (ortho && draft.length) {
        const a = draft.at(-1)!;
        p =
          Math.abs(p.x - a.x) >= Math.abs(p.y - a.y)
            ? { x: p.x, y: a.y }
            : { x: a.x, y: p.y };
        if (target && distance(p, target.point) > 0.001) target = undefined;
      }
      snapFeedback.current = {
        candidate: target ?? null,
        limited: result.limited,
        acquired: next,
      };
      if (immediate) publishSnap(snapFeedback.current);
      return p;
    });
  const hitAt = (p: Point) => {
    let hit: string | undefined,
      best = 9 / camera.current.s;
    for (const b of capturable.bars) {
      const origins =
        b.distribution?.render === 'bars' ? distributionOrigins(b) : [b.origin];
      for (const origin of origins) {
        const chains =
          b.kind === 'helix'
            ? helixOutline(b)
            : [
                b.beamClamp
                  ? beamClampViewPoints(b)
                  : sampled(barGeometries.get(b.id)!.segments),
              ];
        for (const chain of chains) {
          const ps = chain.map((v) => world(v, { ...b, origin }));
          for (let i = 1; i < ps.length; i++) {
            const d = distance(p, nearest(p, ps[i - 1], ps[i]));
            if (d < best) {
              best = d;
              hit = b.id;
            }
          }
        }
      }
    }
    for (const object of [
      ...capturable.polylines.map((l) => ({
        id: l.id,
        items: [
          {
            ...l,
            layer: 'DESENHO',
            points: l.closed ? [...l.points, l.points[0]] : l.points,
          },
        ],
      })),
      ...annotations
        .filter(
          (a) =>
            objectState(source, props.layerContext ?? 'model', a.annotation)
              .capture,
        )
        .map((a) => ({ id: a.annotation.id, items: a.items })),
      // Tela: qualquer linha dela (peças, fios) ou a identificação.
      ...meshes
        .filter(({ launch }) =>
          (capturable.weldedMeshes ?? []).some((l) => l.id === launch.id),
        )
        .map(({ launch, items }) => ({ id: launch.id, items })),
    ]) {
      for (const item of object.items) {
        if ('text' in item && item.text) {
          if (distance(p, item.points[0]) < 14 / camera.current.s) {
            hit = object.id;
            best = 0;
          }
          continue;
        }
        for (let i = 1; i < item.points.length; i++) {
          const d = distance(p, nearest(p, item.points[i - 1], item.points[i]));
          if (d < best) {
            best = d;
            hit = object.id;
          }
        }
      }
    }
    if (!hit) {
      for (const d of capturable.details) {
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
          p.x >= b.x - 12 / camera.current.s &&
          p.x <= b.right + 12 / camera.current.s &&
          p.y >= b.y - 12 / camera.current.s &&
          p.y <= b.top + 24 / camera.current.s,
      );
      if (box)
        hit = Object.keys(source.hierarchy.objectDetails).find(
          (id) => source.hierarchy.objectDetails[id] === box.id,
        );
    }
    if (!hit)
      for (const m of drawn) {
        if (!m.capture) continue;
        for (const item of m.items) {
          if (
            item.layerId &&
            !layerState(source, props.layerContext ?? 'model', item.layerId)
              .capture
          )
            continue;
          for (let i = 1; i < item.points.length; i++)
            if (
              distance(p, nearest(p, item.points[i - 1], item.points[i])) < best
            ) {
              hit = m.mask.id;
              best = distance(
                p,
                nearest(p, item.points[i - 1], item.points[i]),
              );
            }
          if (item.text && distance(p, item.points[0]) < best) {
            hit = m.mask.id;
            best = 0;
          }
        }
      }
    return hit;
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const panning = e.button === 1 || tool === 'pan' || space.current;
    if (panning) feedbackFrame.cancel();
    else feedbackFrame.flush();
    cameraFrame.flush();
    const screen = eventScreen(e);
    svg.current?.setPointerCapture(e.pointerId);
    if (panning) {
      panInput.current = { screen, view: camera.current };
      setDrag(panInput.current);
      return;
    }
    const p = snapAt(fromScreen(screen));
    if (props.maskSidePick) {
      props.onMaskEntityPick?.(
        undefined,
        fromScreen(screen),
        3 / camera.current.s,
      );
      return;
    }
    if (props.maskEditing) {
      const at = fromScreen(screen),
        state = props.maskEditing;
      const hit = hitMaskCadEntity(
        state.entities,
        at,
        10 / camera.current.s,
        (e) =>
          state.stage === 'limits' ||
          (e.mask.id === state.targetMaskId &&
            (!state.selectedTarget || state.selectedTarget === e.ref.key)),
      );
      props.onMaskEntityPick?.(hit?.ref, at, 3 / camera.current.s);
      return;
    }
    if (tool === 'select') {
      for (const b of capturable.bars.filter(
        (b) =>
          objectState(source, props.layerContext ?? 'model', b).editable &&
          selected.includes(b.id) &&
          b.kind === 'free' &&
          individual(b.id),
      ))
        for (let i = 0; i < b.points.length; i++)
          if (distance(world(b.points[i], b), p) < 9 / camera.current.s) {
            gripInput.current = { id: b.id, index: i, point: p };
            setGrip(gripInput.current);
            return;
          }
      for (const m of masks.filter(
        (m) =>
          m.capture &&
          objectState(source, props.layerContext ?? 'model', m.mask).editable,
      )) {
        for (const item of m.items) {
          if (
            item.layerId &&
            (!layerState(source, props.layerContext ?? 'model', item.layerId)
              .capture ||
              !layerState(source, props.layerContext ?? 'model', item.layerId)
                .editable)
          )
            continue;
          const points = item.closed
            ? [...item.points, item.points[0]]
            : item.points;
          if (
            item.id &&
            item.native &&
            (item.native.kind === 'text'
              ? insideTextBox(
                  p,
                  paperPrimitiveBounds(item),
                  4 / camera.current.s,
                )
              : points.some(
                  (v, i) =>
                    i &&
                    distance(p, nearest(p, points[i - 1], v)) <
                      9 / camera.current.s,
                ))
          ) {
            props.onNativePick?.(m.mask.id, item.id);
            return;
          }
        }
      }
      const hit = hitAt(p);
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
        marqueeInput.current = { start: p, end: p };
        setMarquee(marqueeInput.current);
      }
    } else if (tool === 'follow') {
      if (props.followInteraction?.mode === 'side') {
        // Side picking uses the actual model point, never a snap projected onto the face.
        onPoint(fromScreen(screen));
        return;
      }
      let best = 12 / camera.current.s,
        hit: FollowEdge | undefined;
      for (const edge of props.followInteraction?.available ?? []) {
        const d = distance(
          fromScreen(screen),
          nearest(fromScreen(screen), edge.a, edge.b),
        );
        if (d < best) {
          best = d;
          hit = edge;
        }
      }
      if (hit) props.onFollowEdge?.(hit.key);
    } else if (tool === 'convert') {
      let best = 16 / camera.current.s,
        hit: Primitive | undefined,
        polylineId: string | undefined;
      for (const m of masks)
        for (const item of m.items) {
          if (
            !m.capture ||
            (item.layerId &&
              !layerState(source, props.layerContext ?? 'model', item.layerId)
                .capture)
          )
            continue;
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
        for (const item of capturable.polylines.filter((l) =>
          individual(l.id),
        )) {
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
  const move = (e: React.PointerEvent<SVGSVGElement>) =>
    measureCadWork('pointer.handler', () => {
      const started = cadDiagnosticNow();
      const screen = eventScreen(e);
      const pan = panInput.current;
      if (pan) {
        setView(panCamera(pan.view, pan.screen, screen));
        return;
      }
      const raw = fromScreen(screen);
      const p = props.maskSidePick ? raw : snapAt(raw, false);
      if (marqueeInput.current)
        marqueeInput.current = { ...marqueeInput.current, end: p };
      if (gripInput.current)
        gripInput.current = { ...gripInput.current, point: p };
      feedbackFrame.push({
        point: p,
        raw,
        snap: props.maskSidePick
          ? { candidate: null, limited: false, acquired: acquiredRef.current }
          : snapFeedback.current,
        started,
      });
    });
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    // Read the release itself, rather than whichever move React last rendered.
    if (panInput.current || gripInput.current || marqueeInput.current) move(e);
    cameraFrame.flush();
    feedbackFrame.flush();
    const grip = gripInput.current;
    const marquee = marqueeInput.current;
    if (grip) {
      const b = capturable.bars.find((b) => b.id === grip.id);
      if (b)
        props.onBarChange(b.id, {
          points: b.points.map((p, i) =>
            i === grip.index ? local(grip.point, b) : p,
          ),
        });
      setGrip(null);
    }
    if (marquee) {
      const box = bounds([marquee.start, marquee.end]);
      if (box.width + box.height > 5 / camera.current.s) {
        const inside = (p: Point) =>
          p.x >= box.x &&
          p.x <= box.x + box.width &&
          p.y >= box.y &&
          p.y <= box.y + box.height;
        const ids = [
          ...capturable.details
            .filter((d) => {
              const b = barDefinitions.get(d.barId);
              return b && insertedPoints(b, d).every(inside);
            })
            .map((d) => d.id),
          ...capturable.bars
            .filter((b) =>
              (b.kind === 'helix'
                ? helixViewPoints(b)
                : b.beamClamp
                  ? beamClampViewPoints(b)
                  : vertices(b)
              )
                .map((p) => world(p, b))
                .every(inside),
            )
            .map((b) => b.id),
          ...capturable.polylines
            .filter((l) => l.points.every(inside))
            .map((l) => l.id),
          ...capturable.annotations
            .filter((a) => a.points.every(inside))
            .map((a) => a.id),
          ...(capturable.weldedMeshes ?? [])
            .filter((l) => l.region.outer.every(inside))
            .map((l) => l.id),
        ];
        setSelected(e.shiftKey ? [...new Set([...selected, ...ids])] : ids);
      }
      setMarquee(null);
    }
    panInput.current = null;
    gripInput.current = null;
    marqueeInput.current = null;
    setDrag(null);
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
  };
  const cancelInput = () => {
    feedbackFrame.cancel();
    // Camera changes are navigation, not a project edit. Keep their latest pose.
    cameraFrame.flush();
    panInput.current = null;
    gripInput.current = null;
    marqueeInput.current = null;
    setDrag(null);
    setGrip(null);
    setMarquee(null);
  };
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelInput();
      else if (
        event.key === 'Enter' &&
        !modalIsOpen() &&
        !textComposition(event)
      )
        flushSync(() => {
          feedbackFrame.flush();
          cameraFrame.flush();
        });
    };
    window.addEventListener('blur', cancelInput);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('blur', cancelInput);
      window.removeEventListener('keydown', key, true);
    };
  });
  const stroke = 1 / view.s;
  const groupLabelSize = 11 / view.s; // Navigation overlay only; excluded from output.
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
    const style = isDetail
      ? resolveStyle(source, {}, 'REBATIMENTOS')
      : barPresentations.get(b.id)!.style;
    const barPath =
      grip?.id === b.id ? path(g.segments) : barPresentations.get(b.id)!.path;
    const color = g.errors.length ? '#e76472' : style.color;
    const tr = `translate(${origin.x} ${origin.y}) rotate(${isDetail ? 0 : b.rotation})`;
    return (
      <g
        key={`${b.id}-${isDetail ? 'detail' : 'bar'}-${origin.x}-${origin.y}`}
        transform={tr}
        data-bar-id={isDetail ? undefined : b.id}
        data-layer-id={b.layerId ?? 'layer:ARMADURAS'}
      >
        {active && (
          <path
            d={barPath}
            fill="none"
            stroke={color}
            strokeWidth={8 * stroke}
            opacity="0.15"
          />
        )}
        <path
          d={barPath}
          fill="none"
          stroke={color}
          strokeWidth={
            Math.max(active ? 2.7 : 1, (style.lineWidth * 96) / 25.4) * stroke
          }
          strokeDasharray={dashArray(style).join(' ') || undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {!isDetail &&
          renderPrimitives(barPresentations.get(b.id)!.lines, color)}
        {renderPrimitives(
          (grip?.id === b.id
            ? physicalBarTextPrimitives(
                { ...edited, origin: { x: 0, y: 0 }, rotation: 0 },
                source,
              )
            : barPresentations.get(b.id)!.texts
          )
            .map((item) =>
              b.drafting ? styledDrafting(source, b, item) : item,
            )
            .filter((item) =>
              (item.role ?? item.layer) === 'IDENTIFICACAO'
                ? showLabel
                : props.showDimensions,
            ),
          color,
        )}
        {active &&
          !isDetail &&
          objectState(source, props.layerContext ?? 'model', b).editable &&
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
            fill={item.resolvedStyle?.color ?? color}
            textRendering="geometricPrecision"
            fontSize={item.textHeight ?? 40}
            {...svgTextFont(item)}
            textAnchor={
              item.textAlign === 'right'
                ? 'end'
                : item.textAlign === 'center' ||
                    (!item.textAlign &&
                      ((item.role ?? item.layer) === 'COTAS' ||
                        (item.role ?? item.layer) === 'DISTRIBUICAO'))
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
          fill={
            item.closed && item.resolvedStyle?.fill === 'solid'
              ? item.resolvedStyle.fillColor
              : 'none'
          }
          stroke={item.resolvedStyle?.color ?? color}
          strokeWidth={
            Math.max(
              active ? 2.4 : 1,
              ((item.resolvedStyle?.lineWidth ?? 0.18) * 96) / 25.4,
            ) * stroke
          }
          strokeDasharray={dashArray(item.resolvedStyle).join(' ') || undefined}
          data-layer-id={item.layerId}
          strokeLinecap="round"
        />
      ),
    );
  // Reuse the SVG element tree during cursor motion and pan. Zoom only changes
  // screen-sized strokes/handles; model geometry and text heights stay untouched.
  // Dependencies enumerate values captured by the render helpers above; using the
  // helpers themselves would invalidate these trees on every pointer event.
  const maskContent = useMemo(
    () => (
      <>
        {drawn.map(({ mask, texts, paths, capture }) => (
          <g
            key={mask.id}
            data-mask-id={mask.id}
            opacity={mask.opacity}
            fill="none"
            stroke={light ? '#7e899b' : '#8090aa'}
            strokeWidth={stroke}
          >
            {paths.map(({ key, item, d }) => (
              <path
                key={key}
                d={d}
                data-layer-id={item.layerId}
                strokeLinecap="round"
                stroke={
                  mask.id === props.highlightedMaskId
                    ? '#38bdf8'
                    : props.maskEditing?.all &&
                        capture &&
                        (!item.layerId ||
                          layerState(
                            source,
                            props.layerContext ?? 'model',
                            item.layerId,
                          ).capture)
                      ? '#c084fc'
                      : item.resolvedStyle?.color
                }
                strokeWidth={
                  Math.max(
                    mask.id === props.highlightedMaskId ? 2.5 : 1,
                    ((item.resolvedStyle?.lineWidth ?? 0.18) * 96) / 25.4,
                  ) * stroke
                }
                strokeDasharray={
                  dashArray(item.resolvedStyle).join(' ') || undefined
                }
                fill={
                  item.closed && item.resolvedStyle?.fill === 'solid'
                    ? item.resolvedStyle.fillColor
                    : 'none'
                }
              />
            ))}
            {texts.map((p, i) => (
              <g
                key={i}
                transform={`translate(${p.points[0].x} ${p.points[0].y}) rotate(${p.textRotation ?? 0}) scale(1 -1)`}
              >
                <text
                  fill={
                    mask.id === props.highlightedMaskId
                      ? '#38bdf8'
                      : (p.resolvedStyle?.color ??
                        (light ? '#7e899b' : '#8090aa'))
                  }
                  stroke="none"
                  textRendering="geometricPrecision"
                  fontSize={p.textHeight}
                  {...svgTextFont(p)}
                  data-free-text={p.native?.kind === 'text' ? p.id : undefined}
                  textAnchor={
                    p.textAlign === 'center'
                      ? 'middle'
                      : p.textAlign === 'right'
                        ? 'end'
                        : 'start'
                  }
                >
                  {p.text}
                </text>
              </g>
            ))}
          </g>
        ))}
      </>
    ),
    [
      drawn,
      light,
      stroke,
      props.highlightedMaskId,
      props.maskEditing?.all,
      props.layerContext,
      source,
    ],
  );
  const objectContent = useMemo(
    () => (
      <>
        {polylineItems.map(({ line: l, item }) => (
          <g key={l.id} data-testid="cad-polyline">
            {renderPrimitives(
              [item],
              selected.includes(l.id) ? '#58bce8' : l.color,
              selected.includes(l.id),
            )}
          </g>
        ))}
        {project.bars.flatMap((b) =>
          barPresentations
            .get(b.id)!
            .origins.map((origin, i) => renderBar(b, origin, false, i === 0)),
        )}
        {annotations.map(({ annotation: a, items }) => (
          <g key={a.id} data-testid="cad-annotation" data-kind={a.kind}>
            {renderPrimitives(
              items,
              selected.includes(a.id) ? '#58bce8' : light ? '#394861' : a.color,
              selected.includes(a.id),
            )}
          </g>
        ))}
        {meshes.map(({ launch: l, items }) => (
          <g key={l.id} data-testid="cad-welded-mesh" data-mesh-id={l.id}>
            {renderPrimitives(
              items,
              selected.includes(l.id)
                ? '#58bce8'
                : light
                  ? '#394861'
                  : '#4a88ff',
              selected.includes(l.id),
            )}
          </g>
        ))}
        {representations.map(({ detail: d, bar: b, items }) => {
          return (
            <g key={d.id} data-representation-id={d.id}>
              {renderPrimitives(
                items.filter(
                  (item) =>
                    props.showDimensions ||
                    (item.role ?? item.layer) !== 'COTAS',
                ),
                b.color,
                selected.includes(d.id),
              )}
            </g>
          );
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
              fontSize={groupLabelSize}
            >
              {box.name}
            </text>
          </g>
        ))}
        {distributions.map(({ bar: b, items }) => (
          <g key={b.id} data-testid="cad-distribution">
            {renderPrimitives(items, b.color)}
          </g>
        ))}
      </>
    ),
    [
      source,
      project,
      annotations,
      barDefinitions,
      barGeometries,
      barPresentations,
      meshes,
      representations,
      polylineItems,
      distributions,
      groupBoxes,
      selected,
      grip,
      stroke,
      light,
      props.showDimensions,
      props.layerContext,
      props.isolatedDetailId,
      groupedIds,
    ],
  );
  const gridStep = 10 ** Math.ceil(Math.log10(55 / view.s));
  const origin = scr({ x: 0, y: 0 });
  return (
    <div className={`cad-host ${light ? 'cad-light' : ''}`} ref={host}>
      {snapLimited && (
        <div className="visibility-warning" role="status">
          Busca de interseções limitada nesta abertura. Aproxime o zoom para
          reduzir as referências próximas.
        </div>
      )}
      {review.issue && (
        <div className="visibility-warning" role="status">
          {review.issue}
        </div>
      )}
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
        onPointerCancel={cancelInput}
        onLostPointerCapture={cancelInput}
        onContextMenu={(e) => {
          e.preventDefault();
          feedbackFrame.flush();
          cameraFrame.flush();
          if (
            props.commandActive ||
            !['select', 'pan'].includes(tool) ||
            draft.length
          ) {
            props.onFinish();
            return;
          }
          const point = fromScreen(eventScreen(e)),
            hit = hitAt(point);
          const ids =
            hit && !selected.includes(hit)
              ? toggleDetailSelection(
                  source,
                  [],
                  hit,
                  false,
                  props.isolatedDetailId,
                )
              : selected;
          if (hit && !selected.includes(hit)) setSelected(ids);
          props.onContextRequest(ids, point, { x: e.clientX, y: e.clientY });
        }}
        onWheel={(e) => {
          feedbackFrame.cancel();
          const screen = eventScreen(e);
          setView(zoomCamera(camera.current, size, screen, e.deltaY));
          if (panInput.current)
            panInput.current = { screen, view: camera.current };
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
          {maskContent}
          {props.followInteraction && (
            <g pointerEvents="none" data-testid="follow-preview">
              <g
                data-testid="follow-reference-selection"
                stroke="#f59e0b"
                strokeWidth={3 * stroke}
              >
                {props.followInteraction.selected.map((edge, index) => {
                  const order = props.followInteraction!.chain?.order.indexOf(
                    edge.key,
                  );
                  return (
                    <g key={edge.key}>
                      <line
                        x1={edge.a.x}
                        y1={edge.a.y}
                        x2={edge.b.x}
                        y2={edge.b.y}
                      />
                      <text
                        x={0}
                        y={0}
                        stroke="none"
                        fill="#f59e0b"
                        fontSize={12 * stroke}
                        transform={`translate(${(edge.a.x + edge.b.x) / 2} ${(edge.a.y + edge.b.y) / 2}) scale(1 -1)`}
                      >
                        {order === undefined ? index + 1 : order + 1}
                      </text>
                    </g>
                  );
                })}
              </g>
              {props.followInteraction.chain?.adjustments.map((a, i) => (
                <circle
                  key={i}
                  cx={a.adjusted.x}
                  cy={a.adjusted.y}
                  r={4 * stroke}
                  fill="#f97316"
                />
              ))}
              {props.followInteraction.sidePoint && (
                <circle
                  data-testid="follow-side-point"
                  cx={props.followInteraction.sidePoint.x}
                  cy={props.followInteraction.sidePoint.y}
                  r={5 * stroke}
                  fill="#38bdf8"
                />
              )}
              {props.followInteraction.preview && (
                <g data-testid="follow-physical-preview">
                  <path
                    d={path(props.followInteraction.preview.worldSegments)}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={props.followInteraction.preview.bar.diameter}
                    opacity={0.3}
                  />
                  <path
                    d={path(props.followInteraction.preview.worldSegments)}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={2 * stroke}
                  />
                </g>
              )}
            </g>
          )}
          {props.maskCadOverlay && (
            <g pointerEvents="none">
              <g data-testid="mask-cad-limits">
                <CadPreview
                  lines={props.maskCadOverlay.limits}
                  stroke={stroke}
                  active
                />
              </g>
              <g data-testid="mask-cad-preview">
                {renderPrimitives(
                  props.maskCadOverlay.change,
                  props.maskCadOverlay.mode === 'trim' ? '#fb7185' : '#4ade80',
                  true,
                )}
              </g>
            </g>
          )}
          {props.mirrorAxis &&
            (() => {
              const { base, end } = props.mirrorAxis,
                dx = end.x - base.x,
                dy = end.y - base.y,
                n = Math.hypot(dx, dy);
              if (n < 0.01) return null;
              const length =
                (Math.hypot(size.w, size.h) / view.s +
                  Math.hypot(view.x - base.x, view.y - base.y)) *
                2;
              return (
                <line
                  data-testid="mirror-axis"
                  x1={base.x - (dx / n) * length}
                  y1={base.y - (dy / n) * length}
                  x2={base.x + (dx / n) * length}
                  y2={base.y + (dy / n) * length}
                  stroke="#f59e0b"
                  strokeWidth={1 / view.s}
                  strokeDasharray={`${8 / view.s} ${5 / view.s}`}
                  pointerEvents="none"
                />
              );
            })()}
          {props.previewLines && (
            <g
              data-testid="transform-preview"
              pointerEvents="none"
              opacity="0.85"
            >
              <g
                transform={
                  props.previewTranslation
                    ? `translate(${props.previewTranslation.x} ${props.previewTranslation.y})`
                    : undefined
                }
                data-testid="preview-pose"
              >
                <CadPreview lines={props.previewLines} stroke={stroke} />
              </g>
              {props.previewBase && (
                <circle
                  cx={props.previewBase.x}
                  cy={props.previewBase.y}
                  r={6 * stroke}
                  fill="none"
                  stroke="#c084fc"
                  strokeWidth={stroke}
                />
              )}
            </g>
          )}
          {ghosts.length > 0 && (
            <g
              data-testid="hidden-object-ghosts"
              pointerEvents="none"
              opacity="0.7"
            >
              {renderPrimitives(ghosts, '#f59e0b')}
            </g>
          )}
          {objectContent}
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
                    annotationCadDefaults(project, {
                      id: 'preview',
                      kind: tool as import('../domain/types').AnnotationKind,
                      ...(props.dimensionPresentation
                        ? { dimensionPresentation: props.dimensionPresentation }
                        : {}),
                      points: [...draft, cursor],
                      label: '',
                      textHeight: 50,
                      color: '#50cddd',
                    }),
                    project,
                  ),
                  '#50cddd',
                )}
              </g>
            )}
          {!props.nativeDrawing && draft.length > 0 && cursor && (
            <g
              data-testid="draft-rubber-band"
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
          {snap &&
            guideActive &&
            Object.entries(acquired).map(([kind, ref]) => {
              const entry = ref && snapIndex.entries.get(ref.id);
              return entry ? (
                <path
                  key={kind}
                  data-testid="snap-reference"
                  data-kind={kind}
                  d={snapGuidePath(entry.curve)}
                  fill="none"
                  stroke={light ? '#087b66' : '#44dec0'}
                  strokeWidth={2 * stroke}
                  opacity="0.65"
                  pointerEvents="none"
                />
              ) : null;
            })}
          {snap && snapPoint?.guide && (
            <path
              data-testid="snap-guide"
              data-snap-mode={snapPoint.mode}
              d={snapGuidePath(snapPoint.guide)}
              fill="none"
              stroke={light ? '#087b66' : '#44dec0'}
              strokeWidth={1.5 * stroke}
              strokeDasharray={`${6 * stroke} ${4 * stroke}`}
              pointerEvents="none"
            />
          )}
          {snap && snapPoint && (
            <g
              data-testid="snap-marker"
              data-snap-mode={snapPoint.mode}
              data-x={snapPoint.point.x}
              data-y={snapPoint.point.y}
              transform={`translate(${snapPoint.point.x} ${snapPoint.point.y}) scale(${stroke})`}
              pointerEvents="none"
            >
              <path
                d={
                  snapPoint.mode === 'midpoint'
                    ? 'M0 6L-6 -5H6Z'
                    : snapPoint.mode === 'quadrant'
                      ? 'M0 7L7 0L0 -7L-7 0Z'
                      : snapPoint.mode === 'intersection'
                        ? 'M-6 -6L6 6M-6 6L6 -6'
                        : snapPoint.mode === 'center' ||
                            snapPoint.mode === 'geometricCenter'
                          ? 'M-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M-8 0H8M0 -8V8'
                          : 'M-5 -5H5V5H-5Z'
                }
                fill="none"
                stroke={light ? '#087b66' : '#44dec0'}
                strokeWidth="1.2"
              />
              <text
                transform="scale(1 -1)"
                x="12"
                y="-10"
                fontSize="11"
                fill={light ? '#087b66' : '#44dec0'}
              >
                {snapPoint.mode === 'extra'
                  ? 'Prévia'
                  : snapModeLabels[snapPoint.mode]}
              </text>
            </g>
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
      {!props.commandActive &&
        !props.previewLines?.length &&
        project.bars.length === 0 &&
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
