import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'vite';
import { zipSync, strToU8 } from 'fflate';
const [command, input, output] = process.argv.slice(2);
if (!['validate', 'pack'].includes(command) || !input) {
  console.error(
    'Uso: npm run plugins:validate -- pacote.osplugin (ou manifest.json)\n     npm run plugins:pack -- pasta/manifest.json saida.osplugin',
  );
  process.exit(1);
}
const server = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const {
    validateManifest,
    pluginCompatibility,
    safePackagePath,
    parsePluginJson,
  } = await server.ssrLoadModule('/src/plugins/contracts.ts');
  const { inspectPluginPackage, sha256 } = await server.ssrLoadModule(
    '/src/plugins/package.ts',
  );
  const bytes = new Uint8Array(await readFile(input));
  let result;
  if (command === 'pack') {
    if (!output?.endsWith('.osplugin'))
      throw new Error('Informe um arquivo de saída .osplugin.');
    const raw = parsePluginJson(new TextDecoder().decode(bytes));
    // files declares the allowed payload explicitly; update sizes/hashes from disk.
    const data = Object.create(null);
    for (const name of Object.keys(raw.files || {})) {
      safePackagePath(name);
      if (name === 'manifest.json')
        throw new Error('Manifesto não pode incluir hash de si mesmo.');
      const path = resolve(dirname(input), name);
      const parts = name.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const part = resolve(dirname(input), ...parts.slice(0, i));
        if ((await lstat(part)).isSymbolicLink())
          throw new Error('Links simbólicos recusados.');
      }
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
        throw new Error('Arquivo de pacote inválido/muito grande.');
      const content = new Uint8Array(await readFile(path));
      data[name] = content;
      raw.files[name] = { size: content.length, sha256: await sha256(content) };
    }
    validateManifest(raw);
    data['manifest.json'] = strToU8(JSON.stringify(raw, null, 2) + '\n');
    const packageBytes = zipSync(data, {
      level: 0,
      mtime: new Date(2020, 0, 1),
    });
    result = await inspectPluginPackage(packageBytes);
    await writeFile(output, packageBytes);
  } else if (input.endsWith('.osplugin'))
    result = await inspectPluginPackage(bytes);
  else
    result = {
      manifest: validateManifest(
        parsePluginJson(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        ),
      ),
    };
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const m = result.manifest;
  console.log(
    JSON.stringify(
      {
        valid: true,
        id: m.id,
        version: m.version,
        sha256: result.sha256,
        size: result.size,
        compatibility: pluginCompatibility(m, {
          appVersion: pkg.version,
          platform:
            process.platform === 'win32'
              ? 'windows'
              : process.platform === 'darwin'
                ? 'macos'
                : 'linux',
          architecture: process.arch === 'arm64' ? 'aarch64' : 'x86_64',
        }),
        executionEnabled: false,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await server.close();
}
