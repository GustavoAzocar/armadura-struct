/** Public executable domain facade. No React, window, document or transport protocol. */
export {
  REBAR_API_VERSION,
  REBAR_CAPABILITIES,
  RebarApiError,
  executeRebarBatch,
  applyRebarBatch,
} from './domain/rebarApi';
export type {
  RebarDefinition,
  RebarPatch,
  RebarCommand,
  RebarOptions,
  RebarIssue,
  RebarBatchResult,
} from './domain/rebarApi';
export type { Project, Point, Bar, BarRepresentation } from './domain/types';
