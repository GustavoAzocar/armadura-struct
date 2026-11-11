import type { Tool } from './types';

export type Action =
  | Tool
  | 'stirrup-criteria'
  | 'welded-mesh-criteria'
  | 'beam-clamp-criteria'
  | 'cad-settings'
  | 'shortcuts'
  | 'toggle-ribbon'
  | 'mask-control'
  | 'symbols'
  | 'mask-calibrate'
  | 'match-properties'
  | 'mask-offset'
  | 'mask-trim'
  | 'mask-extend'
  | 'mask-copy'
  | 'mask-erase'
  | 'mask-move'
  | 'mask-mirror'
  | 'mask-rotate'
  | 'associate-masks'
  | 'measure-contour'
  | 'mask-line'
  | 'mask-rectangle'
  | 'mask-circle'
  | 'mask-polyline'
  | 'mask-text'
  | 'new'
  | 'open'
  | 'recent'
  | 'check-updates'
  | 'plugins-store'
  | 'plugins-offline'
  | 'plugins-installed'
  | 'plugins-develop'
  | 'save'
  | 'import'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'rotate'
  | 'mirror'
  | 'fit'
  | 'grid'
  | 'snap'
  | 'ortho'
  | 'dimensions'
  | 'pdf'
  | 'dxf'
  | 'csv'
  | 'csv-scoped'
  | 'insert-sheet-schedule'
  | 'schedule'
  | 'help'
  | 'join'
  | 'split'
  | 'refresh-schedule'
  | 'lock-schedule'
  | 'renumber'
  | 'sidebar'
  | 'focus'
  | 'group'
  | 'ungroup'
  | 'edit-detail'
  | 'finish-detail'
  | 'insert-detail'
  | 'update-detail'
  | 'export-detail'
  | 'interpret-cad'
  | 'detail-repetition'
  | 'fabrication'
  | 'clone-armature'
  | 'layers'
  | 'align-selection'
  | 'insert-vertex'
  | 'extend-vertex'
  | 'remove-vertex'
  | 'edit-segment'
  | 'lengthen-bar'
  | 'plot'
  | 'hide-objects'
  | 'isolate-objects'
  | 'show-all-objects'
  | 'show-hidden-objects'
  | 'end-object-isolation';

export const shortcutCategories = [
  'Geral',
  'Máscaras',
  'Armaduras',
  'Edição',
  'Navegação/Interface',
] as const;
export const shortcutScopes = ['global', 'masks', 'drawing'] as const;
export type ShortcutScope = (typeof shortcutScopes)[number];
export type WorkScope = Exclude<ShortcutScope, 'global'>;
export const scopeLabels: Record<ShortcutScope, string> = {
  global: 'Todos os contextos',
  masks: 'Máscaras',
  drawing: 'Fora de Máscaras',
};

type Bindings = { keys?: string[]; aliases?: string[] };
type Command = {
  name: string;
  category: (typeof shortcutCategories)[number];
  defaults: Partial<Record<ShortcutScope, Bindings>>;
  description?: string;
  needsDrawing?: boolean;
  selection?: number;
  blockedInIsolation?: boolean;
  blockedForGroup?: boolean;
};
type CommandRules = Omit<Command, 'name' | 'category' | 'defaults'>;
const command = (
  name: string,
  category: Command['category'],
  defaults: Command['defaults'] = {},
  rules: CommandRules = {},
): Command => ({ name, category, defaults, ...rules });
const global = (aliases: string[] = [], keys: string[] = []) => ({
  global: { aliases, keys },
});
const scoped = (
  masks: string[],
  drawing: string[],
  aliases: string[] = [],
  keys: string[] = [],
) => ({
  ...global(aliases, keys),
  masks: { aliases: masks },
  drawing: { aliases: drawing },
});

const general = 'Geral',
  masks = 'Máscaras',
  armatures = 'Armaduras',
  edit = 'Edição',
  navigation = 'Navegação/Interface';
const model = { needsDrawing: true };
const selected = { selection: 1 };
const individual = { ...selected, blockedForGroup: true };
const isolated = { blockedInIsolation: true };

