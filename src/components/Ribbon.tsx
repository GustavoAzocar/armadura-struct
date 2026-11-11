import {
  Puzzle,
  Store,
  PackagePlus,
  Code2,
  Settings,
  Eye,
  EyeOff,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FlipHorizontal2,
  FolderOpen,
  History,
  Grid2X2,
  Hand,
  HelpCircle,
  Layers,
  Library,
  Maximize2,
  MousePointer2,
  Move,
  PencilRuler,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  ScanLine,
  Shapes,
  SquareDashed,
  Table2,
  Trash2,
  Type,
  Undo2,
  Combine,
  Spline,
  ArrowUpRight,
  RefreshCw,
  PanelRight,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Focus,
  type LucideIcon,
} from 'lucide-react';
import * as RebarIcons from './armatureIcons';
import type { Tool } from '../domain/types';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { NumberField } from './Panels';
import { TooltipProvider, useTooltip } from './RibbonTooltip';
import type { MaskDestinationVariant } from './MaskDestination';
import {
  CircleIcon,
  DimensionAlignedIcon,
  DimensionOrthogonalIcon,
  ExtendIcon,
  LineIcon,
  MatchPropertiesIcon,
  MeasureContourIcon,
  MeasureDistanceIcon,
  OffsetIcon,
  PolylineIcon,
  RectangleIcon,
  ScaleIcon,
  TrimIcon,
  type IconComponent,
} from './maskIcons';
export type Action =
  | Tool
  | 'stirrup-criteria'
  | 'beam-clamp-criteria'
  | 'cad-settings'
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
// Detail editing uses the hierarchy identity instead of another group model.
type Item = {
  action: Action;
  label: string;
  caption?: string;
  icon: LucideIcon | IconComponent;
  selection?: number;
  disabled?: boolean;
  prominent?: boolean;
};
const item = (
  action: Action,
  label: string,
  icon: LucideIcon | IconComponent,
  selection = 0,
): Item => ({ action, label, icon, selection });
type Group = {
  name: string;
  items: Item[];
  creation?: boolean;
  /** Icon-only grid (issue #119): commands per row; two rows at most. */
  compact?: { columns: number };
  /** Mask destination controls rendered as the last group of the tab. */
  references?: boolean;
};
const ISOLATION_BLOCKED: Action[] = [
  'detail-repetition',
  'fabrication',
  'insert-detail',
  'update-detail',
  'new',
  'open',
  'renumber',
  'group',
  'ungroup',
  'edit-detail',
  'lock-schedule',
  'refresh-schedule',
  'insert-sheet-schedule',
];
const GROUP_BLOCKED: string[] = [
  'copy',
  'rotate',
  'mirror',
  'split',
  'join',
  'detail',
  'range',
  'repeat',
  'distribute',
  'edit-segment',
  'lengthen-bar',
];
/** Why a ribbon command cannot run now; undefined when it can. */
export function unavailableReason(
  t: Item,
  ctx: {
    selected: number;
    isolated: boolean;
    groupSelected: boolean;
    canUndo: boolean;
    canRedo: boolean;
  },
): string | undefined {
  if (t.disabled) return 'Indisponível no momento.';
  if (t.selection && ctx.selected < t.selection)
    return t.selection > 1
      ? `Selecione ao menos ${t.selection} objetos.`
      : 'Selecione um objeto antes.';
  if (ctx.isolated && ISOLATION_BLOCKED.includes(t.action))
    return 'Indisponível durante a edição isolada de um detalhamento.';
  if (ctx.groupSelected && GROUP_BLOCKED.includes(t.action))
    return 'Indisponível com um detalhamento agrupado na seleção.';
  if (t.action === 'undo' && !ctx.canUndo) return 'Nada para desfazer.';
  if (t.action === 'redo' && !ctx.canRedo) return 'Nada para refazer.';
  return undefined;
}

