import type { Point } from '../domain/types';

export type CadCamera = { x: number; y: number; s: number };
export type CadSize = { w: number; h: number };

export function modelPoint(
  camera: CadCamera,
  size: CadSize,
  point: Point,
): Point {
  return {
    x: (point.x - size.w / 2) / camera.s + camera.x,
    y: camera.y - (point.y - size.h / 2) / camera.s,
  };
}

export function panCamera(start: CadCamera, from: Point, to: Point): CadCamera {
  return {
    ...start,
    x: start.x - (to.x - from.x) / start.s,
    y: start.y + (to.y - from.y) / start.s,
  };
}

/** Integrate every wheel event against the latest camera and its own anchor. */
export function zoomCamera(
  camera: CadCamera,
  size: CadSize,
  anchor: Point,
  deltaY: number,
): CadCamera {
  const p = modelPoint(camera, size, anchor);
  const s = Math.max(
    0.000001,
    Math.min(20, camera.s * Math.exp(-deltaY * 0.0015)),
  );
  return {
    s,
    x: p.x - ((p.x - camera.x) * camera.s) / s,
    y: p.y - ((p.y - camera.y) * camera.s) / s,
  };
}