export const shortcutCatalog: Record<Action, Command> = {
  new: command('Novo projeto', general, {}, isolated),
  open: command('Abrir projeto', general, global([], ['Mod+O']), isolated),
  recent: command('Projetos recentes', general, {}, isolated),
  save: command('Salvar projeto', general, global([], ['Mod+S'])),
  'cad-settings': command('Configurações CAD', general),
  shortcuts: command('Atalhos de teclado', general),
  help: command('Guia de uso', general),
  'check-updates': command('Verificar atualizações', general),
  'plugins-store': command('Loja de plugins', general),
  'plugins-offline': command('Instalar plugin offline', general),
  'plugins-installed': command('Meus plugins', general),
  'plugins-develop': command('Desenvolver plugins', general),
  pdf: command('Prancha PDF', general),
  dxf: command('Desenho DXF', general),
  csv: command('Quadro CSV', general),
  'csv-scoped': command('CSV por escopo', general),
  plot: command('Estilos de impressão', general, global(['PLOT', 'PLOTAGEM'])),
  'export-detail': command('Exportar pacote de detalhamento', general),
  'insert-detail': command('Inserir detalhamento', general, {}, isolated),
  'update-detail': command('Atualizar detalhamento', general, {}, isolated),

  'mask-line': command('Linha', masks, scoped(['L'], [], ['LINHA']), model),
  'mask-polyline': command(
    'Polilinha de máscara',
    masks,
    scoped(['PL'], [], ['MPL']),
    model,
  ),
  'mask-rectangle': command(
    'Retângulo',
    masks,
    scoped(['REC'], [], ['RETANGULO']),
    model,
  ),
  'mask-circle': command(
    'Círculo',
    masks,
    scoped(['C'], [], ['CIRCULO']),
    model,
  ),
  'mask-move': command(
    'Mover entidades da máscara',
    masks,
    scoped(['M', 'MOVER'], [], ['MOVERMASCARA', 'MMOVE']),
    model,
  ),
  'mask-copy': command(
    'Copiar entidades da máscara',
    masks,
    scoped(['CO', 'CP'], [], ['COPIARMASCARA', 'MCOPY']),
    model,
  ),
  'mask-rotate': command(
    'Rotacionar entidades da máscara',
    masks,
    scoped(['RO', 'ROTACIONAR', 'GIRAR'], [], ['ROTACIONARMASCARA', 'ROTATE']),
    model,
  ),
  'mask-mirror': command(
    'Espelhar entidades da máscara',
    masks,
    scoped(['MI', 'ESPELHAR'], [], ['ESPELHARMASCARA', 'MIRROR']),
    model,
  ),
  'mask-offset': command(
    'Offset / paralelas',
    masks,
    scoped(['O'], [], ['OFFSET', 'PARALELA']),
    model,
  ),
  'mask-trim': command(
    'Aparar máscara',
    masks,
    scoped(['TR'], [], ['AJUSTAR', 'APARAR', 'TRIM']),
    model,
  ),
  'mask-extend': command(
    'Estender máscara',
    masks,
    scoped(['EX'], [], ['EXTEND', 'ESTENDERMASCARA']),
    model,
  ),
  'match-properties': command(
    'Copiar propriedades',
    masks,
    scoped(['MA'], [], ['MATCHPROP', 'COPIARPROPRIEDADES']),
    model,
  ),
  'mask-calibrate': command(
    'Ajustar escala',
    masks,
    scoped(['SC'], [], ['CALIBRARMASCARA']),
    model,
  ),
  measure: command(
    'Medir distância',
    masks,
    scoped(['DI'], [], ['DIST', 'MEDIR']),
    model,
  ),
  'measure-contour': command(
    'Medir contorno',
    masks,
    scoped(['AA'], [], ['CONTORNO', 'PERIMETRO', 'AREA']),
    {
      ...model,
      description:
        'Mede comprimento ou perímetro e, para um contorno fechado, a área.',
    },
  ),
  'dimension-orthogonal': command(
    'Cota ortogonal',
    masks,
    scoped(['DLI'], [], ['COTA', 'DIM', 'DIMENSION']),
    model,
  ),
  'dimension-aligned': command(
    'Cota alinhada',
    masks,
    scoped(['DAL'], [], ['ALINHADA']),
    model,
  ),
  'mask-erase': command(
    'Apagar entidades da máscara',
    masks,
    scoped(['E'], [], ['APAGARMASCARA', 'ERASE']),
    model,
  ),
  'mask-text': command(
    'Texto de máscara',
    masks,
    global(['TEXTO', 'TEXT', 'DTEXT']),
    model,
  ),
  'mask-control': command('Controle de máscaras', masks, global(['MASCARAS'])),
  symbols: command('Biblioteca de símbolos', masks),
  import: command('Importar máscaras', masks, global(['IMPORTAR'])),
  'associate-masks': command('Associar máscaras do projeto', masks),

  bar: command(
    'Barra livre',
    armatures,
    scoped([], ['L'], ['B', 'BARRA'], ['B']),
    model,
  ),
  stirrup: command(
    'Estribo',
    armatures,
    scoped([], ['E'], ['ESTRIBO'], ['E']),
    model,
  ),
  'stirrup-criteria': command('Critérios do estribo', armatures, {}, model),
  repeat: command('Repetir estribo', armatures, global(['REPETIR']), {
    ...model,
    ...individual,
  }),
  detail: command(
    'Rebater armadura',
    armatures,
    global(['R', 'REBAT'], ['R']),
    { ...model, ...individual },
  ),
  distribute: command('Distribuir armadura', armatures, global(['D'], ['D']), {
    ...model,
    blockedForGroup: true,
  }),
  range: command('Faixa ortogonal', armatures, global(['FAIXA']), {
    ...model,
    ...individual,
  }),
  'welded-mesh': command(
    'Lançar tela',
    armatures,
    global(['TS', 'TELA']),
    model,
  ),
  'welded-mesh-criteria': command('Critérios de telas', armatures, {}, model),
  'beam-clamp': command(
    'Grampo de viga',
    armatures,
    global(['GV', 'GRAMPOVIGA']),
    model,
  ),
  'beam-clamp-criteria': command(
    'Critérios do grampo de viga',
    armatures,
    global(['CRITERIOSGRAMPO']),
    model,
  ),
  convert: command(
    'Converter polilinha',
    armatures,
    global(['CONVERTER']),
    model,
  ),
  follow: command('Seguir fôrma', armatures, global(['FORMA']), model),
  'interpret-cad': command('Interpretar CAD em armadura', armatures, {}, model),
  'edit-segment': command(
    'Editar comprimentos e ângulos',
    armatures,
    global(['SEGMENTOS']),
    { ...model, ...individual },
  ),
  'lengthen-bar': command(
    'Estender barra',
    armatures,
    global(['ESTENDER', 'ESTENDERBARRA']),
    { ...model, ...individual },
  ),
  join: command('Emendar poligonais', armatures, global(['EMENDAR']), {
    ...model,
    ...individual,
    selection: 2,
  }),
  split: command('Dividir barra', armatures, global(['DIVIDIR']), {
    ...model,
    ...individual,
  }),
  'detail-repetition': command(
    'Repetições do detalhamento',
    armatures,
    {},
    isolated,
  ),
  fabrication: command('Posições de fabricação', armatures, {}, isolated),
  schedule: command('Quadro de aço', armatures, global(['Q'])),
  'insert-sheet-schedule': command(
    'Inserir quadro na prancha',
    armatures,
    {},
    isolated,
  ),
  'refresh-schedule': command(
    'Atualizar RA',
    armatures,
    global(['RA']),
    isolated,
  ),
  'lock-schedule': command(
    'Bloquear / desbloquear RA',
    armatures,
    global(['BLOQUEARRA']),
    isolated,
  ),
  renumber: command('Renumerar', armatures, {}, isolated),

  move: command(
    'Mover elementos',
    edit,
    scoped([], ['M', 'MOVER'], ['MOVE'], ['M']),
    { ...model, ...selected },
  ),
  copy: command('Copiar elementos', edit, scoped([], ['C'], ['COPY'], ['C']), {
    ...model,
    ...individual,
  }),
  rotate: command(
    'Rotacionar elementos',
    edit,
    scoped([], ['ROTACIONAR', 'GIRAR']),
    { ...model, ...individual },
  ),
  mirror: command('Espelhar elementos', edit, scoped([], ['ESPELHAR']), {
    ...model,
    ...individual,
  }),
  delete: command(
    'Excluir seleção',
    edit,
    global(['DEL'], ['Delete']),
    selected,
  ),
  undo: command('Desfazer', edit, global(['U'], ['Mod+Z'])),
  redo: command('Refazer', edit, global(['REDO'], ['Mod+Shift+Z', 'Mod+Y'])),
  'align-selection': command(
    'Alinhar / distribuir seleção',
    edit,
    global(['ALINHAR']),
  ),
  'clone-armature': command(
    'Duplicar armadura completa',
    edit,
    global(['DUPLICAR', 'CLONAR', 'DUPLICARARMADURA']),
    selected,
  ),
  polyline: command(
    'Polilinha de elementos',
    edit,
    scoped([], ['PL'], ['POLILINHA']),
    model,
  ),
  leader: command('Chamada', edit, global(['CHAMADA']), model),
  section: command('Corte e chamada', edit, global(['CORTE']), model),
  'section-arc': command('Corte em arco', edit, global(['ARCO']), model),
  'insert-vertex': command(
    'Inserir vértice',
    edit,
    global(['INSERIRVERTICE']),
    { ...model, ...selected },
  ),
  'extend-vertex': command(
    'Continuar pela ponta',
    edit,
    global(['CONTINUAR']),
    { ...model, ...selected },
  ),
  'remove-vertex': command(
    'Remover vértice',
    edit,
    global(['REMOVERVERTICE']),
    { ...model, ...selected },
  ),
  group: command('Agrupar em detalhamento', edit, global(['AGRUPAR']), {
    ...model,
    ...selected,
    ...isolated,
  }),
  ungroup: command('Desagrupar seleção', edit, global(['DESAGRUPAR']), {
    ...model,
    ...selected,
    ...isolated,
  }),
  'edit-detail': command(
    'Editar detalhamento isolado',
    edit,
    global(['EDITARDETALHE']),
    isolated,
  ),
  'finish-detail': command(
    'Concluir edição isolada',
    edit,
    global(['CONCLUIR']),
  ),

  select: command('Selecionar', navigation, global(['V'], ['V'])),
  pan: command('Pan', navigation, global(['H'], ['H'])),
  fit: command('Enquadrar', navigation, global(['F', 'ZOOM'], ['F'])),
  snap: command('Encaixes', navigation, global([], ['F3'])),
  ortho: command('Ortogonal', navigation, global([], ['F8'])),
  sidebar: command('Painel lateral', navigation, global([], ['F4'])),
  'toggle-ribbon': command(
    'Faixa de comandos',
    navigation,
    global([], ['Mod+F1']),
  ),
  focus: command('Foco no CAD', navigation, global([], ['Mod+0'])),
  grid: command('Grade', navigation),
  dimensions: command('Exibir cotas', navigation),
  layers: command('Gerenciar layers', navigation, global(['LAYERS', 'NIVEIS'])),
  'hide-objects': command('Ocultar seleção', navigation, global(['OCULTAR'])),
  'isolate-objects': command('Isolar seleção', navigation, global(['ISOLAR'])),
  'show-all-objects': command(
    'Exibir todos',
    navigation,
    global(['EXIBIRTODOS']),
  ),
  'show-hidden-objects': command(
    'Mostrar ocultos',
    navigation,
    global(['MOSTRAROCULTOS']),
  ),
  'end-object-isolation': command(
    'Sair do isolamento',
    navigation,
    global(['SAIRISOLAMENTO']),
  ),
};

