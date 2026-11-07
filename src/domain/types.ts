export type Point = { x: number; y: number };
export type Bar = {
  id: string;
  mark: string;
  element: string;
  kind: 'free' | 'stirrup';
  origin: Point;
  rotation: number;
  points: Point[];
  width: number;
  height: number;
  hook: number;
  diameter: number;
  mandrel: number;
  steel: 'CA-50' | 'CA-60';
  quantity: number;
  distribution?: { start?: Point; end: Point; render?: 'ticks' | 'bars' };
  color: string;
};
/** A graphical rebatimento; never another physical bar or composite detail. */
export type BarRepresentation = { id: string; barId: string; origin: Point };
export type Detail = BarRepresentation;
export type Floor = { id: string; name: string };
export type StructuralElement = { id: string; floorId: string; name: string };
export type DrawingDetail = {
  id: string;
  elementId: string;
  name: string;
  /** Visual selection as a unit; false/absent keeps individually selectable objects. */
  grouped?: boolean;
};
export type DetailDrawing = { id: string; detailId: string; name: string };
export type SheetFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
export type Sheet = {
  id: string;
  name: string;
  format: SheetFormat;
  orientation: 'portrait' | 'landscape';
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
  scale: number;
  /** Preview frame on paper; does not rescale the physical definition. */
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
};
export type Primitive = {
  layer: string;
  points: Point[];
  closed?: boolean;
  text?: string;
  textHeight?: number;
  textRotation?: number;
};
export type Mask = {
  id: string;
  name: string;
  format: 'DXF' | 'DWG' | 'DEMO';
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
export type Annotation = {
  id: string;
  kind: AnnotationKind;
  points: Point[];
  barId?: string;
  label: string;
  textHeight: number;
  color: string;
};
export type DraftPolyline = {
  id: string;
  points: Point[];
  closed: boolean;
  color: string;
};
export type Project = {
  schema: 'armadurastruct/4';
  id: string;
  hierarchy: ProjectHierarchy;
  /** Array order is the document order, independent of tab opening order. */
  sheets: Sheet[];
  name: string;
  author: string;
  notes: string;
  bars: Bar[];
  details: Detail[];
  masks: Mask[];
  annotations: Annotation[];
  polylines: DraftPolyline[];
  drawing: { floor: string; revision: string; scale: number };
  scheduleLock?: { at: string; bars: Bar[] };
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
export type ScheduleRow = {
  mark: string;
  element: string;
  steel: string;
  diameter: number;
  quantity: number;
  unitLength: number;
  totalLength: number;
  weight: number;
  errors: string[];
  bar: Bar;
};
export const uid = () => crypto.randomUUID();
