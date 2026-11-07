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

export {
  setDetailRepetition,
  repetitionCandidates,
  previewMergeRepetitions,
  applyMergeRepetitions,
} from './domain/detailRepetition';
export { barQuantities, detailTitle } from './domain/detailQuantities';
export type { DetailRepetition } from './domain/types';

export {
  FABRICATION_RULES,
  fabricationSignature,
  fabricationPositions,
  fabricationCandidates,
  previewFabrication,
  groupFabrication,
  ungroupFabrication,
} from './domain/fabrication';
export type {
  FabricationPosition,
  BarTermination,
  ScheduleContribution,
} from './domain/types';