export const shortcutCommands = Object.keys(shortcutCatalog) as Action[];

export function commandAvailability(
  action: Action,
  context: {
    selected: number;
    isolated: boolean;
    groupSelected: boolean;
    canUndo: boolean;
    canRedo: boolean;
    inSheet?: boolean;
    operationActive?: boolean;
  },
) {
  const entry = shortcutCatalog[action];
  if (context.inSheet && entry.needsDrawing)
    return 'Abra um desenho para usar este comando.';
  if (context.isolated && entry.blockedInIsolation)
    return 'Indisponível durante a edição isolada de um detalhamento.';
  if (context.groupSelected && entry.blockedForGroup)
    return 'Abra o detalhamento para editar seus objetos individualmente.';
  if (entry.selection && context.selected < entry.selection)
    return entry.selection > 1
      ? `Selecione ao menos ${entry.selection} objetos.`
      : 'Selecione um objeto antes.';
  if (!context.operationActive) {
    if (action === 'undo' && !context.canUndo) return 'Nada para desfazer.';
    if (action === 'redo' && !context.canRedo) return 'Nada para refazer.';
  }
}

const keyPattern =
  /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/i;
const namedKeys = new Map(
  [
    'Delete',
    'Insert',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ].map((key) => [key.toUpperCase(), key]),
);
const modifierOrder = ['Mod', 'Alt', 'Shift'];
const reservedModKeys = /^(?:[1-9]|A|C|F|H|J|L|N|P|Q|R|T|U|V|W|X|F[2456])$/;