/** Icon-only command: name in the help bubble and in the accessible name. */
function CompactTool({
  entry,
  active,
  reason,
  onRun,
}: {
  entry: Item;
  active: boolean;
  reason?: string;
  onRun: () => void;
}) {
  const tip = useTooltip({ label: entry.label, detail: reason });
  const Icon = entry.icon;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    tip.focus.onKeyDown(e);
    // Enter/Space activate the focused command itself; they must not reach
    // the canvas shortcuts (Enter would otherwise finish the running command).
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };
  return (
    <span className="ribbon-item-slot" {...tip.hover}>
      <button
        type="button"
        className={`ribbon-tool ribbon-tool-compact ${entry.prominent ? 'ribbon-tool-primary' : ''} ${active ? 'active' : ''}`}
        data-action={entry.action}
        aria-label={entry.label}
        aria-pressed={active}
        aria-describedby={tip.describedId}
        disabled={!!reason}
        onClick={(e) => {
          // Starting a CAD command hands Enter back to the drawing. Keeping
          // this button focused would activate it again and restart the step.
          // Blur before running so a dialog can still choose its own focus.
          e.currentTarget.blur();
          onRun();
        }}
        onFocus={tip.focus.onFocus}
        onBlur={tip.focus.onBlur}
        onKeyDown={onKeyDown}
      >
        <Icon
          size={entry.prominent ? 20 : 18}
          strokeWidth={1.6}
          aria-hidden="true"
        />
      </button>
      {tip.describedId && (
        <span id={tip.describedId} className="sr-only">
          {tip.describedText}
        </span>
      )}
    </span>
  );
}
export type CreationSettings = {
  diameter: number;
  quantity: number;
  spacing: number;
  cover: number;
};
function CreationParameters({
  settings,
  onSettings,
}: {
  settings: CreationSettings;
  onSettings: (patch: Partial<CreationSettings>) => void;
}) {
  const helpId = useId();
  return (
    <div
      className="creation-fields"
      role="group"
      aria-label="Parâmetros das próximas criações"
      aria-describedby={helpId}
      title="Parâmetros gerais das próximas criações. Critérios de estribo já definidos têm precedência."
      onKeyDown={(e) => {
        if (!((e.ctrlKey || e.metaKey) && e.key === 'F1')) e.stopPropagation();
      }}
    >
      <NumberField
        label="Quantidade de criação"
        compactLabel="Quantidade"
        value={settings.quantity}
        min={1}
        max={100000}
        step={1}
        onChange={(quantity) => onSettings({ quantity })}
      />
      <label className="field">
        <span>Bitola (mm)</span>
        <div className="input-suffix">
          <select
            aria-label="Bitola de criação"
            value={settings.diameter}
            onChange={(e) => onSettings({ diameter: Number(e.target.value) })}
          >
            {![4.2, 5, 6.3, 8, 10, 12.5, 16, 20, 22, 25, 32, 40].includes(
              settings.diameter,
            ) && <option value={settings.diameter}>{settings.diameter}</option>}
            {[4.2, 5, 6.3, 8, 10, 12.5, 16, 20, 22, 25, 32, 40].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </label>
      <NumberField
        label="Espaçamento de criação"
        compactLabel="Espaçamento"
        value={settings.spacing}
        min={1}
        onChange={(spacing) => onSettings({ spacing })}
        suffix="mm"
      />
      <NumberField
        label="Cobrimento padrão de criação"
        compactLabel="Cobrimento"
        value={settings.cover}
        min={0}
        max={10000}
        onChange={(cover) => onSettings({ cover })}
        suffix="mm"
      />
      <span id={helpId} className="sr-only">
        Parâmetros gerais das próximas criações; não editam peças existentes.
        Critérios do estribo já definidos têm precedência.
      </span>
    </div>
  );
}
export default function Ribbon({
  tab,
  setTab,
  onAction,
  active,
  selected,
  canUndo,
  canRedo,
  collapsed,
  setCollapsed,
  settings,
  onSettings,
  isolated = false,
  groupSelected = false,
  maskDestination,
}: {
  tab: string;
  setTab: (s: string) => void;
  onAction: (a: Action) => void;
  active: Partial<Record<Action, boolean>>;
  selected: number;
  canUndo: boolean;
  canRedo: boolean;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  settings: CreationSettings;
  onSettings: (p: Partial<CreationSettings>) => void;
  isolated?: boolean;
  groupSelected?: boolean;
  /** Renders the mask destination for the given place in the ribbon. */
  maskDestination?: (variant: MaskDestinationVariant) => ReactNode;
}) {
  const groups: Record<string, Group[]> = {
    Plugins: [
      {
        name: 'Extensões',
        items: [
          item('plugins-store', 'Loja online', Store),
          item('plugins-offline', 'Instalar offline', PackagePlus),
          item('plugins-installed', 'Meus plugins', Puzzle),
          item('plugins-develop', 'Desenvolver plugins', Code2),
        ],
      },
    ],
    CONFIGURAÇÕES: [
      {
        name: 'Padrões do projeto',
        items: [item('cad-settings', 'Configurações CAD', Settings)],
      },
    ],
    Arquivo: [
      {
        name: 'Projeto',
        items: [
          item('new', 'Novo projeto', FilePlus2),
          item('open', 'Abrir projeto', FolderOpen),
          item('recent', 'Projetos recentes', History),
          item('save', 'Salvar projeto', Save),
        ],
      },
      {
        name: 'Referências',
        items: [item('import', 'Máscara DXF / DWG', Layers)],
      },
      {
        name: 'Exportar',
        items: [
          item('plot', 'Estilos de impressão', Layers),
          item('pdf', 'Prancha PDF', FileText),
          item('dxf', 'Desenho DXF', Download),
          item('csv', 'Quadro CSV', Table2),
          item('csv-scoped', 'CSV por escopo', Table2),
          item('export-detail', 'Pacote de detalhamento', Download),
        ],
      },
      {
        name: 'Ajuda',
        items: [
          item('help', 'Guia de uso', HelpCircle),
          item('check-updates', 'Verificar atualizações', RefreshCw),
        ],
      },
    ],
    Máscaras: [
      {
        name: 'Ferramentas',
        compact: { columns: 5 },
        items: [
          item('match-properties', 'Copiar propriedades', MatchPropertiesIcon),
          item('mask-calibrate', 'Ajustar escala', ScaleIcon),
          item('mask-offset', 'Offset — Paralelas de máscara', OffsetIcon),
          item('mask-trim', 'Ajustar — Aparar / Trim de máscara', TrimIcon),
          item('mask-extend', 'Estender — Extend de máscara', ExtendIcon),
          item('measure', 'Medir distância', MeasureDistanceIcon),
          item('measure-contour', 'Medir contorno', MeasureContourIcon),
          item(
            'dimension-orthogonal',
            'Cota ortogonal',
            DimensionOrthogonalIcon,
          ),
          item('dimension-aligned', 'Cota alinhada', DimensionAlignedIcon),
        ],
      },
      {
        name: 'Manipular',
        compact: { columns: 3 },
        items: [
          item('mask-move', 'Mover entidades da máscara', Move),
          item('mask-mirror', 'Espelhar entidades da máscara', FlipHorizontal2),
          item('mask-rotate', 'Rotacionar entidades da máscara', RotateCw),
          item('mask-copy', 'Copiar entidades da máscara', Copy),
          item('mask-erase', 'Apagar entidades da máscara', Trash2),
        ],
      },
      {
        name: 'Desenhar',
        compact: { columns: 3 },
        items: [
          item('mask-line', 'Linha', LineIcon),
          item('mask-rectangle', 'Retângulo', RectangleIcon),
          item('mask-circle', 'Círculo', CircleIcon),
          item('mask-polyline', 'Polilinha', PolylineIcon),
          item('mask-text', 'Texto', Type),
        ],
      },
      {
        // Importar and Associar moved to Referências: one place, same flows.
        name: 'Controle de máscaras',
        items: [
          item('mask-control', 'Controle de máscaras', Layers),
          item('symbols', 'Biblioteca de símbolos', Library),
        ],
      },
      {
        name: 'Navegar',
        items: [
          item('select', 'Selecionar', MousePointer2),
          item('pan', 'Pan', Hand),
          item('fit', 'Enquadrar', Maximize2),
          item('snap', 'Encaixes', ScanLine),
          item('ortho', 'Ortogonal', SquareDashed),
          item('undo', 'Desfazer', Undo2),
          item('redo', 'Refazer', Redo2),
        ],
      },
      { name: 'Referências', references: true, items: [] },
    ],
    Desenho: [
      {
        name: 'Layers',
        items: [
          item('match-properties', 'Copiar propriedades', Copy),
          item('layers', 'Gerenciar layers', Layers),
        ],
      },
      {
        name: 'Anotar',
        items: [
          item('dimension-orthogonal', 'Cota ortogonal', Ruler),
          item('dimension-aligned', 'Cota alinhada', Ruler),
          item('leader', 'Chamada', ArrowUpRight),
          item('section-arc', 'Corte em arco', Spline),
          item('section', 'Corte e chamada', ScanLine),
          item('measure', 'Medir', Ruler),
        ],
      },
      {
        name: 'Visualização',
        items: [
          item('fit', 'Enquadrar', Maximize2),
          item('grid', 'Grade', Grid2X2),
          item('snap', 'Encaixes', ScanLine),
          item('ortho', 'Ortogonal', SquareDashed),
          item('dimensions', 'Cotas', Ruler),
        ],
      },
      {
        name: 'Visibilidade',
        items: [
          item('hide-objects', 'Ocultar seleção', EyeOff),
          item('isolate-objects', 'Isolar seleção', Focus),
          item('end-object-isolation', 'Sair do isolamento', Eye),
          item('show-all-objects', 'Exibir todos', Eye),
          item('show-hidden-objects', 'Mostrar ocultos', Eye),
        ],
      },
      {
        name: 'Espaço de trabalho',
        items: [
          item('sidebar', 'Painel lateral', PanelRight),
          item('focus', 'Foco no CAD', Focus),
        ],
      },
    ],
    Elementos: [
      {
        name: 'Intercâmbio',
        items: [item('export-detail', 'Pacote de detalhamento', Download)],
      },
      {
        name: 'Detalhamento',
        items: [
          item('insert-detail', 'Inserir detalhamento', FolderOpen),
          item('update-detail', 'Atualizar detalhamento', RefreshCw),
          item('fabrication', 'Posições de fabricação', Combine),
          item('detail-repetition', 'Repetições do detalhamento', Copy),
          item('group', 'Agrupar em detalhamento', Combine, 1),
          item('edit-detail', 'Editar detalhamento', Shapes),
          item('ungroup', 'Desagrupar seleção', Shapes, 1),
        ],
      },
      {
        name: 'Selecionar',
        items: [
          item('select', 'Selecionar', MousePointer2),
          item('pan', 'Pan', Hand),
        ],
      },
      {
        name: 'Editar',
        items: [
          item('move', 'Mover', Move, 1),
          item('copy', 'Copiar', Copy, 1),
          item('clone-armature', 'Duplicar completa', Copy, 1),
          item('align-selection', 'Alinhar / distribuir…', Move),
          item('rotate', 'Rotacionar…', RotateCw, 1),
          item('mirror', 'Espelhar por eixo…', FlipHorizontal2, 1),
          item('delete', 'Excluir', Trash2, 1),
        ],
      },
      {
        name: 'Vértices',
        items: [
          item('insert-vertex', 'Inserir vértices', PencilRuler, 1),
          item('extend-vertex', 'Continuar pela ponta', Spline, 1),
          item('remove-vertex', 'Remover vértices', Trash2, 1),
        ],
      },
      {
        name: 'Histórico',
        items: [
          item('undo', 'Desfazer', Undo2),
          item('redo', 'Refazer', Redo2),
        ],
      },
      {
        name: 'Acessar',
        items: [
          item('sidebar', 'Painel lateral', PanelRight),
          item('import', 'Importar máscara', FolderOpen),
          item('fit', 'Enquadrar', Maximize2),
        ],
      },
    ],
    Armaduras: [
      {
        name: 'Lançar',
        compact: { columns: 2 },
        items: [
          {
            ...item('bar', 'Barra livre', RebarIcons.FreeBarIcon),
            prominent: true,
          },
          {
            ...item('stirrup', 'Estribo', RebarIcons.StirrupIcon),
            prominent: true,
          },
          item(
            'stirrup-criteria',
            'Critérios do estribo',
            RebarIcons.StirrupCriteriaIcon,
          ),
          item('repeat', 'Repetir estribo', RebarIcons.RepeatStirrupIcon, 1),
        ],
      },
      { name: 'Próximas criações', creation: true, items: [] },
      {
        name: 'Grampos de viga',
        compact: { columns: 1 },
        items: [
          item('beam-clamp', 'Grampo de viga', RebarIcons.BeamClampIcon),
          item(
            'beam-clamp-criteria',
            'Critérios do grampo de viga',
            RebarIcons.BeamClampCriteriaIcon,
          ),
        ],
      },
      {
        name: 'Gerar / converter',
        compact: { columns: 2 },
        items: [
          item('detail', 'Rebater armadura', RebarIcons.RepresentationIcon, 1),
          item('convert', 'Converter polilinha', RebarIcons.ConvertBarIcon),
          item('follow', 'Seguir fôrma', RebarIcons.FollowFormIcon),
          item(
            'interpret-cad',
            'Interpretar CAD em armadura',
            RebarIcons.InterpretBarIcon,
          ),
        ],
      },
      {
        name: 'Poligonais / traspasse',
        compact: { columns: 2 },
        items: [
          item(
            'edit-segment',
            'Comprimentos e ângulos',
            RebarIcons.LengthAngleIcon,
            1,
          ),
          item('lengthen-bar', 'Estender barra', RebarIcons.LengthenBarIcon, 1),
          item('join', 'Emendar poligonais', RebarIcons.JoinBarIcon, 2),
          item('split', 'Dividir barra', RebarIcons.SplitBarIcon, 1),
        ],
      },
      {
        name: 'Faixas de armadura',
        compact: { columns: 1 },
        items: [item('range', 'Faixa ortogonal', RebarIcons.RangeBarIcon, 1)],
      },
      {
        name: 'Relação do aço',
        compact: { columns: 3 },
        items: [
          item(
            'refresh-schedule',
            'Atualizar RA',
            RebarIcons.RefreshScheduleIcon,
          ),
          item(
            'lock-schedule',
            active['lock-schedule'] ? 'Desbloquear RA' : 'Bloquear RA',
            active['lock-schedule']
              ? RebarIcons.UnlockScheduleIcon
              : RebarIcons.LockScheduleIcon,
          ),
          item('schedule', 'Quadro de aço', RebarIcons.ScheduleIcon),
          item(
            'insert-sheet-schedule',
            'Inserir quadro na prancha',
            RebarIcons.InsertScheduleIcon,
          ),
          item('renumber', 'Renumerar', RebarIcons.RenumberIcon),
        ],
      },
    ],
  };
  const armaturesTab = tab === 'Armaduras';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({
    overflow: false,
    before: false,
    after: false,
  });
  const updateScroll = () => {
    const e = scrollRef.current;
    if (!e) return;
    setScroll({
      overflow: e.scrollWidth > e.clientWidth + 1,
      before: e.scrollLeft > 1,
      after: e.scrollLeft + e.clientWidth < e.scrollWidth - 1,
    });
  };
  useEffect(() => {
    const e = scrollRef.current;
    if (!e) return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(e);
    updateScroll();
    return () => observer.disconnect();
  }, [tab, collapsed]);
  const masksTab = tab === 'Máscaras';
  const [peek, setPeek] = useState(false);
  const peekId = useId();
  const ribbonRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const focusPeek = useRef(false);
  const peekOpen = peek && collapsed && masksTab;
  // The temporary panel only exists while the faixa is recolhida/Foco; it never
  // changes the collapsed state, the tab or the active mask.
  useEffect(() => {
    if (!collapsed || !masksTab) setPeek(false);
  }, [collapsed, masksTab]);
  useEffect(() => {
    if (!peekOpen) return;
    if (focusPeek.current) {
      focusPeek.current = false;
      peekRef.current
        ?.querySelector<HTMLElement>(
          'button:not(:disabled),input,select,[tabindex="0"]',
        )
        ?.focus();
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc closes the panel only; it must not also cancel the CAD command.
      e.stopPropagation();
      e.preventDefault();
      const inside = peekRef.current?.contains(document.activeElement);
      setPeek(false);
      if (inside) toggleRef.current?.focus();
    };
    const onDown = (e: globalThis.PointerEvent) => {
      if (!ribbonRef.current?.contains(e.target as Node)) setPeek(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [peekOpen]);
  const ctx = { selected, isolated, groupSelected, canUndo, canRedo };
  // Referências stays pinned at the right on wider windows; a command that
  // receives keyboard focus is scrolled clear of it (and of the left edge).
  const keepFocusVisible = (e: FocusEvent<HTMLDivElement>) => {
    const box = e.currentTarget,
      el = e.target as HTMLElement,
      refs = box.querySelector<HTMLElement>('.ribbon-group-references');
    if (refs?.contains(el) || box.scrollWidth <= box.clientWidth) return;
    const r = el.getBoundingClientRect(),
      b = box.getBoundingClientRect(),
      scale = b.width / box.clientWidth || 1,
      inset = box.parentElement?.classList.contains('ribbon-scroll-overflow')
        ? 34
        : 0,
      edge =
        refs && getComputedStyle(refs).position === 'sticky'
          ? refs.getBoundingClientRect().left
          : b.right - inset;
    if (r.right > edge) box.scrollLeft += (r.right - edge + 8) / scale;
    else if (r.left < b.left + inset)
      box.scrollLeft -= (b.left + inset - r.left + 8) / scale;
  };
  const content = (variant: 'bar' | 'peek') =>
    (groups[tab] ?? groups.Armaduras).map((g) =>
      g.creation ? (
        <div
          key={g.name}
          className="ribbon-group ribbon-group-creation"
          data-group={g.name}
        >
          <CreationParameters settings={settings} onSettings={onSettings} />
          <span className="ribbon-group-label">{g.name}</span>
        </div>
      ) : g.references ? (
        <div
          key={g.name}
          className="ribbon-group ribbon-group-references"
          data-group={g.name}
        >
          {maskDestination?.(variant === 'peek' ? 'peek' : 'group')}
          <span className="ribbon-group-label">{g.name}</span>
        </div>
      ) : g.compact ? (
        <div
          key={g.name}
          className="ribbon-group ribbon-group-compact"
          data-group={g.name}
        >
          <div
            className="ribbon-group-tools ribbon-compact-grid"
            style={{ '--ribbon-columns': g.compact.columns } as CSSProperties}
          >
            {g.items.map((entry) => (
              <CompactTool
                key={entry.action}
                entry={entry}
                active={!!active[entry.action]}
                reason={unavailableReason(entry, ctx)}
                onRun={() => onAction(entry.action)}
              />
            ))}
          </div>
          <span className="ribbon-group-label">{g.name}</span>
        </div>
      ) : (
        <div key={g.name} className="ribbon-group" data-group={g.name}>
          <div className="ribbon-group-tools">
            {g.items.map((entry) => {
              const t =
                entry.action === 'lock-schedule' && active['lock-schedule']
                  ? { ...entry, label: 'Desbloquear RA' }
                  : entry;
              return (
                <span className="ribbon-item-slot" key={t.action}>
                  <button
                    className={`ribbon-tool ${active[t.action] ? 'active' : ''}`}
                    onClick={(e) => {
                      if (masksTab) e.currentTarget.blur();
                      onAction(t.action);
                    }}
                    onKeyDown={(e) => {
                      if (masksTab && (e.key === 'Enter' || e.key === ' '))
                        e.stopPropagation();
                    }}
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={!!active[t.action]}
                    disabled={!!unavailableReason(entry, ctx)}
                  >
                    <t.icon size={23} strokeWidth={1.5} />
                    <span>{t.caption ?? t.label}</span>
                  </button>
                </span>
              );
            })}
          </div>
          <span className="ribbon-group-label">{g.name}</span>
        </div>
      ),
    );
  return (
    <TooltipProvider>
      <div
        ref={ribbonRef}
        className={`ribbon ${collapsed ? 'collapsed' : ''} ${masksTab ? 'ribbon-masks' : ''} ${tab === 'Armaduras' ? 'ribbon-armatures' : ''}`}
      >
        <div className="ribbon-tabs" role="tablist" aria-label="Ferramentas">
          {[
            ...Object.keys(groups).filter(
              (t) => t !== 'CONFIGURAÇÕES' && t !== 'Plugins',
            ),
            'Plugins',
            'CONFIGURAÇÕES',
          ].map((t) => (
            <button
              role="tab"
              aria-selected={t === tab}
              key={t}
              className={t === tab ? 'active' : ''}
              onClick={() => {
                setTab(t);
                setCollapsed(false);
              }}
              onDoubleClick={() => setCollapsed(!collapsed)}
            >
              {t}
            </button>
          ))}
          <span className="ribbon-spacer" />
          {masksTab && collapsed && maskDestination && (
            <div className="mask-quick-access">
              {maskDestination('summary')}
              <button
                ref={toggleRef}
                type="button"
                className={`mask-quick-toggle ${peekOpen ? 'active' : ''}`}
                aria-label="Referências e comandos de máscara"
                title="Referências e comandos de máscara"
                aria-expanded={peekOpen}
                aria-controls={peekOpen ? peekId : undefined}
                onKeyDown={(e) => {
                  // Keep Enter/Space for the toggle (not the canvas shortcuts).
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
                onClick={(e) => {
                  focusPeek.current = !peekOpen && e.detail === 0;
                  setPeek(!peekOpen);
                }}
              >
                <Layers size={14} strokeWidth={1.6} aria-hidden="true" />
                <span>Referências</span>
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          <button
            className="collapse-ribbon"
            title="Recolher / expandir comandos · Ctrl+F1"
            aria-label={
              collapsed
                ? 'Expandir faixa de comandos'
                : 'Recolher faixa de comandos'
            }
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
        {(armaturesTab || !collapsed) && (
          <div
            className={`ribbon-scroll ${armaturesTab && scroll.overflow ? 'ribbon-scroll-overflow' : ''}`}
            hidden={collapsed}
          >
            {armaturesTab && scroll.overflow && (
              <button
                className="ribbon-scroll-arrow ribbon-scroll-previous"
                type="button"
                aria-label="Comandos anteriores de armaduras"
                title="Comandos anteriores de armaduras"
                disabled={!scroll.before}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
                onClick={() =>
                  scrollRef.current?.scrollBy({
                    left: -240,
                    behavior: 'smooth',
                  })
                }
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
            )}
            <div
              ref={scrollRef}
              className="ribbon-content"
              onScroll={updateScroll}
              onFocus={keepFocusVisible}
            >
              {content('bar')}
            </div>
            {armaturesTab && scroll.overflow && (
              <button
                className="ribbon-scroll-arrow ribbon-scroll-next"
                type="button"
                aria-label="Próximos comandos de armaduras"
                title="Próximos comandos de armaduras"
                disabled={!scroll.after}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
                onClick={() =>
                  scrollRef.current?.scrollBy({ left: 240, behavior: 'smooth' })
                }
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {peekOpen && (
          <div
            ref={peekRef}
            id={peekId}
            className="ribbon-peek"
            role="group"
            aria-label="Comandos de máscara"
            onClick={(e) => {
              // A command or reference action was chosen: give the canvas back.
              if ((e.target as Element).closest('button')) setPeek(false);
            }}
          >
            <div className="ribbon-peek-content" onFocus={keepFocusVisible}>
              {content('peek')}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
