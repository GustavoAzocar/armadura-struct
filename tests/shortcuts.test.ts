import { describe, expect, it, vi } from 'vitest';
import {
  eventKey,
  normalizeAlias,
  normalizeKey,
  shortcutCatalog,
} from '../src/domain/shortcuts';
import {
  bindingConflicts,
  compileShortcuts,
  decodeShortcuts,
  defaultShortcuts,
  parseAliases,
  readShortcuts,
  saveShortcuts,
  reassignBindings,
  serializeShortcuts,
  setBindings,
  shortcutHelp,
} from '../src/lib/shortcutPreferences';

const maskAliases = {
  L: 'mask-line',
  PL: 'mask-polyline',
  REC: 'mask-rectangle',
  C: 'mask-circle',
  M: 'mask-move',
  CO: 'mask-copy',
  CP: 'mask-copy',
  RO: 'mask-rotate',
  MI: 'mask-mirror',
  O: 'mask-offset',
  TR: 'mask-trim',
  EX: 'mask-extend',
  MA: 'match-properties',
  SC: 'mask-calibrate',
  DI: 'measure',
  AA: 'measure-contour',
  DLI: 'dimension-orthogonal',
  DAL: 'dimension-aligned',
  E: 'mask-erase',
};
const elementAliases = {
  L: 'bar',
  PL: 'polyline',
  C: 'copy',
  M: 'move',
  E: 'stirrup',
  HELICOIDAL: 'helix',
  ESTRIBOHELICOIDAL: 'helix',
  CRITERIOSHELICOIDAL: 'helix-criteria',
  MOVER: 'move',
  ROTACIONAR: 'rotate',
  GIRAR: 'rotate',
  ESPELHAR: 'mirror',
};
const immediate = {
  B: 'bar',
  E: 'stirrup',
  R: 'detail',
  D: 'distribute',
  V: 'select',
  H: 'pan',
  F: 'fit',
  M: 'move',
  C: 'copy',
  Delete: 'delete',
  'Mod+S': 'save',
  'Mod+O': 'open',
  'Mod+Z': 'undo',
  'Mod+Shift+Z': 'redo',
  'Mod+Y': 'redo',
  F3: 'snap',
  F8: 'ortho',
  F4: 'sidebar',
  'Mod+F1': 'toggle-ribbon',
  'Mod+0': 'focus',
};

describe('catálogo e resolução dos atalhos', () => {
  const preferences = defaultShortcuts();
  const maps = compileShortcuts(preferences);
  it.each(Object.entries(maskAliases))(
    'Máscaras: %s + Enter → %s',
    (alias, action) => expect(maps.masks.aliases.get(alias)).toBe(action),
  );
  it.each(Object.entries(elementAliases))(
    'Fora de Máscaras: %s + Enter → %s',
    (alias, action) => expect(maps.drawing.aliases.get(alias)).toBe(action),
  );
  it.each(Object.entries(immediate))(
    'Nos dois contextos: %s → %s',
    (key, action) => {
      expect(maps.masks.keys.get(key)).toBe(action);
      expect(maps.drawing.keys.get(key)).toBe(action);
    },
  );
  it('reúne comandos com e sem padrões e mantém separados os dois tipos de entrada', () => {
    expect(bindingConflicts(preferences)).toEqual([]);
    expect(Object.keys(shortcutCatalog)).toEqual(
      expect.arrayContaining([
        'mask-text',
        'mask-control',
        'symbols',
        'import',
        'associate-masks',
        'stirrup-criteria',
        'repeat',
        'convert',
        'follow',
        'interpret-cad',
        'range',
        'edit-segment',
        'lengthen-bar',
        'join',
        'split',
      ]),
    );
    expect(maps.drawing.aliases.get('FAIXA')).toBe('range');
    expect(maps.masks.aliases.get('ESTRIBO')).toBe('stirrup');
    expect(maps.masks.aliases.get('BARRA')).toBe('bar');
    expect(maps.drawing.aliases.get('APAGARMASCARA')).toBe('mask-erase');
    expect(maps.drawing.aliases.get('RO')).toBeUndefined();
    expect(maps.masks.keys.has('PL')).toBe(false);
  });
  it('desativa teclas únicas e preserva aliases e combinações', () => {
    const disabled = { ...preferences, singleKeysDisabled: true };
    const web = compileShortcuts(disabled);
    expect(web.masks.keys.get('B')).toBeUndefined();
    expect(web.masks.keys.get('F3')).toBeUndefined();
    expect(web.masks.keys.get('Mod+0')).toBe('focus');
    expect(web.masks.keys.get('Mod+S')).toBe('save');
    expect(web.masks.aliases.get('B')).toBe('bar');
    expect(shortcutHelp(disabled, 'bar', 'masks')).toBe(
      'B + Enter / BARRA + Enter',
    );
  });
});