export function normalizeKey(value: string): string | undefined {
  const parts = value
    .trim()
    .split('+')
    .map((part) => part.trim().toUpperCase());
  const last = parts.pop() ?? '';
  if (!keyPattern.test(last)) return;
  const modifiers = parts.map((part) => {
    if (['CTRL', 'CONTROL', 'CMD', 'META', 'CTRL/CMD', 'MOD'].includes(part))
      return 'Mod';
    return modifierOrder.find((modifier) => modifier.toUpperCase() === part);
  });
  if (
    modifiers.includes(undefined) ||
    new Set(modifiers).size !== modifiers.length
  )
    return;
  const mod = modifiers.includes('Mod'),
    alt = modifiers.includes('Alt'),
    shift = modifiers.includes('Shift');
  if (alt && (mod || /^(?:F[0-9]+|Arrow(?:Left|Right)|Home|Tab)$/i.test(last)))
    return;
  if (
    mod &&
    (reservedModKeys.test(last) ||
      (shift && /^[A-Z]$/.test(last) && last !== 'Z'))
  )
    return;
  if (
    !mod &&
    !alt &&
    (last === 'F5' || last === 'F6' || last === 'F11' || last === 'F12')
  )
    return;
  return [
    ...modifierOrder.filter((part) => modifiers.includes(part)),
    namedKeys.get(last) ?? last,
  ].join('+');
}

