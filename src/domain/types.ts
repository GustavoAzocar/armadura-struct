export type DrawingStyle = {
  color: string;
  /** Signed dash/gap lengths in model mm; zero denotes a dot. */
  lineType: { name: string; pattern: number[] };
  lineScale: number;
  /** Pen width in paper mm, independent of model scale. */
  lineWidth: number;
  fill: 'none' | 'solid';
  fillColor: string;
};
/** Plot patterns and widths are in paper mm, independently of model/view scale. */
export type PlotStyle = Partial<
  Pick<
    DrawingStyle,
    'color' | 'fillColor' | 'lineWidth' | 'lineType' | 'lineScale'
  >
> & { include?: boolean };
export type PlotSettings = {
  preset: 'color' | 'monochrome' | 'grayscale';
  referenceScale: number;
};
export type DraftingAppearance = {
  distributionHeight?: number;
  dimensions?: { layerId?: string; style?: Partial<DrawingStyle> };
  height: number;
  dimensionHeight: number;
  align?: 'left' | 'center' | 'right';
  layerId?: string;
  style?: Partial<DrawingStyle>;
};
export type LayerBinding = {
  drafting?: DraftingAppearance;
  layerId?: string;
  style?: Partial<DrawingStyle>;
  plot?: PlotStyle;
};
export type DrawingLayer = DrawingStyle & {
  id: string;
  name: string;
  plot?: PlotStyle;
};
export type Point = { x: number; y: number };
export type Bar = LayerBinding & {
  id: string;
  mark: string;
  element: string;
  kind: 'free' | 'stirrup';
  stirrupMirrored?: boolean;
  stirrupProfile?: import('./stirrupSchema').StirrupProfile;
  stirrupDisplay?: import('zod').infer<
    typeof import('./stirrupSchema').stirrupDisplaySchema
  >;
  origin: Point;
  rotation: number;
  points: Point[];
  width: number;
  height: number;
  hook: number;
  diameter: number;
  mandrel: number;
  steel: 'CA-50' | 'CA-60';
  /** Pieces per group; never contains armature or detail repetition factors. */
  quantity: number;
  multiplier: number;
  quantitySource: BarQuantitySource;
  quantityDisplay?: 'factored' | 'total';
  comment?: string;
  ribbed?: boolean;
  showRibbed?: boolean;
  /** Textual assembly reference, independent of floor identity and structural checks. */
  columnLevel?: string;
  distribution?: {
    start?: Point;
    end: Point;
    render?: 'ticks' | 'bars';
    annotationOffset?: number;
    insets?: { start: number; end: number };
  };
  color: string;
  /** Fabrication specifications; no implicit added geometry or cut allowance. */
  manufacturing?: {
    start?: BarTermination;
    end?: BarTermination;
    variant?: string;
  };
};
export type BarQuantitySource =
  | { kind: 'manual' }
  | { kind: 'distribution'; mode: 'quantity' }
  | {
      kind: 'distribution';
      mode: 'spacing';
      spacing: number;
      fit?: 'maximum' | 'fixed';
    };
