import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareRelease,
  releaseVersion,
} from '../openstruct-release-request.mjs';

const commit = 'a'.repeat(40);
function fixture({ existing = null, version = '0.5.0' } = {}) {
  const writes = [];
  const request = async (path, method = 'GET', body) => {
    if (method === 'POST') {
      writes.push(body);
      return {};
    }
    if (path.startsWith('git/ref/tags/')) return existing;
    let content;
    if (path.startsWith('contents/package.json'))
      content = JSON.stringify({ version });
    if (path.startsWith('contents/src-tauri/tauri.conf.json'))
      content = JSON.stringify({ version });
    if (path.startsWith('contents/src-tauri/Cargo.toml'))
      content = `[package]\nname = "app"\nversion = "${version}"\n`;
    assert.ok(content, path);
    return {
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
    };
  };
  const context = {
    event: 'push',
    ref: 'refs/heads/master',
    sha: 'b'.repeat(40),
    payload: { repository: { default_branch: 'master' } },
    releaseRequest: { schemaVersion: 1, tag: 'v0.5.0', commit },
  };
  return { request, writes, context };
}

test('solicitação cria a tag no commit explicitamente aprovado, sem usar o commit do workflow', async () => {
  const f = fixture();
  assert.deepEqual(await prepareRelease(f.context, f.request), {
    tag: 'v0.5.0',
    commit,
  });
  assert.deepEqual(f.writes, [{ ref: 'refs/tags/v0.5.0', sha: commit }]);
});
test('reexecução preserva uma tag existente e recusa alterar seu código', async () => {
  const f = fixture({ existing: { object: { type: 'commit', sha: commit } } });
  await prepareRelease(f.context, f.request);
  assert.equal(f.writes.length, 0);
  f.context.releaseRequest.commit = 'c'.repeat(40);
  await assert.rejects(prepareRelease(f.context, f.request), /outro commit/);
  assert.equal(f.writes.length, 0);
});
test('nenhuma tag é criada se a versão ou a branch não corresponderem', async () => {
  const f = fixture({ version: '0.6.0' });
  await assert.rejects(prepareRelease(f.context, f.request), /difere/);
  f.context.ref = 'refs/heads/work-in-progress';
  await assert.rejects(prepareRelease(f.context, f.request), /branch padrão/);
  assert.equal(f.writes.length, 0);
});
test('publicação manual prepara a tag da versão selecionada', async () => {
  const f = fixture();
  await prepareRelease(
    {
      ...f.context,
      event: 'workflow_dispatch',
      inputTag: 'v0.5.0',
      sha: commit,
    },
    f.request,
  );
  assert.deepEqual(f.writes, [{ ref: 'refs/tags/v0.5.0', sha: commit }]);
});
test('push de tag existente usa o commit da própria tag', async () => {
  const f = fixture({ existing: { object: { type: 'commit', sha: commit } } });
  assert.equal(
    (await prepareRelease({ ...f.context, ref: 'refs/tags/v0.5.0' }, f.request))
      .commit,
    commit,
  );
  assert.equal(f.writes.length, 0);
});
test('tags seguem SemVer e não aceitam referências ou comandos', () => {
  assert.equal(releaseVersion('v0.6.0-beta.1'), '0.6.0-beta.1');
  for (const tag of [
    'master',
    'v01.2.3',
    'v1.2.3-beta.01',
    'v1.2.3+build',
    'v1.2.3;echo',
  ])
    assert.throws(() => releaseVersion(tag));
});
