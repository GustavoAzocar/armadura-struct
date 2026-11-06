import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Dependency-free so this helper can be installed in every desktop product.
const version = process.argv[2];
assert.match(
  version ?? '',
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  'Informe uma versão SemVer sem v, por exemplo 0.3.1 ou 0.4.0-beta.1',
);
for (const part of (version.split('-').slice(1).join('-') || '').split('.'))
  assert.ok(
    !/^0\d+$/.test(part),
    'Identificador numérico de pré-lançamento com zero inicial',
  );
const changes = new Map();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const old = pkg.version;
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const cargo = await readFile('src-tauri/Cargo.toml', 'utf8');
assert.equal(
  config.version,
  old,
  'Sincronize a versão atual antes de continuar',
);
assert.equal(
  cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1],
  old,
);
pkg.version = version;
config.version = version;
for (const window of config.app?.windows ?? []) {
  if (window.title?.endsWith(old))
    window.title = window.title.slice(0, -old.length) + version;
}
changes.set('package.json', JSON.stringify(pkg, null, 2) + '\n');
changes.set(
  'src-tauri/tauri.conf.json',
  JSON.stringify(config, null, 2) + '\n',
);
const manifests = ['src-tauri/Cargo.toml'];
const coreDirs = await readdir('crates', { withFileTypes: true }).catch(
  (error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  },
);
for (const directory of coreDirs.filter((entry) => entry.isDirectory()))
  manifests.push(join('crates', directory.name, 'Cargo.toml'));
const packages = [];
for (const path of manifests) {
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  const section = text.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  const current = section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (current !== old) continue;
  packages.push(section.match(/^name\s*=\s*"([^"]+)"/m)[1]);
  changes.set(
    path,
    text.replace(
      /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(".*$)/m,
      (_match, before, after) => before + version + after,
    ),
  );
}
for (const path of [
  'Cargo.lock',
  'src-tauri/Cargo.lock',
  ...coreDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('crates', entry.name, 'Cargo.lock')),
]) {
  let text;
  try {
    text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  for (const name of packages)
    text = text.replace(
      `name = "${name}"\nversion = "${old}"`,
      `name = "${name}"\nversion = "${version}"`,
    );
  changes.set(path, text);
}
try {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  changes.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const [path, content] of changes) await writeFile(path, content);
console.log(
  `Versão sincronizada: ${old} → ${version}. Revise o diff, faça o commit e só então crie a tag v${version}.`,
);
