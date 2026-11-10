/** Transport-free conformance adapter. No runtime or project reference is given to plugins. */
import {
  applyRebarBatch,
  executeRebarBatch,
  REBAR_API_VERSION,
  REBAR_CAPABILITIES,
  type RebarBatchResult,
  type RebarCommand,
} from '../api';
import type { Project } from '../domain/types';
import type {
  PluginManifest,
  PluginProvenance,
  PluginRequest,
  PluginResponse,
} from '../../public/plugins/v1/types';
import {
  assertJsonLimits,
  checkProvenanceSchema,
  checkProtocolSchema,
  HOST_CAPABILITIES,
  PLUGIN_API_VERSION,
  validateManifest,
  validateParameters,
} from './contracts';

export function pluginHostRequest(raw: unknown): PluginResponse | undefined {
  const error = (
    id: string | number | null,
    code: number,
    message: string,
  ): PluginResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    assertJsonLimits(raw, 128 * 1024);
  } catch {
    return error(null, -32600, 'Mensagem excede os limites do host.');
  }
  if (
    checkProtocolSchema(raw) &&
    raw &&
    'method' in (raw as object) &&
    !('id' in (raw as object))
  )
    return; // JSON-RPC notifications never receive a response.
  if (
    !checkProtocolSchema(raw) ||
    !raw ||
    !('method' in (raw as object)) ||
    !('id' in (raw as object))
  )
    return error(null, -32600, 'Solicitação JSON-RPC inválida.');
  const request = raw as PluginRequest;
  const required = request.params?.requiredCapabilities;
  const optional = request.params?.optionalCapabilities;
  if (!['plugin.initialize', 'plugin.capabilities'].includes(request.method))
    return error(
      request.id,
      request.method === 'plugin.generate' ? -32010 : -32601,
      'Runtime/método não implementado.',
    );
  if (
    request.method === 'plugin.initialize' &&
    (typeof request.params?.protocolVersion !== 'string' ||
      (required !== undefined &&
        (!Array.isArray(required) ||
          required.length > 128 ||
          required.some((c) => typeof c !== 'string'))) ||
      (optional !== undefined &&
        (!Array.isArray(optional) ||
          optional.length > 128 ||
          optional.some((c) => typeof c !== 'string'))))
  )
    return error(request.id, -32602, 'Parâmetros de negociação inválidos.');
  if (
    request.method === 'plugin.initialize' &&
    Array.isArray(required) &&
    required.some((c) => !HOST_CAPABILITIES.includes(c))
  )
    return error(request.id, -32004, 'Capacidade obrigatória sem suporte.');
  if (
    request.method === 'plugin.initialize' &&
    request.params?.protocolVersion !== PLUGIN_API_VERSION
  )
    return error(request.id, -32001, 'Versão do protocolo incompatível.');
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: PLUGIN_API_VERSION,
      rebarApiVersion: REBAR_API_VERSION,
      capabilities: [...HOST_CAPABILITIES],
      rebar: REBAR_CAPABILITIES,
      runtimes: [],
      executionEnabled: false,
      ignoredOptional: Array.isArray(optional)
        ? optional.filter((c) => !HOST_CAPABILITIES.includes(c))
        : [],
      outputAdapters: ['rebar-batch/1'],
      reservedOutputs: ['openstruct.detail/16'],
      timeoutMs: 30000,
      cancellation: true,
      progress: false,
    },
  };
}
export type GeneratorContext = {
  projectId: string;
  detailId: string;
  layerContext: string;
  isolationDetailId?: string;
};
export type RebarGeneratorOutput = {
  format: 'rebar-batch/1';
  apiVersion: typeof REBAR_API_VERSION;
  units: { length: 'mm'; angle: 'deg' };
  commands: RebarCommand[];
};
/** Reserved AS-09 output is a different tagged adapter; never guessed from data. */
export type DetailGeneratorOutput = {
  format: 'openstruct.detail/16';
  package: unknown;
};
export const PROVENANCE_KEY = 'org.openstruct.plugin.provenance';
export function pluginProvenance(value: PluginProvenance) {
  assertJsonLimits(value, 10000);
  if (!checkProvenanceSchema(value)) throw new Error('Proveniência inválida.');
  const text = JSON.stringify(value);
  if (text.length > 5000)
    throw new Error('Proveniência excede o limite AS-09 de 5000 caracteres.');
  return { [PROVENANCE_KEY]: text };
}
export class GeneratorConformanceSession {
  #result?: Extract<RebarBatchResult, { ok: true }>;
  #used = false;
  #deadline: number;
  #context: string;
  #manifest: PluginManifest;
  readonly parameters: unknown;
  constructor(
    private base: Project,
    context: GeneratorContext,
    manifest: PluginManifest,
    generatorId: string,
    parameters: unknown,
    private signal: AbortSignal,
    timeoutMs = 30000,
  ) {
    this.#manifest = structuredClone(validateManifest(manifest));
    if (
      this.#manifest.capabilities.required.some(
        (c) => !HOST_CAPABILITIES.includes(c),
      )
    )
      throw new Error('Capacidade obrigatória sem suporte.');
    this.parameters = validateParameters(
      this.#manifest,
      generatorId,
      parameters,
    );
    if (
      this.#manifest.contributions.find((g) => g.id === generatorId)?.output !==
      'rebar-batch/1'
    )
      throw new Error('Adaptador de saída ainda não implementado.');
    if (
      context.projectId !== base.id ||
      !base.hierarchy.details.some((d) => d.id === context.detailId) ||
      (context.isolationDetailId &&
        context.isolationDetailId !== context.detailId)
    )
      throw new Error('Contexto de geração inválido.');
    this.#context = JSON.stringify(context);
    this.#deadline = Date.now() + Math.max(1, Math.min(timeoutMs, 30000));
  }
  #live() {
    this.signal.throwIfAborted();
    if (this.#used || Date.now() > this.#deadline)
      throw new Error('Resultado consumido/expirado.');
  }
  preview(output: unknown) {
    this.#live();
    this.#result = undefined;
    assertJsonLimits(output, 4 * 1024 * 1024);
    if (!output || typeof output !== 'object')
      throw new Error('Saída inválida.');
    const raw = output as RebarGeneratorOutput;
    if (
      Object.keys(raw).sort().join(',') !==
        'apiVersion,commands,format,units' ||
      raw.format !== 'rebar-batch/1' ||
      raw.apiVersion !== REBAR_API_VERSION ||
      !raw.units ||
      raw.units.length !== 'mm' ||
      raw.units.angle !== 'deg' ||
      Object.keys(raw.units).length !== 2 ||
      !Array.isArray(raw.commands) ||
      raw.commands.length > REBAR_CAPABILITIES.maxBatchOperations
    )
      throw new Error('Envelope de saída inválido.');
    const context = JSON.parse(this.#context) as GeneratorContext;
    const commands = structuredClone(raw.commands);
    // This first adapter creates a native bar set only. Existing objects remain protected.
    const created = new Set(
      commands.filter((c) => c?.type === 'bar.create').map((c) => c.id),
    );
    for (const command of commands) {
      if (command?.type === 'bar.create') {
        if (command.detailId !== context.detailId)
          throw new Error('Destino fora do contexto autorizado.');
      } else if (
        (command?.type === 'distribution.set' ||
          command?.type === 'representation.create') &&
        created.has(command.barId)
      ) {
        /* Native linked output. */
      } else
        throw new Error(
          'Operação sem autorização neste adaptador de geradores.',
        );
    }
    const result = executeRebarBatch(this.base, commands, {
      units: 'mm',
      apiVersion: REBAR_API_VERSION,
      scopeDetailId: context.detailId,
      layerContext: context.layerContext,
    });
    if (!result.ok)
      throw new Error(result.issues.map((i) => i.message).join('\n'));
    this.#live();
    this.#result = result;
    return structuredClone(result.receipt); // Preview has no mutable project reference.
  }
  apply(current: Project, context: GeneratorContext, confirmed: boolean) {
    this.#live();
    if (
      !confirmed ||
      !this.#result ||
      this.#context !== JSON.stringify(context)
    )
      throw new Error('Confirmação/contexto inválido.');
    const next = applyRebarBatch(current, this.#result);
    this.#used = true;
    return next; // Caller commits this once through the existing editor history.
  }
}