export type BarTermination = {
  kind: 'plain' | 'coupler' | 'threaded' | 'headed';
  code: string;
};
export type FabricationPosition = {
  id: string;
  mark: string;
  barIds: string[];
  reverse: boolean;
  signature: string;
};
/** A graphical rebatimento; never another physical bar or composite detail. */
export type BarRepresentation = LayerBinding & {
  id: string;
  barId: string;
  mirrored?: boolean;
  origin: Point;
  rotation?: number;
  scale?: number;
  identification?: 'legacy' | 'primary' | 'mark' | 'none';
  /** Optional local label placement, independent of the physical centerline. */
  label?: {
    origin: Point;
    rotation: number;
    height: number;
    /** Hide this namespace only while the current mark still starts with it. */
    omitPrefix?: string;
  };
  showDimensions?: boolean;
};
export type Detail = BarRepresentation;
export type Floor = { id: string; name: string };
/** UI group of elements (e.g. Vigas/Pilares); legacy contract/name retained for interchange. */
export type StructuralElement = { id: string; floorId: string; name: string };
export type ObjectOrigin = { projectId: string; objectId: string };
export type DetailOrigin = {
  projectId: string;
  floorId: string;
  elementId: string;
  detailId: string;
};
export type DetailSource = {
  origin: DetailOrigin;
  projectName: string;
  path: string;
  revision: string;
  exchange?: {
    producer: { app: string; version: string };
    exportedAt: string;
    metadata: Record<string, string>;
  };
};
export type DrawingDetail = {
  id: string;
  elementId: string;
  name: string;
  /** Visual selection as a unit; false/absent keeps individually selectable objects. */
  grouped?: boolean;
  source?: DetailSource;
  repetition?: DetailRepetition;
};
export type DetailRepetition = {
  factor: number;
  elements: { name: string; elementId?: string }[];
  /** Origins whose physical definitions were explicitly consolidated into this detail. */
  absorbedOrigins?: DetailOrigin[];
};
export type DetailDrawing = {
  id: string;
  detailId: string;
  name: string;
  /** User-informed documentary author; never inferred from OS, account or VCS. */
  author?: string;
  /** Civil calendar date YYYY-MM-DD without time or timezone offset. */
  date?: string;
  /** Documentary comments specific to this drawing, rendered as plain text. */
  notes?: string;
};
export type SheetFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'custom';
export type SheetSteelSchedule = {
  /** Upper left insertion point, in paper mm (Y increases upward). */
  origin: Point;
  textHeight: number;
  allowancePercent: number;
  /** Perda das telas soldadas (%) sobre a massa aplicada; ausente = 0 (formato 29). */
  meshLossPercent?: number;
};
export type Sheet = {
  /** One live schedule per sheet, independent of drawing scales and physical steel. */
  steelSchedule?: SheetSteelSchedule;
  id: string;
  name: string;
  format: SheetFormat;
  orientation: 'portrait' | 'landscape';
  customSize: { width: number; height: number };
  margins: { left: number; right: number; top: number; bottom: number };
  seal: { enabled: boolean; width: number; height: number };
  properties: { revision: string; notes: string };
};
/** Paper placement is independent of physical geometry and representation origins. */
export type SheetPlacement = {
  id: string;
  sheetId: string;
  drawingId: string;
  /** Millimeters on paper, measured from the lower left corner. */
  origin: Point;
  rotation: number;
  /** Denominator N in 1:N. Model coordinates are always physical millimeters. */
  scale: number;
  /** The model point that maps to origin on paper, before view rotation. */
  modelOrigin: Point;
  textHeight: number;
  title: string;
  /** Unused scale metadata from the old fit-to-frame preview, for traceability. */
  legacyScale?: number;
  /** Paper frame, independent of the physical definition; overflow is never clipped. */
  frame: { width: number; height: number };
};
export type ProjectHierarchy = {
  floors: Floor[];
  elements: StructuralElement[];
  details: DrawingDetail[];
  drawings: DetailDrawing[];
  placements: SheetPlacement[];
  /** Every physical or graphical object has one owning composite detail. */
  objectDetails: Record<string, string>;
  /** Import lineage follows the object even when it moves to another local detail. */
  objectOrigins: Record<string, ObjectOrigin>;
};
export type Primitive = LayerBinding & {
  id?: string;
  native?: import('./nativeMasks').NativeShape;
  /** Lineage of a local CAD edit, including fragments of an imported normalized entity. */
  sourceEntityId?: string;
  layer: string;
  /** Original semantic role remains stable when a catalog layer is renamed. */
  role?: string;
  resolvedStyle?: DrawingStyle;
  points: Point[];
  closed?: boolean;
  text?: string;
  textHeight?: number;
  textRotation?: number;
  textAlign?: 'left' | 'center' | 'right';
  /** Typography of a free CAD text; absent means the historical sans regular. */
  textFont?: TextFont;
  /**
   * Sheet text: the denominator N used to convert its paper height to the
   * stored model height (textHeight = paper mm × N). Absent: model text.
   */
  textPaperScale?: number;
};
/** Requested family/weight/style; outputs substitute unavailable families explicitly. */
export type TextFont = {
  family: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
};
export type Mask = LayerBinding & {
  id: string;
  name: string;
  format: 'DXF' | 'DWG' | 'DEMO' | 'NATIVE';
  /** Import staging; adopted into Project.layers at the transaction boundary. */
  layerDefinitions?: DrawingLayer[];
  primitives: Primitive[];
  layers: Record<string, boolean>;
  visible: boolean;
  opacity: number;
  scale: number;
  origin: Point;
  rotation: number;
  sourceUnit: string;
  warnings: string[];
};
export type AnnotationKind =
  | 'dimension-aligned'
  | 'dimension-orthogonal'
  | 'leader'
  | 'section'
  | 'section-arc';
