// Runs only after the desktop build on isolated CI runners. Never run on a user's installation.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
if (process.env.CI !== 'true')
  throw new Error('Este teste exige um runner CI isolado.');
const kind = process.platform === 'win32' ? 'nsis' : 'appimage';
const dir = resolve('src-tauri/target/release/bundle', kind);
const extension = kind === 'nsis' ? '.exe' : '.AppImage';
const files = readdirSync(dir).filter((n) => n.endsWith(extension));
if (files.length !== 1)
  throw new Error('Esperado exatamente um pacote nativo do build atual.');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const result = spawnSync(
  'cargo',
  [
    'test',
    '--manifest-path',
    'crates/openstruct-distribution/Cargo.toml',
    'native_adapter_real_package',
    '--',
    '--ignored',
    '--test-threads=1',
  ],
  {
    stdio: 'inherit',
    shell: false,
    timeout: 600000,
    env: {
      ...process.env,
      OPENSTRUCT_NATIVE_SANDBOX: '1',
      OPENSTRUCT_TEST_PACKAGE: resolve(dir, files[0]),
      OPENSTRUCT_TEST_VERSION: version,
      APPIMAGE_EXTRACT_AND_RUN: '1',
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
