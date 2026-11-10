import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import {
  checkCatalogSchema,
  checkManifestSchema,
  parsePluginJson,
  pluginCompatibility,
  validateCatalog,
  validateManifest,
  validateParameters,
} from '../src/plugins/contracts';
import { inspectPluginPackage, sha256 } from '../src/plugins/package';
import {
  GeneratorConformanceSession,
  pluginHostRequest,
  pluginProvenance,
  PROVENANCE_KEY,
} from '../src/plugins/host';
import { emptyProject, decodeProject, schedule } from '../src/domain/model';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { setLayerState } from '../src/domain/layerProfiles';
import { toCsv, toDxf } from '../src/lib/exports';
import { exampleManifest, straightBarOutput } from '../docs/plugins/demo';
import rawManifest from '../examples/plugins/straight-bar/manifest.json';
import futureRuntime from '../examples/plugins/future-runtime.json';
import incompatible from '../examples/plugins/incompatible-api.json';
import unknownCapability from '../examples/plugins/unknown-required-capability.json';
import invalidSchema from '../examples/plugins/invalid-schema.json';
import type { PluginCatalog, PluginManifest } from '../public/plugins/v1/types';
const host = { appVersion: '0.6.0', platform: 'linux', architecture: 'x86_64' };
const m = () => structuredClone(exampleManifest);
const context = (p = emptyProject()) => ({
  projectId: p.id,
  detailId: p.hierarchy.details[0].id,
  layerContext: 'model',
});
const newSession = () => {
  const project = emptyProject(),
    ctx = context(project),
    abort = new AbortController();
  return {
    project,
    ctx,
    abort,
    session: new GeneratorConformanceSession(
      project,
      ctx,
      m(),
      'straight-bar',
      { length: 1000, quantity: 3 },
      abort.signal,
    ),
  };
};

