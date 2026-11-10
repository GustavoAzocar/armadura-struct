/** Portable package conformance tooling; never loads any packaged code. */
import { unzipSync } from 'fflate';
import {
  safePackagePath,
  validateManifest,
  parsePluginJson,
} from './contracts';
export const MAX_PLUGIN_PACKAGE = 16 * 1024 * 1024;
export async function sha256(data: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function inspectPluginPackage(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > MAX_PLUGIN_PACKAGE)
    throw new Error('Pacote deve ter até 16 MiB.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (i: number) => v.getUint16(i, true),
    u32 = (i: number) => v.getUint32(i, true);
  const match = (i: number, a: number[]) =>
    a.every((n, j) => bytes[i + j] === n);
  const end = bytes.length - 22;
  if (
    !match(end, [80, 75, 5, 6]) ||
    u16(end + 20) ||
    u16(end + 4) ||
    u16(end + 6)
  )
    throw new Error('ZIP com comentários/ZIP64/multipartes recusado.');
  const count = u16(end + 10),
    start = u32(end + 16);
  if (
    !count ||
    count > 256 ||
    count !== u16(end + 8) ||
    start + u32(end + 12) !== end
  )
    throw new Error('Diretório ZIP inválido.');
  let p = start,
    local = 0,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (!match(p, [80, 75, 1, 2])) throw new Error('Cabeçalho ZIP inválido.');
    const n = u16(p + 28),
      extra = u16(p + 30),
      comment = u16(p + 32),
      compressed = u32(p + 20),
      expanded = u32(p + 24),
      flags = u16(p + 8),
      method = u16(p + 10);
    const nameBytes = bytes.subarray(p + 46, p + 46 + n);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    safePackagePath(name);
    if (nameBytes.length !== n || names.has(name.toLowerCase()))
      throw new Error('Entradas ZIP duplicadas/ambíguas.');
    names.add(name.toLowerCase());
    const mode = u32(p + 38) >>> 16,
      type = mode & 0o170000;
    if (
      extra ||
      comment ||
      u16(p + 34) ||
      flags & ~0x800 ||
      ![0, 8].includes(method) ||
      (type && type !== 0o100000)
    )
      throw new Error('ZIP contém tipo/recursos sem suporte.');
    if (
      expanded > MAX_PLUGIN_PACKAGE ||
      expanded > Math.max(1, compressed) * 100 ||
      (total += expanded) > 64 * 1024 * 1024
    )
      throw new Error('Expansão ZIP desproporcional.');
    if (
      u32(p + 42) !== local ||
      !match(local, [80, 75, 3, 4]) ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== n ||
      u16(local + 28)
    )
      throw new Error('Cabeçalho local ZIP inválido.');
    for (let j = 0; j < 12; j++)
      if (bytes[local + 14 + j] !== bytes[p + 16 + j])
        throw new Error('ZIP divergente.');
    for (let j = 0; j < n; j++)
      if (bytes[local + 30 + j] !== nameBytes[j])
        throw new Error('Caminho local ZIP divergente.');
    local += 30 + n + compressed;
    if (local > start) throw new Error('ZIP sobreposto.');
    p += 46 + n;
  }
  if (p !== end || local !== start) throw new Error('Dados extras no ZIP.');
  for (const name of names) {
    const parts = name.split('/');
    for (let n = 1; n < parts.length; n++)
      if (names.has(parts.slice(0, n).join('/')))
        throw new Error('Arquivo colide com diretório.');
  }
  const files = unzipSync(bytes);
  if (!files['manifest.json'] || files['manifest.json'].length > 128 * 1024)
    throw new Error('manifest.json ausente/muito grande.');
  const manifest = validateManifest(
    parsePluginJson(
      new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json']),
    ),
  );
  if (Object.keys(manifest.files).length + 1 !== count)
    throw new Error('Arquivos não declarados/ausentes.');
  for (const [name, data] of Object.entries(files)) {
    if (name === 'manifest.json') continue;
    const expected = manifest.files[name];
    if (
      !expected ||
      expected.size !== data.length ||
      expected.sha256 !== (await sha256(data))
    )
      throw new Error('Integridade divergente.');
  }
  return { manifest, size: bytes.length, sha256: await sha256(bytes) };
}
