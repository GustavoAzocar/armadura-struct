import Ajv from 'ajv';
import { compare, valid } from 'semver';
import manifestSchema from '../../public/plugins/v1/manifest.schema.json';
import catalogSchema from '../../public/plugins/v1/catalog.schema.json';
import protocolSchema from '../../public/plugins/v1/protocol.schema.json';
import provenanceSchema from '../../public/plugins/v1/provenance.schema.json';
import type {
  PluginCatalog,
  PluginManifest,
  VersionRange,
} from '../../public/plugins/v1/types';

export const PLUGIN_API_VERSION = '1.0.0';
export const HOST_CAPABILITIES = Object.freeze([
  'host.inspect',
  'rebar.batch.v1',
]);
export type Host = {
  appVersion: string;
  platform: string;
  architecture: string;
};
export type Compatibility = {
  compatible: boolean;
  platformAvailable: boolean;
  reasons: string[];
  ignoredOptional: string[];
  execution: 'unsupported';
};
const ajv = new Ajv({
  strict: false,
  allErrors: false,
  validateFormats: false,
});
export const checkManifestSchema = ajv.compile<PluginManifest>(manifestSchema);
export const checkCatalogSchema = ajv.compile<PluginCatalog>(catalogSchema);
export const checkProtocolSchema = ajv.compile(protocolSchema);
export const checkProvenanceSchema = ajv.compile(provenanceSchema);
export function assertJsonLimits(value: unknown, maxBytes = 128 * 1024) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes)
    throw new Error('JSON excede o limite de tamanho.');
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 24)
      throw new Error('JSON excede os limites de complexidade.');
    if (v && typeof v === 'object')
      Object.values(v).forEach((v) => visit(v, depth + 1));
  };
  visit(value, 0);
}
export function safePackagePath(name: string) {
  if (
    name.length > 160 ||
    !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)*$/.test(
      name,
    )
  )
    throw new Error(`Caminho de pacote inseguro: ${name}`);
  for (const part of name.split('/'))
    if (
      /^(__PROTO__|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(
        part.split('.')[0],
      )
    )
      throw new Error(`Nome reservado: ${name}`);
}
export function validateManifest(raw: unknown): PluginManifest {
  assertJsonLimits(raw);
  if (!checkManifestSchema(raw))
    throw new Error(`Manifesto: ${ajv.errorsText(checkManifestSchema.errors)}`);
  const m = raw;
  if (/^(host\.|tauri\.|armadurastruct\.|openstruct\.host\.)/.test(m.id))
    throw new Error('Namespace reservado.');
  if (!valid(m.version)) throw new Error('SemVer do plugin inválida.');
  for (const r of Object.values(m.compatibility)) {
    if (
      !valid(r.min) ||
      !valid(r.maxExclusive) ||
      r.min.includes('-') ||
      r.min.includes('+') ||
      r.maxExclusive.includes('-') ||
      r.maxExclusive.includes('+') ||
      compare(r.min, r.maxExclusive) >= 0
    )
      throw new Error('Intervalo SemVer inválido.');
  }
  for (const a of [m.platforms, m.architectures])
    if (a.length > 1 && a.includes('any'))
      throw new Error('any deve aparecer sozinho.');
  if (new Set(m.contributions.map((g) => g.id)).size !== m.contributions.length)
    throw new Error('Contribuição duplicada.');
  for (const g of m.contributions)
    if (!ajv.validateSchema(g.inputSchema))
      throw new Error('Schema de parâmetros inválido.');
  for (const link of Object.values(m.links)) {
    const u = new URL(link);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname)
      throw new Error('Link inválido.');
  }
  for (const name of Object.keys(m.files)) {
    safePackagePath(name);
    if (name === 'manifest.json')
      throw new Error('Manifesto não pode conter hash de si mesmo.');
  }
  if (m.runtime.entry && !m.files[m.runtime.entry])
    throw new Error('Entrada do runtime ausente em files.');
  return m;
}
export function validateCatalog(raw: unknown): PluginCatalog {
  assertJsonLimits(raw, 2 * 1024 * 1024);
  if (!checkCatalogSchema(raw))
    throw new Error(`Catálogo: ${ajv.errorsText(checkCatalogSchema.errors)}`);
  const ids = new Set<string>();
  for (const p of raw.plugins) {
    const m = validateManifest(p.manifest),
      key = `${m.id}@${m.version}`;
    if (ids.has(key)) throw new Error('Plugin/versão duplicado no catálogo.');
    ids.add(key);
    for (const a of p.artifacts)
      if (
        a.runtime !== m.runtime.kind ||
        !m.platforms.includes(a.platform) ||
        !m.architectures.includes(a.architecture)
      )
        throw new Error('Artefato diverge do manifesto.');
  }
  return raw;
}
export function pluginCompatibility(
  m: PluginManifest,
  host: Host,
): Compatibility {
  const reasons: string[] = [];
  const satisfies = (v: string, r: VersionRange) =>
    valid(v) &&
    !v.includes('-') &&
    compare(v, r.min) >= 0 &&
    compare(v, r.maxExclusive) < 0;
  for (const [key, value] of [
    ['pluginApi', PLUGIN_API_VERSION],
    ['rebarApi', '1.0.0'],
    ['app', host.appVersion],
  ] as const) {
    const r = m.compatibility[key];
    if (r && !satisfies(value, r))
      reasons.push(
        `${key}: requer >= ${r.min} e < ${r.maxExclusive}; atual ${value}`,
      );
  }
  for (const c of m.capabilities.required)
    if (!HOST_CAPABILITIES.includes(c))
      reasons.push(`Capacidade obrigatória sem suporte: ${c}`);
  const platformAvailable =
    (m.platforms.includes('any') ||
      m.platforms.some((p) => p === host.platform)) &&
    (m.architectures.includes('any') ||
      m.architectures.some((p) => p === host.architecture));
  if (!platformAvailable)
    reasons.push('Indisponível nesta plataforma/arquitetura');
  return {
    compatible: !reasons.length,
    platformAvailable,
    reasons,
    ignoredOptional: m.capabilities.optional.filter(
      (c) => !HOST_CAPABILITIES.includes(c),
    ),
    execution: 'unsupported',
  };
}
export function validateParameters(
  m: PluginManifest,
  generatorId: string,
  raw: unknown,
) {
  assertJsonLimits(raw, 4096);
  const generator = m.contributions.find((g) => g.id === generatorId);
  if (!generator) throw new Error('Gerador não declarado.');
  const check = ajv.compile(generator.inputSchema);
  if (!check(raw))
    throw new Error(`Parâmetros inválidos: ${ajv.errorsText(check.errors)}`);
  return structuredClone(raw);
}
/** Match native parsing: reject duplicate keys before validating the public schema. */
export function parsePluginJson(text: string, maxBytes = 128 * 1024): unknown {
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new Error('JSON excede o limite.');
  const result: unknown = JSON.parse(text);
  assertJsonLimits(result, maxBytes);
  const tokens =
    text.match(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) || [];
  let i = 0;
  const consume = () => {
    const token = tokens[i++];
    if (token === '{' || token === '[') {
      const object = token === '{',
        close = object ? '}' : ']',
        keys = new Set<string>();
      while (tokens[i] !== close) {
        if (object) {
          const key = JSON.parse(tokens[i++]) as string;
          if (keys.has(key)) throw new Error(`Chave JSON duplicada: ${key}`);
          keys.add(key);
          i++; // colon; JSON.parse already verified grammar.
        }
        consume();
        if (tokens[i] === ',') i++;
      }
      i++;
    }
  };
  consume();
  return result;
}