describe('normalização e conflitos', () => {
  it.each([
    'Escape',
    'Enter',
    'Shift+Tab',
    ' ',
    'Alt+Space',
    'Shift',
    'Ctrl+Ctrl+B',
    'Alt+F4',
    'Ctrl+Alt+E',
    'Ctrl+T',
    'F5',
    'Mod+L',
  ])('reserva %s', (key) => expect(normalizeKey(key)).toBeUndefined());
  it.each([
    [' shift + cTrL + z ', 'Mod+Shift+Z'],
    ['cmd+s', 'Mod+S'],
    ['F8', 'F8'],
    ['alt+b', 'Alt+B'],
  ])('normaliza %s para %s', (raw, expected) =>
    expect(normalizeKey(raw)).toBe(expected),
  );
  it('trata caixa, acentos e entradas reservadas na linha de comandos', () => {
    expect(normalizeAlias('  círculo ')).toBe('CIRCULO');
    expect(parseAliases('c, C')).toBeUndefined();
    expect(parseAliases('B, , D')).toBeUndefined();
    expect(parseAliases('')).toEqual([]);
    for (const value of [
      '@5<90',
      '1200.5',
      '0;50',
      'FINAL',
      'cm',
      'REFERÊNCIA',
    ])
      expect(normalizeAlias(value)).toBeUndefined();
  });
  it('rejeita composição, AltGr e teclas mortas', () => {
    const key = (partial: Partial<KeyboardEvent>) =>
      eventKey({
        key: 'b',
        getModifierState: () => false,
        ...partial,
      } as KeyboardEvent);
    expect(key({ metaKey: true })).toBe('Mod+B');
    expect(
      key({ getModifierState: (modifier) => modifier === 'AltGraph' }),
    ).toBeUndefined();
    expect(key({ isComposing: true })).toBeUndefined();
    expect(key({ key: 'Dead' })).toBeUndefined();
    expect(key({ ctrlKey: true, altKey: true })).toBeUndefined();
  });
  it('permite contextos exclusivos e detecta a interseção com associação global', () => {
    const location = {
      action: 'mask-line',
      scope: 'masks',
      kind: 'keys',
    } as const;
    const original = defaultShortcuts();
    let draft = setBindings(original, location, ['Alt+B']);
    draft = setBindings(
      draft,
      { action: 'bar', scope: 'drawing', kind: 'keys' },
      ['Alt+B'],
    );
    expect(bindingConflicts(draft)).toHaveLength(0);
    const map = compileShortcuts(draft);
    expect(map.masks.keys.get('Alt+B')).toBe('mask-line');
    expect(map.drawing.keys.get('Alt+B')).toBe('bar');
    const conflict = setBindings(draft, { ...location, scope: 'global' }, [
      'B',
    ]);
    expect(bindingConflicts(conflict)).toHaveLength(1);
    expect(original.bindings.bar.global.keys).toEqual(['B']);
    const restored = reassignBindings(conflict, 'mask-line', {
      ...location,
      scope: 'global',
    });
    expect(bindingConflicts(restored)).toHaveLength(0);
    expect(compileShortcuts(restored).masks.keys.get('B')).toBe('mask-line');
    expect(restored.bindings.bar.global.keys).toEqual([]);
  });
});

describe('preferências versionadas', () => {
  it('grava somente diferenças, inclusive remoção explícita, e recupera novos comandos do catálogo', () => {
    const prefs = setBindings(
      defaultShortcuts(),
      { action: 'bar', scope: 'global', kind: 'keys' },
      [],
    );
    const data = serializeShortcuts(prefs);
    expect(JSON.parse(data).overrides).toEqual({
      bar: { global: { keys: [] } },
    });
    const loaded = decodeShortcuts(data);
    expect(loaded.preferences).toEqual(prefs);
    expect(loaded.warning).toBeUndefined();
    expect(loaded.preferences.bindings.stirrup.global.keys).toEqual(['E']);
  });
  it.each(['{', '{"version":0}', '{"version":3,"overrides":{}}'])(
    'recupera formato inválido ou desconhecido: %s',
    (raw) => {
      expect(decodeShortcuts(raw)).toMatchObject({
        preferences: defaultShortcuts(),
        warning: expect.any(String),
      });
      expect(decodeShortcuts(null).warning).toBeUndefined();
    },
  );
  it('carrega os padrões e informa quando o armazenamento fica indisponível', () => {
    const unavailable = () => {
      throw new Error('armazenamento indisponível');
    };
    vi.stubGlobal('localStorage', {
      getItem: unavailable,
      setItem: unavailable,
    });
    try {
      expect(readShortcuts()).toMatchObject({
        preferences: defaultShortcuts(),
        warning: expect.any(String),
      });
      expect(saveShortcuts(defaultShortcuts())).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('preserva escolhas válidas e elimina conflitos, IDs removidos e associações inválidas', () => {
    const prefs = decodeShortcuts(
      JSON.stringify({
        version: 1,
        singleKeysDisabled: false,
        overrides: {
          'id-removido': { global: { keys: ['J'] } },
          bar: { global: { keys: ['e'] } },
          'mask-rotate': { masks: { aliases: ['@100,200'] } },
          stirrup: { global: { aliases: ['ESTRIBO', 'EST'] } },
        },
      }),
    );
    expect(prefs.warning).toBeDefined();
    expect(bindingConflicts(prefs.preferences)).toHaveLength(0);
    expect(prefs.preferences.bindings.bar.global.keys).toEqual(['E']);
    expect(prefs.preferences.bindings.stirrup.global.keys).toEqual([]);
    expect(prefs.preferences.bindings.stirrup.global.aliases).toEqual([
      'ESTRIBO',
      'EST',
    ]);
    expect(prefs.preferences.bindings['mask-rotate'].masks.aliases).toContain(
      'RO',
    );
  });
});
