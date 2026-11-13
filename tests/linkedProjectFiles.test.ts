import { describe, expect, it } from 'vitest';
import {
  linkProjectFile,
  projectFilePath,
} from '../src/domain/linkedProjectFiles';
import { decodeProject, emptyProject } from '../src/domain/model';

describe('vínculos de arquivos', () => {
  it.each([
    '../exterior.txt',
    'pasta/../exterior.txt',
    'pasta/./arquivo.txt',
    'pasta//arquivo.txt',
    '/arquivo.txt',
    'C:/arquivo.txt',
    'pasta\\arquivo.txt',
    'pasta/arquivo.txt:oculto',
    'pasta/CON.txt',
    'pasta/arquivo.txt ',
    'SAVE-V1/projeto.armstruct.json',
  ])('rejeita %s', (path) => {
    expect(() => projectFilePath(path)).toThrow();
  });

  it('preserva o documento, evita duplicação e conserva o vínculo no formato 34', () => {
    const before = emptyProject();
    const after = linkProjectFile(before, 'Referências/Planta.armstruct.json');
    expect(after).toEqual({
      ...before,
      schema: 'armadurastruct/34',
      linkedFiles: ['Referências/Planta.armstruct.json'],
    });
    expect(linkProjectFile(after, 'referências/planta.armstruct.json')).toBe(
      after,
    );
    expect(decodeProject(JSON.stringify(after)).linkedFiles).toEqual(
      after.linkedFiles,
    );
    expect(decodeProject(JSON.stringify(before)).linkedFiles).toBeUndefined();
    expect(() =>
      decodeProject(JSON.stringify({ ...after, schema: before.schema })),
    ).toThrow('formato 34');
    expect(() =>
      decodeProject(JSON.stringify({ ...after, linkedFiles: ['a', 'A'] })),
    ).toThrow('repetidos');
    expect(() =>
      decodeProject(JSON.stringify({ ...after, linkedFiles: ['/fora'] })),
    ).toThrow();
  });
});
