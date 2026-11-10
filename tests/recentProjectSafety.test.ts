import { describe, expect, it } from 'vitest';
import { captureRecentContext } from '../src/lib/recentProjectSafety';

describe('reabertura assíncrona de recentes', () => {
  it('aceita apenas o documento e contexto que iniciaram a leitura', () => {
    const project = { id: 'a' };
    const assertCurrent = captureRecentContext(
      () => project,
      () => 'modelo',
    );
    expect(assertCurrent).not.toThrow();
  });

  it('recusa outra versão do documento, mesmo com o mesmo ID', () => {
    let project = { id: 'a', name: 'Antes' };
    const assertCurrent = captureRecentContext(
      () => project,
      () => 'modelo',
    );
    project = { ...project, name: 'Editado' };
    expect(assertCurrent).toThrow('projeto ou contexto mudou');
  });

  it('recusa troca de desenho ou isolamento sem alteração do documento', () => {
    const project = { id: 'a' };
    let context = 'desenho-1';
    const assertCurrent = captureRecentContext(
      () => project,
      () => context,
    );
    context = 'desenho-2';
    expect(assertCurrent).toThrow('Reinicie a abertura');
  });

  it('não aplica uma leitura atrasada sobre outro projeto', async () => {
    let project = { id: 'a' };
    const assertCurrent = captureRecentContext(
      () => project,
      () => 'modelo',
    );
    let complete!: (value: { id: string }) => void;
    const read = new Promise<{ id: string }>((resolve) => {
      complete = resolve;
    });
    const opening = (async () => {
      const next = await read;
      assertCurrent();
      project = next;
    })();
    project = { id: 'b' };
    complete({ id: 'recente' });
    await expect(opening).rejects.toThrow('projeto ou contexto mudou');
    expect(project.id).toBe('b');
  });
});
