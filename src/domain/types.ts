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
  distribution?: { end: Point };
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
export type Project = {
  schema: 'armadurastruct/1';
  name: string;
  author: string;
  notes: string;
  bars: Bar[];
  details: Detail[];
  masks: Mask[];
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
  | 'measure';
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
