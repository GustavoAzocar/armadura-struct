import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseVersion(tag) {
  assert.match(
    tag ?? '',
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    'Use uma tag SemVer como v0.5.0 ou v0.6.0-beta.1.',
  );
  const version = tag.slice(1);
  for (const part of (version.split('-').slice(1).join('-') || '').split('.'))
    assert.ok(
      !/^0\d+$/.test(part),
      'Pré-lançamento numérico com zero inicial.',
    );
  return version;
}

async function resolveTag(reference, request) {
  let object = reference.object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++)
    object = (await request(`git/tags/${object.sha}`)).object;
  assert.equal(object.type, 'commit', 'A tag precisa apontar para um commit.');
  return object.sha;
}

export async function prepareRelease(
  { event, ref, sha, payload, inputTag, releaseRequest },
  request,
) {
  let tag;
  let commit;
  let reference;
  if (ref.startsWith('refs/tags/')) {
    tag = ref.slice('refs/tags/'.length);
    releaseVersion(tag);
    reference = await request(`git/ref/tags/${encodeURIComponent(tag)}`);
    commit = await resolveTag(reference, request);
  } else if (event === 'workflow_dispatch') {
    tag = inputTag;
    releaseVersion(tag);
    reference = await request(
      `git/ref/tags/${encodeURIComponent(tag)}`,
      'GET',
      undefined,
      true,
    );
    commit = reference ? await resolveTag(reference, request) : sha;
  } else {
    assert.equal(event, 'push');
    assert.equal(
      ref,
      `refs/heads/${payload.repository.default_branch}`,
      'Solicitações de release usam a branch padrão.',
    );
    assert.equal(
      releaseRequest?.schemaVersion,
      1,
      'Solicitação de release inválida.',
    );
    tag = releaseRequest.tag;
    releaseVersion(tag);
    commit = releaseRequest.commit;
    reference = await request(
      `git/ref/tags/${encodeURIComponent(tag)}`,
      'GET',
      undefined,
      true,
    );
  }
  assert.match(
    commit ?? '',
    /^[a-f0-9]{40}$/,
    'Informe o SHA completo do código a publicar.',
  );
  const readSource = async (path) => {
    const file = await request(`contents/${path}?ref=${commit}`);
    assert.equal(
      file.encoding,
      'base64',
      'Conteúdo de código-fonte indisponível.',
    );
    return Buffer.from(file.content, 'base64').toString('utf8');
  };
  const [packageText, configText, cargoText] = await Promise.all([
    readSource('package.json'),
    readSource('src-tauri/tauri.conf.json'),
    readSource('src-tauri/Cargo.toml'),
  ]);
  const version = releaseVersion(tag);
  assert.equal(
    JSON.parse(packageText).version,
    version,
    'package.json difere da tag.',
  );
  assert.equal(JSON.parse(configText).version, version, 'Tauri difere da tag.');
  const section = cargoText.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  assert.equal(
    section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    version,
    'Cargo difere da tag.',
  );
  if (reference)
    assert.equal(
      await resolveTag(reference, request),
      commit,
      'A tag existente aponta para outro commit. Use uma nova versão.',
    );
  else
    await request('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha: commit });
  return { tag, commit };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  assert.match(repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(token, 'Token do workflow ausente.');
  const payload = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  let releaseRequest;
  if (
    process.env.GITHUB_EVENT_NAME === 'push' &&
    !process.env.GITHUB_REF.startsWith('refs/tags/')
  )
    releaseRequest = JSON.parse(
      await readFile('.github/release-request.json', 'utf8'),
    );
  const request = async (path, method = 'GET', body, optional = false) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'OpenStruct-Release',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (optional && response.status === 404) return null;
    assert.ok(
      response.ok,
      `GitHub HTTP ${response.status} em ${path}. Confira o código desktop e as permissões do workflow.`,
    );
    return response.json();
  };
  const result = await prepareRelease(
    {
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
      payload,
      inputTag: process.env.RELEASE_INPUT_TAG,
      releaseRequest,
    },
    request,
  );
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `tag=${result.tag}\ncommit=${result.commit}\n`,
  );
  console.log(`Versão preparada: ${result.tag} · código ${result.commit}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