export type Annotation = LayerBinding & {
  id: string;
  kind: AnnotationKind;
  frameRotation?: number;
  /** Static coordinates with explicit diagnostics, never a parametric mask constraint. */
  maskReferences?: import('./maskDimensions').MaskDimensionReference[];
  dimensionPresentation?: import('./maskDimensions').DimensionPresentation;
  points: Point[];
  barId?: string;
  /** Additional dependency links; do not drive quantities or change the primary caption. */
  barIds?: string[];
  label: string;
  textHeight: number;
  color: string;
};
export type DraftPolyline = LayerBinding & {
  id: string;
  /** Explicit armature dependencies, including shared auxiliary geometry. */
  barIds?: string[];
  points: Point[];
  closed: boolean;
  color: string;
};
/** Reusable CAD drawing in symbol space (mm, origin = base point); never carries steel. */
export type SymbolDefinition = {
  id: string;
  name: string;
  category: string;
  /** Raised each time the geometry changes, so instances can report the impact. */
  revision: number;
  primitives: Primitive[];
};
/** A placement of a definition; geometry is shared, only the transform is its own. */
export type SymbolInstance = LayerBinding & {
  id: string;
  definitionId: string;
  layerId: string;
  origin: Point;
  rotation: number;
  scale: number;
};
export type Project = {
  schema: 'armadurastruct/29';
  symbols?: SymbolDefinition[];
  symbolInstances?: SymbolInstance[];
  stirrupDefaults?: import('./stirrupSchema').StirrupCriteria;
  /** Telas soldadas lançadas (formato 29): critérios e região estáticos. */
  weldedMeshes?: import('./weldedMeshLaunch').WeldedMeshLaunch[];
  /** Últimos critérios de tela confirmados num lançamento. */
  weldedMeshDefaults?: import('./weldedMesh').WeldedMeshCriteria;
  cadDefaults?: import('./cadDefaults').CadDefaults;
  plotting?: PlotSettings;
  layerEnvironment?: import('./layerProfiles').LayerEnvironment;
  layers: DrawingLayer[];
  id: string;
  hierarchy: ProjectHierarchy;
  numbering?: import('./marks').NumberingPolicy;
  /** Array order is the document order, independent of tab opening order. */
  sheets: Sheet[];
  name: string;
  author: string;
  notes: string;
  bars: Bar[];
  fabricationPositions?: FabricationPosition[];
  details: Detail[];
  masks: Mask[];
  annotations: Annotation[];
  polylines: DraftPolyline[];
  drawing: { floor: string; revision: string; scale: number };
  scheduleLock?: {
    at: string;
    bars: Bar[];
    fabricationPositions?: FabricationPosition[];
    origins?: Record<string, string>;
    detailIds?: Record<string, string>;
    quantities?: Record<string, { repetitions: number; detailTitle: string }>;
    /** Fotografia das telas soldadas; ausente quando o projeto não tem telas. */
    weldedMeshes?: import('./weldedMeshLaunch').WeldedMeshLaunch[];
  };
};
export type Tool =
  | 'select'
  | 'pan'
  | 'bar'
  | 'stirrup'
  | 'move'
  | 'copy'
  | 'detail'
  | 'distribute'
  | 'follow'
  | 'measure'
  | 'polyline'
  | 'convert'
  | 'repeat'
  | 'range'
  | 'welded-mesh'
  | AnnotationKind;
export type Segment =
  | { type: 'line'; a: Point; b: Point }
  | {
      type: 'arc';
      a: Point;
      b: Point;
      center: Point;
      radius: number;
      angle: number;
      startAngle: number;
    };
export type Geometry = {
  segments: Segment[];
  length: number;
  errors: string[];
  vertices: Point[];
};
export type ScheduleContribution = {
  barId: string;
  detailId: string;
  origin: string;
  baseQuantity: number;
  multiplier: number;
  perDetailQuantity: number;
  quantitySource: BarQuantitySource;
  comment: string;
  ribbed: boolean;
  showRibbed: boolean;
  columnLevel: string;
  repetitions: number;
  quantity: number;
  unitLength: number;
  totalLength: number;
  weight: number;
};
export type ScheduleRow = {
  positionId: string;
  contributions: ScheduleContribution[];
  unitLengthRange: [number, number];
  mark: string;
  element: string;
  steel: string;
  diameter: number;
  quantity: number;
  baseQuantity: number;
  multiplier: number | null;
  perDetailQuantity: number;
  /** Null for a fabrication position with contributions using different detail factors. */
  repetitions: number | null;
  unitLength: number;
  totalLength: number;
  weight: number;
  errors: string[];
  bar: Bar;
};
export const uid = () => crypto.randomUUID();
