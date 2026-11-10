/** Public contract v1. JSON is canonical; no React/Tauri/internal imports. */
export type VersionRange = { min: string; maxExclusive: string };
export type Platform = 'any' | 'linux' | 'windows' | 'macos';
export type Architecture = 'any' | 'x86_64' | 'aarch64';
export type ParameterSchema = {
  type: 'object' | 'number' | 'integer' | 'string' | 'boolean' | 'array';
  title?: string;
  description?: string;
  'x-unit'?: 'mm' | 'deg' | 'count' | 'none';
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  enum?: (string | number | boolean | null)[];
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ParameterSchema;
};
export type PluginManifest = {
  schema: 'openstruct.plugin/1';
  id: string;
  name: string;
  description: string;
  publisher: { id: string; name: string };
  license: string;
  links: { documentation: string; repository: string };
  version: string;
  compatibility: {
    pluginApi: VersionRange;
    rebarApi: VersionRange;
    app?: VersionRange;
  };
  platforms: Platform[];
  architectures: Architecture[];
  runtime: { kind: string; entry?: string };
  capabilities: { required: string[]; optional: string[] };
  permissions: (
    | 'context.read'
    | 'rebar.preview'
    | 'detail.preview'
    | 'network'
    | 'filesystem'
    | 'shell'
  )[];
  contributions: {
    kind: 'generator';
    id: string;
    name: string;
    inputSchema: ParameterSchema;
    output: 'rebar-batch/1' | 'openstruct.detail/16';
  }[];
  files: Record<string, { size: number; sha256: string }>;
  extensions?: Record<string, unknown>;
};
export type PluginArtifact = {
  url: string;
  size: number;
  sha256: string;
  platform: Platform;
  architecture: Architecture;
  runtime: string;
};
export type PluginCatalog = {
  schema: 'openstruct.plugin-catalog/1';
  name: string;
  publisher: { id: string; name: string };
  plugins: { manifest: PluginManifest; artifacts: PluginArtifact[] }[];
};
export type RpcId = string | number;
export type PluginInitializeParams = {
  protocolVersion: string;
  requiredCapabilities?: string[];
  optionalCapabilities?: string[];
};
export type PluginRequest = {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params?: Record<string, unknown>;
};
export type PluginResponse =
  | { jsonrpc: '2.0'; id: RpcId; result: unknown }
  | {
      jsonrpc: '2.0';
      id: RpcId | null;
      error: { code: number; message: string; data?: unknown };
    };
export type PluginNotification = {
  jsonrpc: '2.0';
  method: 'plugin.cancel' | 'plugin.progress';
  params: Record<string, unknown>;
};
/** Persist in AS-09 metadata['org.openstruct.plugin.provenance'] as JSON text. */
export type PluginProvenance = {
  schema: 'openstruct.plugin-provenance/1';
  pluginId: string;
  pluginVersion: string;
  packageSha256: string;
  generatorId: string;
  parameters: Record<string, unknown>;
  units: { length: 'mm'; angle: 'deg' };
};
