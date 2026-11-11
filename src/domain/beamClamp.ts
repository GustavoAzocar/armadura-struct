import type { Bar } from './types';
import { beamClampGeometry } from './beamClampGeometry';
export { beamClampGeometry, beamClampVertices } from './beamClampGeometry';

/** No commercial allowance is introduced: cut equals the complete analytic physical axis. */
export function beamClampCutLength(b: Bar): number {
  return beamClampGeometry(b).length;
}