export function normalizeAlias(value: string): string | undefined {
  const alias = value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
  // A letter must start the alias. Units and operation-specific options are reserved.
  if (!/^[A-Z][A-Z0-9_-]{0,31}$/.test(alias)) return;
  if (['MM', 'CM', 'FINAL', 'REFERENCIA'].includes(alias)) return;
  return alias;
}

export function textComposition(event: KeyboardEvent) {
  return (
    event.isComposing ||
    event.keyCode === 229 ||
    ['Dead', 'Process', 'Unidentified'].includes(event.key) ||
    event.getModifierState('AltGraph') ||
    (event.ctrlKey && event.altKey)
  );
}

export function eventKey(event: KeyboardEvent) {
  if (textComposition(event) || (event.ctrlKey && event.metaKey)) return;
  return normalizeKey(
    [
      (event.ctrlKey || event.metaKey) && 'Mod',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.key,
    ]
      .filter(Boolean)
      .join('+'),
  );
}

export const keyLabel = (key: string) => key.replace(/^Mod\+/, 'Ctrl/Cmd+');
export const usesBrowserZoomKey = (key: string) => key === 'Mod+0';

export const modalIsOpen = () =>
  !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');

export function isEditingControl(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest(
        'input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="listbox"], [role="slider"]',
      ))
  );
}

export const isActivationControl = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"]',
  );