describe('contrato público de plugins v1', () => {
  it('JSON Schema e tipos públicos concordam com exemplos e catálogo', () => {
    const manifest: PluginManifest = m();
    expect(checkManifestSchema(manifest)).toBe(true);
    expect(validateManifest(rawManifest)).toEqual(manifest);
    expect(() => validateManifest(invalidSchema)).toThrow();
    expect(validateManifest(futureRuntime).runtime.kind).toBe('python-3');
    const catalog: PluginCatalog = {
      schema: 'openstruct.plugin-catalog/1',
      name: 'Fixture',
      publisher: { id: 'org.example', name: 'Example' },
      plugins: [
        {
          manifest,
          artifacts: [
            {
              url: 'https://example.org/plugin.osplugin',
              size: 10,
              sha256: '0'.repeat(64),
              platform: 'any',
              architecture: 'any',
              runtime: 'declarative',
            },
          ],
        },
      ],
    };
    expect(checkCatalogSchema(catalog)).toBe(true);
    expect(validateCatalog(catalog)).toEqual(catalog);
    const bad = structuredClone(catalog);
    bad.plugins[0].artifacts[0].runtime = 'python';
    expect(() => validateCatalog(bad)).toThrow();
    const duplicate = structuredClone(catalog);
    duplicate.plugins.push(duplicate.plugins[0]);
    expect(() => validateCatalog(duplicate)).toThrow();
  });
  it('versões e capacidades têm elegibilidade independente do runtime', () => {
    expect(pluginCompatibility(m(), host)).toMatchObject({
      compatible: true,
      execution: 'unsupported',
      ignoredOptional: ['future.progress'],
    });
    for (const raw of [incompatible, unknownCapability])
      expect(pluginCompatibility(validateManifest(raw), host).compatible).toBe(
        false,
      );
    const future = validateManifest(futureRuntime);
    expect(pluginCompatibility(future, host).compatible).toBe(true);
    const only = m();
    only.platforms = ['windows'];
    expect(pluginCompatibility(only, host)).toMatchObject({
      compatible: false,
      platformAvailable: false,
    });
    const bad = m();
    bad.compatibility.app = { min: '1.0.0', maxExclusive: '0.6.0' };
    expect(() => validateManifest(bad)).toThrow();
    bad.compatibility.app = { min: '0.6.0', maxExclusive: '1.0.0' };
    bad.id = 'host.reserved';
    expect(() => validateManifest(bad)).toThrow();
    expect(() => parsePluginJson('{"a":1,"a":2}')).toThrow('duplicada');
    expect(parsePluginJson('{"a":{"a":1},"b":[true,{"c":"\\\""}]}')).toEqual({
      a: { a: 1 },
      b: [true, { c: '"' }],
    });
  });
  it('valida parâmetros compostos sem referências remotas ou código', () => {
    expect(
      validateParameters(m(), 'straight-bar', { length: 500, quantity: 2 }),
    ).toEqual({ length: 500, quantity: 2 });
    for (const p of [
      { length: 0, quantity: 2 },
      { length: 500, quantity: 1.5 },
      { length: 500, quantity: 2, extra: 1 },
    ])
      expect(() => validateParameters(m(), 'straight-bar', p)).toThrow();
    const bad = m();
    bad.contributions[0].inputSchema = JSON.parse(
      '{"type":"object","$ref":"https://example.org/schema"}',
    );
    expect(() => validateManifest(bad)).toThrow();
  });
  it('pacote de exemplo é aceito e saída nunca inclui código executável', async () => {
    const example = new Uint8Array(
      readFileSync('examples/plugins/straight-bar.osplugin'),
    );
    const result = await inspectPluginPackage(example);
    expect(result.manifest).toEqual(m());
    expect(result.sha256).toHaveLength(64);
    const data = strToU8('payload');
    const manifest = m();
    manifest.files = {
      'README.txt': { size: data.length, sha256: await sha256(data) },
    };
    const packageFor = (mm: PluginManifest) =>
      zipSync(
        { 'manifest.json': strToU8(JSON.stringify(mm)), 'README.txt': data },
        { level: 0 },
      );
    expect((await inspectPluginPackage(packageFor(manifest))).manifest).toEqual(
      manifest,
    );
    manifest.files['README.txt'].sha256 = '0'.repeat(64);
    await expect(inspectPluginPackage(packageFor(manifest))).rejects.toThrow(
      'Integridade',
    );
    await expect(
      inspectPluginPackage(zipSync({ '../escape': data }, { level: 0 })),
    ).rejects.toThrow();
    await expect(
      inspectPluginPackage(
        zipSync({ 'a.txt': data, 'A.txt': data }, { level: 0 }),
      ),
    ).rejects.toThrow('duplicadas');
    await expect(
      inspectPluginPackage(
        zipSync({ bomb: new Uint8Array(1024 * 1024) }, { level: 9 }),
      ),
    ).rejects.toThrow('Expansão');
    await expect(inspectPluginPackage(strToU8('bad zip'))).rejects.toThrow();
  });
  it('negocia JSON-RPC com correlação, erros e runtimes explicitamente indisponíveis', () => {
    const result = pluginHostRequest({
      jsonrpc: '2.0',
      id: 'x',
      method: 'plugin.initialize',
      params: { protocolVersion: '1.0.0' },
    });
    expect(result).toMatchObject({
      id: 'x',
      result: { executionEnabled: false, runtimes: [], rebarApiVersion: '1.0' },
    });
    expect(
      pluginHostRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'plugin.initialize',
        params: { protocolVersion: '2.0.0' },
      }),
    ).toMatchObject({ id: 2, error: { code: -32001 } });
    expect(
      pluginHostRequest({ jsonrpc: '2.0', id: 3, method: 'plugin.generate' }),
    ).toMatchObject({ id: 3, error: { code: -32010 } });
    expect(
      pluginHostRequest({ jsonrpc: '2.0', id: 4, method: 'plugin.unknown' }),
    ).toMatchObject({ id: 4, error: { code: -32601 } });
    expect(pluginHostRequest({ method: 'oops' })).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
  });
});
describe('adaptador de conformidade sobre a API real', () => {
  it('recusa gerações em layer protegido e negociação de capacidade desconhecida', () => {
    const project = setLayerState(emptyProject(), 'model', 'layer:ARMADURAS', {
      editable: false,
    });
    const ctx = context(project);
    const session = new GeneratorConformanceSession(
      project,
      ctx,
      m(),
      'straight-bar',
      { length: 1000, quantity: 2 },
      new AbortController().signal,
    );
    expect(() =>
      session.preview(
        straightBarOutput(ctx.detailId, { length: 1000, quantity: 2 }),
      ),
    ).toThrow();
    expect(project.bars).toHaveLength(0);
    expect(
      pluginHostRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'plugin.initialize',
        params: { protocolVersion: '1.0.0', requiredCapabilities: ['unknown'] },
      }),
    ).toMatchObject({ id: 5, error: { code: -32004 } });
    expect(
      pluginHostRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'plugin.initialize',
        params: {},
      }),
    ).toMatchObject({ id: 6, error: { code: -32602 } });
    expect(
      pluginHostRequest({
        jsonrpc: '2.0',
        method: 'plugin.cancel',
        params: { requestId: 'x' },
      }),
    ).toBeUndefined();
  });

  it('prévia não altera o projeto; confirma lote atômico e permite um único desfazer/refazer', () => {
    const { project, ctx, session } = newSession();
    const original = JSON.stringify(project);
    const receipt = session.preview(
      straightBarOutput(ctx.detailId, { length: 1000, quantity: 3 }),
    );
    expect(receipt.createdIds).toHaveLength(1);
    expect(JSON.stringify(project)).toBe(original);
    expect(() => session.apply(project, ctx, false)).toThrow();
    const next = session.apply(project, ctx, true);
    expect(next.bars).toHaveLength(1);
    expect(schedule(next)[0].quantity).toBe(3);
    const history = {
      past: [project],
      present: next,
      future: [] as (typeof project)[],
    };
    history.future.unshift(history.present);
    history.present = history.past.pop()!;
    expect(history.present).toBe(project);
    history.past.push(history.present);
    history.present = history.future.shift()!;
    expect(history.present).toBe(next);
    expect(() => session.apply(project, ctx, true)).toThrow('consumido');
  });
  it('rejeição do segundo comando não aplica nem o primeiro', () => {
    const { project, ctx, session } = newSession();
    const output = straightBarOutput(ctx.detailId, {
      length: 1000,
      quantity: 3,
    });
    output.commands.push({
      type: 'bar.create',
      id: 'invalid',
      detailId: ctx.detailId,
      definition: {
        ...(
          output.commands[0] as Extract<
            (typeof output.commands)[0],
            { type: 'bar.create' }
          >
        ).definition,
        diameter: -1,
      },
    } as any);
    expect(() => session.preview(output)).toThrow();
    expect(project.bars).toHaveLength(0);
    expect(() => session.apply(project, ctx, true)).toThrow();
  });
  it('cancelamento, timeout, contexto alterado e respostas atrasadas não alteram o projeto', () => {
    const { project, ctx, abort, session } = newSession();
    session.preview(
      straightBarOutput(ctx.detailId, { length: 1000, quantity: 3 }),
    );
    expect(() => session.apply({ ...project }, ctx, true)).toThrow('mudou');
    expect(() =>
      session.apply(project, { ...ctx, layerContext: 'other' }, true),
    ).toThrow('contexto');
    abort.abort();
    expect(() => session.apply(project, ctx, true)).toThrow();
    expect(project.bars).toHaveLength(0);
    vi.useFakeTimers();
    try {
      const x = newSession();
      vi.advanceTimersByTime(30001);
      expect(() =>
        x.session.preview(
          straightBarOutput(x.ctx.detailId, { length: 1000, quantity: 3 }),
        ),
      ).toThrow('expirado');
    } finally {
      vi.useRealTimers();
    }
  });
  it('não permite editar objetos antigos ou gerar fora do detalhamento autorizado', () => {
    const x = newSession(),
      out = straightBarOutput('other', { length: 1000, quantity: 3 });
    expect(() => x.session.preview(out)).toThrow('contexto');
    expect(() =>
      x.session.preview({
        ...out,
        commands: [{ type: 'bar.delete', id: 'existing' }],
      }),
    ).toThrow('autorização');
  });
  it('geometria nativa, quantitativos, proveniência AS-09 e exportação independem do plugin', () => {
    const x = newSession();
    x.session.preview(
      straightBarOutput(x.ctx.detailId, { length: 1200, quantity: 3 }),
    );
    const project = x.session.apply(x.project, x.ctx, true);
    const metadata = pluginProvenance({
      schema: 'openstruct.plugin-provenance/1',
      pluginId: m().id,
      pluginVersion: m().version,
      packageSha256: '0'.repeat(64),
      generatorId: 'straight-bar',
      parameters: { length: 1200, quantity: 3 },
      units: { length: 'mm', angle: 'deg' },
    });
    const pack = createDetailPackage(project, x.ctx.detailId, {
      producer: { app: 'ArmaduraStruct', version: '0.6.0' },
      metadata,
    });
    const reopened = decodeProject(
      JSON.stringify(readDetailPackage(pack).project),
    );
    expect(
      reopened.hierarchy.details[0].source?.exchange?.metadata[PROVENANCE_KEY],
    ).toBe(metadata[PROVENANCE_KEY]);
    expect(schedule(reopened)[0].quantity).toBe(3);
    expect(toCsv(reopened)).toContain('N1');
    expect(toDxf(reopened)).toContain('SECTION');
    expect(
      createDetailPackage(reopened, reopened.hierarchy.details[0].id, {
        producer: { app: 'ArmaduraStruct', version: '0.6.0' },
      }).metadata[PROVENANCE_KEY],
    ).toBe(metadata[PROVENANCE_KEY]);
  });
});
