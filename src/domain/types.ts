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
export type Detail = { id: string; barId: string; origin: Point };
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
  schema: 'armadurastruct/2';
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
