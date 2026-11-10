import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  RECENT_STORAGE_KEY,
  clearRecents,
  readRecents,
  recentDirectory,
  recentLabels,
  recordRecent,
  removeRecent,
  type RecentInput,
} from '../src/lib/recentProjects';

const memory = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const file = (
  projectId: string,
  fileName = 'projeto.armstruct.json',
  location?: string,
  name = 'Projeto',
): RecentInput => ({ kind: 'file', projectId, name, fileName, location });
let s: ReturnType<typeof memory>;
beforeEach(() => {
  s = memory();
});

describe('histórico de recentes', () => {
  it('abrir A, B e A de novo resulta em A/B sem duplicar', () => {
    recordRecent(file('a', 'a.json', '/p/a.json', 'A'), 1, s);
    recordRecent(file('b', 'b.json', '/p/b.json', 'B'), 2, s);
    const list = recordRecent(file('a', 'a.json', '/p/a.json', 'A'), 3, s);
    expect(list.map((e) => e.name)).toEqual(['A', 'B']);
    expect(list[0].openedAt).toBe(3);
    expect(readRecents(s).map((e) => e.name)).toEqual(['A', 'B']);
  });
  it('mantém distinguíveis dois "Projeto" de locais ou ids diferentes', () => {
    recordRecent(file('p1', 'projeto.json', '/x/projeto.json'), 1, s);
    recordRecent(file('p2', 'projeto.json', '/y/projeto.json'), 2, s);
    recordRecent(file('p1', 'projeto.json', '/z/projeto.json'), 3, s);
    const list = readRecents(s);
    expect(list).toHaveLength(3);
    const labels = recentLabels(list);
    expect(
      new Set([...labels.values()].map((l) => l.title + l.detail)).size,
    ).toBe(3);
    expect(labels.get(list[0].key)?.title).toContain('ID p1');
  });
  it('no web, sem caminho, distingue por projeto e nome do arquivo', () => {
    recordRecent(file('p1', 'a.json'), 1, s);
    recordRecent(file('p1', 'b.json'), 2, s);
    recordRecent(file('p1', 'a.json'), 3, s);
    expect(readRecents(s).map((e) => e.fileName)).toEqual(['a.json', 'b.json']);
  });
  it('tipos diferentes com o mesmo projeto não se fundem', () => {
    recordRecent(file('p1', 'a.json', '/x/a.json'), 1, s);
    recordRecent(
      {
        kind: 'folder',
        projectId: 'p1',
        name: 'P',
        fileName: 'x',
        location: '/x',
      },
      2,
      s,
    );
    expect(readRecents(s)).toHaveLength(2);
  });
  it('limita aos mais recentes', () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i++)
      recordRecent(file(`p${i}`, 'a.json', `/p/${i}.json`, `P${i}`), i + 1, s);
    const list = readRecents(s);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].name).toBe(`P${RECENT_LIMIT + 4}`);
    expect(list.at(-1)!.name).toBe('P5');
  });
  it('ordena por abertura mesmo com armazenamento fora de ordem', () => {
    s.m.set(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { ...file('a', 'a.json'), openedAt: 1 },
          { ...file('b', 'b.json'), openedAt: 9 },
        ],
      }),
    );
    expect(readRecents(s).map((e) => e.projectId)).toEqual(['b', 'a']);
  });
  it.each([
    ['json quebrado', '{{'],
    ['versão desconhecida', JSON.stringify({ v: 2, items: [] })],
    ['itens não lista', JSON.stringify({ v: 1, items: 'x' })],
    ['nulo', 'null'],
  ])('persistência inválida (%s) vira lista vazia', (_n, raw) => {
    s.m.set(RECENT_STORAGE_KEY, raw);
    expect(readRecents(s)).toEqual([]);
    expect(recordRecent(file('a'), 1, s)).toHaveLength(1);
  });
  it('descarta só entradas malformadas e preserva as válidas', () => {
    s.m.set(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { ...file('ok', 'ok.json'), openedAt: 5 },
          {
            kind: 'exe',
            projectId: 'x',
            name: 'x',
            fileName: 'x',
            openedAt: 1,
          },
          { ...file('neg'), openedAt: -1 },
          { ...file('nan'), openedAt: 'ontem' },
          null,
          42,
        ],
      }),
    );
    expect(readRecents(s).map((e) => e.projectId)).toEqual(['ok']);
  });
  it('não confia na chave armazenada', () => {
    s.m.set(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { ...file('a', 'a.json'), openedAt: 2, key: 'forjada' },
          { ...file('a', 'a.json'), openedAt: 1, key: 'outra' },
        ],
      }),
    );
    expect(readRecents(s)).toHaveLength(1);
  });
  it('armazenamento indisponível ou cheio não lança erro', () => {
    const broken = {
      getItem: () => {
        throw new Error('negado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
      removeItem: () => {
        throw new Error('negado');
      },
    };
    expect(readRecents(broken)).toEqual([]);
    expect(() => recordRecent(file('a'), 1, broken)).not.toThrow();
    expect(() => removeRecent('k', broken)).not.toThrow();
    expect(clearRecents(broken)).toEqual([]);
    expect(readRecents(undefined)).toEqual([]);
  });
  it('rejeita entrada inválida sem alterar o histórico', () => {
    recordRecent(file('a'), 1, s);
    const list = recordRecent({ ...file('b'), name: '' }, 2, s);
    expect(list.map((e) => e.projectId)).toEqual(['a']);
  });
  it('remove uma entrada e limpa tudo sem tocar em outros dados', () => {
    s.m.set('armadurastruct.canvas', 'light');
    const a = recordRecent(file('a', 'a.json'), 1, s)[0];
    recordRecent(file('b', 'b.json'), 2, s);
    expect(removeRecent(a.key, s).map((e) => e.projectId)).toEqual(['b']);
    expect(removeRecent('inexistente', s)).toHaveLength(1);
    expect(clearRecents(s)).toEqual([]);
    expect(readRecents(s)).toEqual([]);
    expect(s.m.get('armadurastruct.canvas')).toBe('light');
  });
  it('extrai o diretório de caminhos POSIX e Windows', () => {
    const e = (location?: string) =>
      readRecents(
        (() => {
          const t = memory();
          recordRecent(file('a', 'a.json', location), 1, t);
          return t;
        })(),
      )[0];
    expect(recentDirectory(e('/home/u/obras/a.json'))).toBe('/home/u/obras');
    expect(recentDirectory(e('C:\\Obras\\a.json'))).toBe('C:\\Obras');
    expect(recentDirectory(e(undefined))).toBeUndefined();
  });
});
