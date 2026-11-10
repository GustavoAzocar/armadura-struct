/** Public plugin façade. Runtime execution remains unavailable in v1. */
export type * from '../public/plugins/v1/types';
export {
  PLUGIN_API_VERSION,
  HOST_CAPABILITIES,
  validateManifest,
  validateCatalog,
  pluginCompatibility,
  validateParameters,
} from './plugins/contracts';
export {
  pluginHostRequest,
  GeneratorConformanceSession,
  pluginProvenance,
  PROVENANCE_KEY,
} from './plugins/host';
export type {
  GeneratorContext,
  RebarGeneratorOutput,
  DetailGeneratorOutput,
} from './plugins/host';
