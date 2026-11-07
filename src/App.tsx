import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleHelp,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Moon,
  Redo2,
  Save,
  Sun,
  Table2,
  Terminal,
  Undo2,
  X,
  PanelRight,
  Focus,
  LockKeyhole,
  RefreshCw,
  Shapes,
} from 'lucide-react';
const DetailTransferDialog = lazy(
  () => import('./components/DetailTransferDialog'),
);
const CadInterpretDialog = lazy(
  () => import('./components/CadInterpretDialog'),
);
const ExampleReviewDialog = lazy(
  () => import('./components/ExampleReviewDialog'),
);
import {
  initialExampleProject,
  INITIAL_EXAMPLE_ID,
  INITIAL_EXAMPLE_SHEETS,
} from './examples/initial';
const NumberingDialog = lazy(() => import('./components/NumberingDialog'));
const FabricationDialog = lazy(() => import('./components/FabricationDialog'));
const DetailRepetitionDialog = lazy(
  () => import('./components/DetailRepetitionDialog'),
);
import { applyCadInterpretation, type CadInterpretation } from './cad/assisted';
import {
  applyRebarBatch,
  executeRebarBatch,
  rebarDefinition,
  RebarApiError,
  validateRebarChange,
  type RebarCommand,
  type RebarPatch,
} from './domain/rebarApi';
import {
  applyDetailTransfer,
  type TransferPlan,
} from './domain/detailTransfer';
import Ribbon, { type Action } from './components/Ribbon';
import CadCanvas, {
  type CadHandle,
  type CadState,
} from './components/CadCanvas';
import SheetCanvas from './components/SheetCanvas';
import SheetManager from './components/SheetManager';
import { removePlacement, updatePlacement } from './domain/sheets';
import {
  Inspector,
  NumberField,
  ProjectTree,
  Schedule,
  DraftInspector,
  RepresentationInspector,
} from './components/Panels';
import {
  decodeProject,
  emptyProject,
  newBar,
  nextMark,
  scheduleChanged,
  createScheduleLock,
} from './domain/model';
import {
  add,
  distance,
  format,
  offsetChain,
  rotate,
  sub,
  vertices,
  geometry,
} from './domain/geometry';
import {
  uid,
  type Bar,
  type Point,
  type Primitive,
  type Project,
  type Tool,
  type Annotation,
} from './domain/types';
import {
  autosave,
  readDocumentWorkspace,
  readProjectFile,
  readDetailSourceFile,
  saveDocumentWorkspace,
  importMask,
  pickNativeFile,
  restore,
  safeName,
  saveFile,
} from './lib/files';
import { annotationError } from './domain/drafting';
import { completeOwnership, detailPath } from './domain/hierarchy';
import {
  assertDetailEdit,
  canEditDetailChange,
  detailObjectIds,
  expandDetailSelection,
  groupInDetail,
  groupedDetailForObject,
  setDetailGrouped,
} from './domain/detailEditing';
import { version as appVersion } from '../package.json';
type DocumentSession = {
  selected: string[];
  maskId: string | null;
  tool: Tool;
  draft: Point[];
  page: 'drawing' | 'schedule';
  command: string;
  detailId: string;
  isolation?: string;
  camera?: CadState;
  selectedView?: string;
  sidebar: 'project' | 'properties' | 'sheets';
  returnTo?: string;
  settings?: {
    diameter: number;
    quantity: number;
    spacing: number;
    cover: number;
    snap: boolean;
    ortho: boolean;
    ribbon: string;
  };
};
type History = { past: Project[]; present: Project; future: Project[] };
const prompts: Record<Tool, string> = {
  polyline:
    'Indique os vértices da polilinha. Enter conclui; depois use Converter polilinha.',
  convert:
    'Clique em uma polilinha desenhada ou em uma entidade da máscara para converter em armadura.',
  repeat:
    'Selecione um estribo e indique o fim da repetição. O espaçamento máximo está na faixa de comandos.',
  range:
    'Indique o início e o fim da faixa ortogonal. A quantidade será vinculada ao espaçamento.',
  'dimension-aligned':
    'Indique os dois pontos medidos e a posição da linha de cota alinhada.',
  'dimension-orthogonal':
    'Indique os dois pontos medidos e a posição da cota horizontal ou vertical.',
  leader:
    'Indique o ponto de chamada, a dobra e o local do texto. A chamada acompanha a armadura selecionada.',
  section: 'Indique os extremos do corte e a posição da chamada.',
  'section-arc': 'Indique início, ponto intermediário e fim do arco de corte.',
  select: 'Selecione uma armadura para editar. Shift adiciona à seleção.',
  pan: 'Arraste para navegar. A roda do mouse aproxima e afasta.',
  bar: 'Indique os vértices da barra. Enter ou botão direito conclui.',
  stirrup: 'Indique dois cantos opostos do estribo. Dimensões medidas no eixo.',
  move: 'Indique o ponto base e o destino da seleção.',
  copy: 'Indique o ponto base e o destino da cópia.',
  detail: 'Indique onde posicionar o rebatimento da armadura.',
  distribute:
    'Indique o ponto final da distribuição. Ajuste quantidade e espaçamento no painel.',
  follow: 'Clique em uma linha ou polilinha da máscara para criar a armadura.',
  measure: 'Indique dois pontos para medir a distância.',
};
const tools: Tool[] = [
  'select',
  'pan',
  'bar',
  'stirrup',
  'move',
  'copy',
  'detail',
  'distribute',
  'follow',
  'measure',
  'polyline',
  'convert',
  'repeat',
  'range',
  'dimension-aligned',
  'dimension-orthogonal',
  'leader',
  'section',
  'section-arc',
];
export default function App() {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: emptyProject(),
    future: [],
  }));
  const p = history.present;
  const [detailTransfer, setDetailTransfer] = useState<{
    source: Project;
    fileName: string;
    mode: 'insert' | 'replace';
    projectId: string;
    sourceDetailId?: string;
  } | null>(null);
  const [cadInterpretation, setCadInterpretation] = useState<{
    detailId: string;
    maskId?: string;
    projectId: string;
  } | null>(null);
  const [exampleReviewOpen, setExampleReviewOpen] = useState(false);
  const [numberingOpen, setNumberingOpen] = useState(false);
  const [fabricationOpen, setFabricationOpen] = useState(false);
  const [repetitionDetailId, setRepetitionDetailId] = useState<string>();
  const detailRequest = useRef<{
    mode: 'insert' | 'replace';
    projectId: string;
  } | null>(null);
  const detailInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<{
    projectId: string;
    active: string;
    opened: string[];
  }>({ projectId: p.id, active: 'model', opened: [] });
  const validDocument = (key: string, project = p) =>
    key === 'model' ||
    (key.startsWith('sheet:')
      ? project.sheets.some((s) => s.id === key.slice(6))
      : key.startsWith('drawing:') &&
        project.hierarchy.drawings.some((d) => d.id === key.slice(8)));
  const documentKey =
    documents.projectId === p.id && validDocument(documents.active)
      ? documents.active
      : 'model';
  const activeSheet = documentKey.startsWith('sheet:')
    ? p.sheets.find((s) => s.id === documentKey.slice(6))
    : undefined;
  const activeDrawing = documentKey.startsWith('drawing:')
    ? p.hierarchy.drawings.find((d) => d.id === documentKey.slice(8))
    : undefined;
  const sessions = useRef(new Map<string, DocumentSession>());
  const sessionsProject = useRef('');
  const [selectedView, setSelectedView] = useState<string>();
  const historyRef = useRef(history);
  // Reject writes synchronously, including callbacks completing after a context switch.
  historyRef.current = history;
  const [isolation, setIsolation] = useState<{
    projectId: string;
    detailId: string;
  } | null>(null);
  const isolatedDetailId =
    activeDrawing?.detailId ??
    (isolation?.projectId === p.id &&
    p.hierarchy.details.some((d) => d.id === isolation.detailId)
      ? isolation.detailId
      : undefined);
  const canUndo = canEditDetailChange(p, history.past.at(-1), isolatedDetailId);
  const canRedo = canEditDetailChange(p, history.future[0], isolatedDetailId);
  const isolationRef = useRef(isolatedDetailId);
  isolationRef.current = isolatedDetailId;
  const [context, setContext] = useState<{
    projectId: string;
    detailId: string;
  } | null>(null);
  let preferredDetail = context?.projectId === p.id ? context.detailId : '';
  if (context?.projectId !== p.id) {
    try {
      preferredDetail =
        localStorage.getItem(`armadurastruct.activeDetail.${p.id}`) || '';
    } catch {
      /* Use the first detail. */
    }
  }
  const activeDetailId =
    isolatedDetailId ||
    (p.hierarchy.details.some((d) => d.id === preferredDetail)
      ? preferredDetail
      : p.hierarchy.details[0].id);
  const activateDetail = (detailId: string) => {
    if (isolationRef.current && detailId !== isolationRef.current) return;
    setContext({ projectId: p.id, detailId });
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        `armadurastruct.activeDetail.${p.id}`,
        activeDetailId,
      );
    } catch {
      /* Optional navigation preference. */
    }
  }, [p.id, activeDetailId]);
  const recoveryBlocked = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false),
    [selected, setSelectedRaw] = useState<string[]>([]),
    [maskId, setMaskId] = useState<string | null>(null);
  const [tool, setToolRaw] = useState<Tool>('select'),
    [draft, setDraft] = useState<Point[]>([]),
    [tab, setTab] = useState('Armaduras'),
    [page, setPageRaw] = useState<'drawing' | 'schedule'>('drawing');
  const [grid, setGrid] = useState(true),
    [snap, setSnap] = useState(true),
    [ortho, setOrtho] = useState(false),
    [dimensions, setDimensions] = useState(true);
  const [light, setLight] = useState(
    () => localStorage.getItem('armadurastruct.canvas') === 'light',
  );
  const [command, setCommand] = useState(''),
    [message, setMessage] = useState('Pronto para detalhar.'),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(''),
    [saveState, setSaveState] = useState('Salvo neste computador');
  const [modal, setModal] = useState<'new' | 'help' | 'split' | 'group' | null>(
      null,
    ),
    [newName, setNewName] = useState('Novo projeto'),
    [cover, setCover] = useState(30),
    [newDiameter, setNewDiameter] = useState(8),
    [newQuantity, setNewQuantity] = useState(1),
    [newSpacing, setNewSpacing] = useState(150),
    [splitAt, setSplitAt] = useState(500),
    [lap, setLap] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<
    'project' | 'properties' | 'sheets'
  >('project');
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('armadurastruct.sidebar') !== 'closed',
  );
  const [ribbonCollapsed, setRibbonCollapsed] = useState(
    () => localStorage.getItem('armadurastruct.ribbon') === 'collapsed',
  );
  const [focus, setFocus] = useState(false);
  const [groupName, setGroupName] = useState('Detalhamento'),
    [groupElementId, setGroupElementId] = useState('');
  useEffect(
    () =>
      localStorage.setItem(
        'armadurastruct.sidebar',
        sidebarOpen ? 'open' : 'closed',
      ),
    [sidebarOpen],
  );
  useEffect(
    () =>
      localStorage.setItem(
        'armadurastruct.ribbon',
        ribbonCollapsed ? 'collapsed' : 'open',
      ),
    [ribbonCollapsed],
  );
  const paperCanvas = useRef<CadHandle>(null);
  const cad = useRef<CadHandle>(null),
    maskInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    cmdInput = useRef<HTMLInputElement>(null);
  const canvas = () => (activeSheet ? paperCanvas.current : cad.current);
  const captureDocument = (): DocumentSession => ({
    selected,
    maskId,
    tool,
    draft,
    page,
    command,
    detailId: activeDetailId,
    isolation: activeDrawing ? undefined : isolatedDetailId,
    camera: canvas()?.getState() ?? sessions.current.get(documentKey)?.camera,
    selectedView,
    settings: {
      diameter: newDiameter,
      quantity: newQuantity,
      spacing: newSpacing,
      cover,
      snap,
      ortho,
      ribbon: tab,
    },
    sidebar: sidebarTab,
    returnTo: sessions.current.get(documentKey)?.returnTo,
  });
  const persistDocuments = (
    active = documentKey,
    opened = documents.opened,
  ) => {
    const cameras = Object.fromEntries(
      [...sessions.current]
        .filter(([, v]) => v.camera)
        .map(([key, value]) => [key, value.camera!]),
    );
    saveDocumentWorkspace(p.id, { active, opened, cameras });
  };
  const setPage = (next: 'drawing' | 'schedule') => {
    if (next !== page)
      sessions.current.set(documentKey, { ...captureDocument(), page: next });
    setPageRaw(next);
  };
  const switchDocument = (key: string, returnTo?: string) => {
    const current = historyRef.current.present;
    if (!validDocument(key, current)) return;
    if (
      key === documentKey &&
      documents.active === key &&
      documents.projectId === p.id
    ) {
      setPage('drawing');
      return;
    }
    if (validDocument(documents.active) && documents.projectId === p.id)
      sessions.current.set(documentKey, captureDocument());
    const drawing = key.startsWith('drawing:')
      ? current.hierarchy.drawings.find((d) => d.id === key.slice(8))
      : undefined;
    const next = sessions.current.get(key) ?? {
      selected: [],
      maskId: null,
      tool: 'select' as Tool,
      draft: [],
      page: 'drawing' as const,
      command: '',
      detailId: drawing?.detailId ?? activeDetailId,
      sidebar: key.startsWith('sheet:')
        ? ('sheets' as const)
        : ('project' as const),
      returnTo,
    };
    if (returnTo && key !== 'model') next.returnTo = returnTo;
    sessions.current.set(key, next);
    const scope =
      drawing?.detailId ??
      (current.hierarchy.details.some((d) => d.id === next.isolation)
        ? next.isolation
        : undefined);
    isolationRef.current = scope;
    setIsolation(
      scope && !drawing ? { projectId: p.id, detailId: scope } : null,
    );
    setContext({ projectId: p.id, detailId: next.detailId });
    setSelectedRaw(
      next.selected.filter(
        (id) =>
          Object.hasOwn(current.hierarchy.objectDetails, id) &&
          (!scope || current.hierarchy.objectDetails[id] === scope),
      ),
    );
    setMaskId(
      next.maskId &&
        current.masks.some(
          (m) =>
            m.id === next.maskId &&
            (!scope || current.hierarchy.objectDetails[m.id] === scope),
        )
        ? next.maskId
        : null,
    );
    if (next.settings) {
      setNewDiameter(next.settings.diameter);
      setNewQuantity(next.settings.quantity);
      setNewSpacing(next.settings.spacing);
      setCover(next.settings.cover);
      setSnap(next.settings.snap);
      setOrtho(next.settings.ortho);
      setTab(next.settings.ribbon);
    }
    setToolRaw(next.tool);
    setDraft(next.draft);
    setPageRaw(next.page);
    setCommand(next.command);
    setSelectedView(next.selectedView);
    setSidebarTab(next.sidebar);
    setModal(null);
    setMessage(prompts[next.tool]);
    const opened = [
      ...new Set([...documents.opened, ...(key === 'model' ? [] : [key])]),
    ];
    setDocuments({ projectId: p.id, active: key, opened });
    persistDocuments(key, opened);
  };
  const openDrawing = (id: string) =>
    switchDocument(`drawing:${id}`, documentKey);
  const closeDocument = (key: string) => {
    if (key === documentKey) switchDocument('model');
    setDocuments((d) => ({
      ...d,
      active: key === d.active ? 'model' : d.active,
      opened: d.opened.filter((k) => k !== key),
    }));
  };
  useEffect(() => {
    if (sessionsProject.current === p.id) return;
    sessionsProject.current = p.id;
    sessions.current.clear();
    const saved = readDocumentWorkspace(p.id);
    for (const [key, camera] of Object.entries(saved?.cameras ?? {})) {
      sessions.current.set(key, {
        selected: [],
        maskId: null,
        tool: 'select',
        draft: [],
        page: 'drawing',
        command: '',
        detailId: p.hierarchy.details[0].id,
        camera,
        sidebar: key.startsWith('sheet:') ? 'sheets' : 'project',
      });
    }
    if (p.id === INITIAL_EXAMPLE_ID) setSidebarTab('sheets');
    // File reopen starts outside isolated editing; cached cameras remain available.
    setDocuments({
      projectId: p.id,
      active:
        p.id === INITIAL_EXAMPLE_ID
          ? `sheet:${INITIAL_EXAMPLE_SHEETS[0]}`
          : 'model',
      opened: (
        saved?.opened ??
        (p.id === INITIAL_EXAMPLE_ID
          ? INITIAL_EXAMPLE_SHEETS.map((id) => `sheet:${id}`)
          : [])
      ).filter((key) => validDocument(key)),
    });
    isolationRef.current = undefined;
    setIsolation(null);
    setSelectedRaw([]);
    setMaskId(null);
    setToolRaw('select');
    setDraft([]);
    setPageRaw('drawing');
    setSelectedView(undefined);
    setCommand('');
  }, [p.id]);
  useEffect(() => {
    if (documents.projectId === p.id && !validDocument(documents.active))
      switchDocument('model');
  }, [p.sheets, p.hierarchy.drawings]);
  useEffect(() => {
    if (documents.projectId === p.id) persistDocuments();
  }, [documents]);
  useEffect(() => {
    const save = () => {
      sessions.current.set(documentKey, captureDocument());
      persistDocuments();
    };
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  });
  const cursorReadout = useRef<HTMLSpanElement>(null);
  const onCursor = useCallback((point: Point) => {
    if (cursorReadout.current)
      cursorReadout.current.textContent = `X ${format(point.x, 1)}   Y ${format(point.y, 1)}   mm`;
  }, []);
  const selectedOwners = new Set(
    selected.map((id) => p.hierarchy.objectDetails[id]),
  );
  const selectedGroups = !isolatedDetailId
    ? p.hierarchy.details.filter((d) => d.grouped && selectedOwners.has(d.id))
    : [];
  const groupSelection = selectedGroups.length > 0;
  const selectedGroup =
    selectedGroups.length === 1 &&
    selected.every(
      (id) => p.hierarchy.objectDetails[id] === selectedGroups[0].id,
    )
      ? selectedGroups[0]
      : undefined;
  const editable = (id: string) =>
    !isolatedDetailId || p.hierarchy.objectDetails[id] === isolatedDetailId;
  const chosen = !groupSelection
      ? p.bars.find((b) => b.id === selected[0] && editable(b.id))
      : undefined,
    mask = !groupSelection
      ? p.masks.find((m) => m.id === maskId && editable(m.id))
      : undefined;
  const annotation = !groupSelection
    ? p.annotations.find((a) => a.id === selected[0] && editable(a.id))
    : undefined;
  const polyline = !groupSelection
    ? p.polylines.find((a) => a.id === selected[0] && editable(a.id))
    : undefined;
  const notify = (s: string) => {
    setToast(s);
    setMessage(s);
  };
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    let alive = true;
    restore()
      .then(async (raw) => {
        if (raw && alive) {
          const project = decodeProject(raw);
          setHistory({ past: [], present: project, future: [] });
        } else if (!raw) {
          const project = await initialExampleProject();
          if (alive) setHistory({ past: [], present: project, future: [] });
        }
      })
      .catch(() => {
        recoveryBlocked.current = historyRef.current.present.id;
        if (alive)
          notify(
            'Não foi possível recuperar o projeto local. Abra uma cópia salva.',
          );
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || recoveryBlocked.current === p.id) return;
    setSaveState('Salvando…');
    const timer = setTimeout(() => {
      autosave(p)
        .then(() => setSaveState('Salvo neste computador'))
        .catch(() => {
          setSaveState('Falha no salvamento local');
          notify(
            'O armazenamento local está indisponível. Use Salvar projeto para guardar uma cópia.',
          );
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [p, ready]);
  const commit = useCallback(
    (change: (current: Project) => Project) => {
      try {
        const h = historyRef.current;
        const next = change(h.present);
        const scope = isolationRef.current;
        const target =
          scope ||
          (next.id === h.present.id &&
          next.hierarchy.details.some((d) => d.id === activeDetailId)
            ? activeDetailId
            : next.hierarchy.details[0].id);
        const complete = completeOwnership(next, target);
        if (
          next.id === h.present.id &&
          (next.bars !== h.present.bars ||
            next.details !== h.present.details ||
            next.annotations !== h.present.annotations)
        ) {
          const issues = validateRebarChange(h.present, complete);
          if (issues.length) throw new RebarApiError(issues);
        }
        if (scope) assertDetailEdit(h.present, complete, scope);
        const updated = {
          past: [...h.past.slice(-39), h.present],
          present: complete,
          future: [],
        };
        historyRef.current = updated;
        setHistory(updated);
        return true;
      } catch (e) {
        notify(
          e instanceof Error
            ? e.message
            : 'Não foi possível alterar o detalhamento.',
        );
        return false;
      }
    },
    [activeDetailId],
  );
  const commitLayout = (change: (current: Project) => Project) => {
    sessions.current.set(documentKey, captureDocument());
    return commit(change);
  };
  const select = (ids: string[]) => {
    if (activeSheet && ids.length) {
      notify('Abra um desenho para selecionar os objetos do modelo.');
      return;
    }
    const current = historyRef.current.present;
    const scope = isolationRef.current;
    if (
      scope &&
      ids.some((id) => current.hierarchy.objectDetails[id] !== scope)
    ) {
      setSelectedRaw([]);
      setMaskId(null);
      notify(
        'Os objetos de outro detalhamento estão protegidos. Conclua a edição para selecioná-los.',
      );
      return;
    }
    const next = expandDetailSelection(current, ids, scope);
    setSelectedRaw(next);
    setMaskId(null);
    const owner = current.hierarchy.objectDetails[next[0]];
    if (owner) activateDetail(owner);
    if (ids.length) setSidebarTab('properties');
  };
  const setTool = (t: Tool) => {
    if (activeSheet && t !== 'select' && t !== 'pan') {
      notify(
        'Abra o desenho com duplo clique na vista para editar os objetos.',
      );
      return;
    }
    setToolRaw(t);
    setDraft([]);
    setPage('drawing');
    setMessage(prompts[t]);
  };
  const beginDetailEdit = (detailId: string) => {
    const current = historyRef.current.present;
    if (
      isolationRef.current ||
      !current.hierarchy.details.some((d) => d.id === detailId)
    )
      return;
    isolationRef.current = detailId;
    setIsolation({ projectId: current.id, detailId });
    setContext({ projectId: current.id, detailId });
    setSelectedRaw([]);
    setMaskId(null);
    setModal(null);
    setTool('select');
    notify('Edição isolada. Os demais detalhamentos estão protegidos.');
  };
  const finishDetailEdit = () => {
    if (activeDrawing) {
      const session = captureDocument();
      sessions.current.set(documentKey, {
        ...session,
        tool: 'select',
        draft: [],
        page: 'drawing',
      });
      const target =
        session.returnTo && validDocument(session.returnTo)
          ? session.returnTo
          : 'model';
      // Switch captures the current editing state; clear only this command explicitly.
      setToolRaw('select');
      setDraft([]);
      switchDocument(target);
      const cached = sessions.current.get(documentKey);
      if (cached)
        sessions.current.set(documentKey, {
          ...cached,
          tool: 'select',
          draft: [],
          page: 'drawing',
        });
      notify(
        'Edição concluída. Todas as vistas usam o detalhamento atualizado.',
      );
      return;
    }
    const current = historyRef.current.present,
      id = isolationRef.current;
    isolationRef.current = undefined;
    setIsolation(null);
    setTool('select');
    setMaskId(null);
    setSelectedRaw(id ? detailObjectIds(current, id) : []);
    notify(
      'Edição concluída. Desenhos e quantitativos usam os dados atualizados.',
    );
  };
  const editBar = (id: string, patch: Partial<Bar>) => {
    return commit((current) => {
      const b = current.bars.find((b) => b.id === id);
      if (!b) throw new Error('Armadura inexistente.');
      const { distribution, ...fields } = patch;
      const source = patch.quantitySource ?? b.quantitySource;
      const commands: RebarCommand[] = [];
      if (Object.hasOwn(patch, 'distribution') && !distribution)
        commands.push({ type: 'distribution.remove', barId: id });
      if (Object.keys(fields).length)
        commands.push({
          type: 'bar.update',
          id,
          patch: { kind: b.kind, ...fields } as RebarPatch,
        });
      if (distribution)
        commands.push({
          type: 'distribution.set',
          barId: id,
          distribution,
          count:
            source?.kind === 'distribution' && source.mode === 'spacing'
              ? { mode: 'spacing', spacing: source.spacing }
              : {
                  mode:
                    b.distribution && source?.kind === 'manual'
                      ? 'manual'
                      : 'quantity',
                  quantity: patch.quantity ?? b.quantity,
                },
        });
      return applyRebarBatch(
        current,
        executeRebarBatch(current, commands, {
          units: 'mm',
          scopeDetailId: isolationRef.current,
        }),
      );
    });
  };
  const insertBar = (b: Bar, removePolyline?: string) => {
    if (
      !commit((current) => {
        const commands: RebarCommand[] = [
          {
            type: 'bar.create',
            id: b.id,
            detailId: activeDetailId,
            definition: {
              ...rebarDefinition(b),
              ...(b.distribution
                ? { quantitySource: { kind: 'manual' as const } }
                : {}),
            },
          },
        ];
        if (b.distribution)
          commands.push({
            type: 'distribution.set',
            barId: b.id,
            distribution: b.distribution,
            count:
              b.quantitySource?.kind === 'distribution' &&
              b.quantitySource.mode === 'spacing'
                ? { mode: 'spacing', spacing: b.quantitySource.spacing }
                : {
                    mode:
                      b.quantitySource?.kind === 'manual'
                        ? 'manual'
                        : 'quantity',
                    quantity: b.quantity,
                  },
          });
        const next = applyRebarBatch(
          current,
          executeRebarBatch(current, commands, {
            units: 'mm',
            scopeDetailId: isolationRef.current,
          }),
        );
        return {
          ...next,
          polylines: removePolyline
            ? next.polylines.filter((l) => l.id !== removePolyline)
            : next.polylines,
        };
      })
    )
      return false;
    select([b.id]);
    setDraft([]);
    setMessage(`${b.mark} criada. Continue desenhando ou pressione Esc.`);
    return true;
  };
  const commitRebars = (commands: RebarCommand[]) =>
    commit((current) =>
      applyRebarBatch(
        current,
        executeRebarBatch(current, commands, {
          units: 'mm',
          scopeDetailId: isolationRef.current,
        }),
      ),
    );
  const finish = () => {
    if (activeSheet) return;
    if (tool === 'polyline' && draft.length >= 2) {
      const id = uid();
      commit((p) => ({
        ...p,
        polylines: [
          ...p.polylines,
          { id, points: draft, closed: false, color: '#a5adbd' },
        ],
      }));
      select([id]);
      setDraft([]);
      return;
    }
    if (tool === 'bar' && draft.length >= 2) {
      const origin = draft[0];
      insertBar({
        ...newBar(nextMark(p)),
        quantity: newQuantity,
        diameter: newDiameter,
        mandrel: newDiameter * 5,
        origin,
        points: draft.map((v) => sub(v, origin)),
      });
    } else setDraft([]);
  };
  const onPoint = (point: Point) => {
    if (tool === 'bar' || tool === 'polyline') {
      if (!draft.length || distance(draft.at(-1)!, point) > 0.01)
        setDraft([...draft, point]);
      return;
    }
    if (tool === 'stirrup') {
      if (!draft.length) {
        setDraft([point]);
        return;
      }
      const a = draft[0],
        w = Math.abs(point.x - a.x),
        h = Math.abs(point.y - a.y);
      if (w < 10 || h < 10) {
        notify('Defina largura e altura de pelo menos 10 mm.');
        return;
      }
      insertBar({
        ...newBar(nextMark(p)),
        kind: 'stirrup',
        quantity: newQuantity,
        diameter: newDiameter,
        mandrel: newDiameter * 5,
        origin: { x: Math.min(a.x, point.x), y: Math.min(a.y, point.y) },
        width: w,
        height: h,
      });
      return;
    }
    if (tool === 'measure') {
      if (!draft.length) {
        setDraft([point]);
        return;
      }
      notify(
        `Distância: ${format(distance(draft[0], point), 2)} mm · ${format(distance(draft[0], point) / 1000, 3)} m`,
      );
      setDraft([]);
      return;
    }
    if (
      [
        'dimension-aligned',
        'dimension-orthogonal',
        'leader',
        'section',
        'section-arc',
      ].includes(tool)
    ) {
      if (draft.length < 2) {
        if (!draft.length || distance(draft[0], point) > 0.01)
          setDraft([...draft, point]);
        return;
      }
      const points = [...draft, point];
      const a: Annotation = {
        id: uid(),
        kind: tool as Annotation['kind'],
        points,
        barId: chosen?.id,
        label: '',
        textHeight: 50,
        color: '#7c91b7',
      };
      const error = annotationError(a);
      if (error) {
        notify(error);
        return;
      }
      commit((p) => ({ ...p, annotations: [...p.annotations, a] }));
      select([a.id]);
      setTool('select');
      notify('Anotação criada. Edite texto e vínculo nas propriedades.');
      return;
    }
    if (tool === 'move' || tool === 'copy') {
      if (!selected.length) return;
      if (!draft.length) {
        setDraft([point]);
        return;
      }
      const delta = sub(point, draft[0]);
      let next = p;
      const selectedIds: string[] = [];
      const copies = new Map<string, string>();
      if (tool === 'copy') {
        const commands: RebarCommand[] = p.bars
          .filter((b) => selected.includes(b.id))
          .map((b) => {
            const id = uid();
            copies.set(b.id, id);
            selectedIds.push(id);
            return {
              type: 'bar.copy',
              id: b.id,
              newId: id,
              detailId: activeDetailId,
              delta,
            };
          });
        if (commands.length) {
          const result = executeRebarBatch(p, commands, {
            units: 'mm',
            scopeDetailId: isolationRef.current,
          });
          if (!result.ok) {
            notify(new RebarApiError(result.issues).message);
            return;
          }
          next = result.project;
        }
        next = {
          ...next,
          annotations: [
            ...next.annotations,
            ...p.annotations
              .filter((a) => selected.includes(a.id))
              .map((a) => {
                const id = uid();
                selectedIds.push(id);
                return {
                  ...a,
                  id,
                  barId: copies.get(a.barId ?? '') ?? a.barId,
                  points: a.points.map((v) => add(v, delta)),
                };
              }),
          ],
          polylines: [
            ...next.polylines,
            ...p.polylines
              .filter((a) => selected.includes(a.id))
              .map((a) => {
                const id = uid();
                selectedIds.push(id);
                return { ...a, id, points: a.points.map((v) => add(v, delta)) };
              }),
          ],
        };
      } else {
        const commands: RebarCommand[] = p.bars
          .filter((b) => selected.includes(b.id))
          .map((b) => ({ type: 'bar.move', id: b.id, delta }));
        if (commands.length) {
          const result = executeRebarBatch(p, commands, {
            units: 'mm',
            scopeDetailId: isolationRef.current,
          });
          if (!result.ok) {
            notify(new RebarApiError(result.issues).message);
            return;
          }
          next = result.project;
        }
        next = {
          ...next,
          annotations: p.annotations.map((a) =>
            selected.includes(a.id)
              ? { ...a, points: a.points.map((v) => add(v, delta)) }
              : a,
          ),
          polylines: p.polylines.map((a) =>
            selected.includes(a.id)
              ? { ...a, points: a.points.map((v) => add(v, delta)) }
              : a,
          ),
          details: p.details.map((d) =>
            selected.includes(d.id)
              ? { ...d, origin: add(d.origin, delta) }
              : d,
          ),
          masks: p.masks.map((m) =>
            selected.includes(m.id)
              ? { ...m, origin: add(m.origin, delta) }
              : m,
          ),
        };
      }
      commit(() => next);
      if (tool === 'copy') select(selectedIds);
      setTool('select');
      return;
    }
    if (!chosen) {
      if (['detail', 'distribute', 'range', 'repeat'].includes(tool))
        notify('Selecione uma armadura antes de usar este comando.');
      return;
    }
    if (tool === 'repeat') {
      if (chosen.kind !== 'stirrup') {
        notify('Repetir estribo exige uma posição do tipo estribo.');
        return;
      }
      try {
        if (
          !commitRebars([
            {
              type: 'distribution.set',
              barId: chosen.id,
              distribution: { end: point, render: 'bars' },
              count: { mode: 'spacing', spacing: newSpacing },
            },
          ])
        )
          return;
        setTool('select');
      } catch (e) {
        notify((e as Error).message);
      }
      return;
    }
    if (tool === 'range') {
      if (!draft.length) {
        setDraft([point]);
        return;
      }
      const start = draft[0],
        delta = sub(point, start);
      const end =
        Math.abs(delta.x) >= Math.abs(delta.y)
          ? { x: point.x, y: start.y }
          : { x: start.x, y: point.y };
      try {
        if (
          !commitRebars([
            {
              type: 'distribution.set',
              barId: chosen.id,
              distribution: { start, end, render: 'ticks' },
              count: { mode: 'spacing', spacing: newSpacing },
            },
          ])
        )
          return;
        setTool('select');
        notify(
          'Faixa vinculada à posição; a quantidade inclui as duas extremidades.',
        );
      } catch (e) {
        notify((e as Error).message);
      }
      return;
    }
    if (tool === 'detail') {
      if (
        !commitRebars([
          { type: 'representation.create', barId: chosen.id, origin: point },
        ])
      )
        return;
      setTool('select');
      notify('Rebatimento criado. Ele permanece vinculado à posição original.');
      return;
    }
    if (tool === 'distribute') {
      if (distance(chosen.origin, point) < 1) return;
      editBar(chosen.id, {
        distribution: { ...chosen.distribution, end: point },
        ...(!chosen.distribution
          ? { quantity: Math.max(2, chosen.quantity) }
          : {}),
      });
      setTool('select');
      notify(
        'Distribuição criada. Ajuste a quantidade ou o espaçamento nas propriedades.',
      );
      return;
    }
  };
  const follow = (primitive: Primitive, polylineId?: string) => {
    try {
      const points =
        tool === 'convert'
          ? primitive.closed &&
            distance(primitive.points[0], primitive.points.at(-1)!) > 0.001
            ? [...primitive.points, primitive.points[0]]
            : primitive.points
          : offsetChain(
              primitive.points,
              cover + newDiameter / 2,
              !!primitive.closed,
            );
      const origin = points[0];
      if (points.length > 500)
        throw new Error(
          'Use um contorno com até 500 vértices para criar a armadura.',
        );
      insertBar(
        {
          ...newBar(nextMark(p)),
          origin,
          quantity: newQuantity,
          diameter: newDiameter,
          mandrel: newDiameter * 5,
          points: points.map((v) => sub(v, origin)),
        },
        polylineId,
      );
      notify(
        tool === 'convert'
          ? 'Polilinha convertida em armadura; confira as dobras.'
          : 'Barra criada a partir da fôrma. Confira as dobras e defina as terminações.',
      );
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const exportPaper = async (ids?: string[]) => {
    try {
      const { toSheetPdf } = await import('./lib/exports');
      const data = toSheetPdf(historyRef.current.present, ids);
      const saved = await saveFile(
        `${safeName(p.name)}-pranchas.pdf`,
        data,
        'application/pdf',
        'pdf',
      );
      if (saved)
        notify('PDF vetorial exportado. Imprima em tamanho real (100%).');
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível exportar as folhas.',
      );
    }
  };
  const onDetailFile = async (file: File, request = detailRequest.current) => {
    if (!request) return;
    setBusy(`Lendo origem: ${file.name}…`);
    try {
      const { project: source, detailId: sourceDetailId } =
        await readDetailSourceFile(file);
      if (
        detailRequest.current !== request ||
        historyRef.current.present.id !== request.projectId ||
        isolationRef.current
      ) {
        notify(
          'A origem não foi aberta porque o projeto ou o contexto de edição mudou. Conclua a edição e tente novamente.',
        );
        return;
      }
      setDetailTransfer({
        source,
        fileName: file.name,
        mode: request.mode,
        projectId: request.projectId,
        sourceDetailId,
      });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível ler a origem do detalhamento.',
      );
    } finally {
      setBusy('');
    }
  };
  const startDetailTransfer = async (mode: 'insert' | 'replace') => {
    if (isolationRef.current) {
      notify('Conclua a edição isolada antes de importar uma revisão.');
      return;
    }
    const request = { mode, projectId: historyRef.current.present.id };
    detailRequest.current = request;
    try {
      const file = await pickNativeFile(['json']);
      if (file === undefined) detailInput.current?.click();
      else if (file) await onDetailFile(file, request);
    } catch (error) {
      detailRequest.current = null;
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir o arquivo de origem.',
      );
    }
  };
  const acceptDetailTransfer = (plan: TransferPlan) => {
    if (
      isolationRef.current ||
      historyRef.current.present.id !== detailTransfer?.projectId
    ) {
      notify(
        'Conclua a edição e abra novamente a comparação no projeto de destino.',
      );
      return false;
    }
    if (!commit((current) => applyDetailTransfer(current, plan))) return false;
    const wasInsert = plan.mode === 'insert';
    setDetailTransfer(null);
    detailRequest.current = null;
    setSelectedRaw([]);
    setMaskId(null);
    setDraft([]);
    setToolRaw('select');
    setPage('drawing');
    setContext({
      projectId: historyRef.current.present.id,
      detailId: plan.targetDetailId!,
    });
    setSidebarOpen(true);
    setSidebarTab(activeSheet ? 'sheets' : 'project');
    if (wasInsert) {
      const placed = plan.project?.hierarchy.placements.find((v) =>
        plan.affectedViews.includes(v.id),
      );
      if (placed) {
        switchDocument(`sheet:${placed.sheetId}`);
        setSelectedView(placed.id);
        setSidebarTab('sheets');
      } else requestAnimationFrame(() => canvas()?.fit());
    }
    notify(
      `Detalhamento aplicado. ${plan.affectedViews.length} vista(s) vinculada(s) atualizada(s).${plan.raInvalidated ? ' RA desbloqueada e recalculada.' : ''}`,
    );
    return true;
  };
  const action = async (a: Action) => {
    if (a === 'fabrication') {
      if (isolationRef.current) {
        notify(
          'Conclua a edição isolada antes de organizar as posições de fabricação.',
        );
        return;
      }
      setFabricationOpen(true);
      return;
    }
    if (a === 'detail-repetition') {
      if (isolationRef.current) {
        notify(
          'Conclua a edição isolada antes de alterar a repetição do elemento.',
        );
        return;
      }
      const view = p.hierarchy.placements.find((v) => v.id === selectedView);
      setRepetitionDetailId(
        (activeSheet && view
          ? p.hierarchy.drawings.find((d) => d.id === view.drawingId)?.detailId
          : undefined) ??
          selectedGroup?.id ??
          activeDetailId,
      );
      return;
    }
    if (a === 'export-detail') {
      try {
        const view = p.hierarchy.placements.find((v) => v.id === selectedView);
        const detailId =
          (activeSheet && view
            ? p.hierarchy.drawings.find((d) => d.id === view.drawingId)
                ?.detailId
            : undefined) ??
          selectedGroup?.id ??
          activeDetailId;
        const { createDetailPackage } = await import('./domain/detailPackage');
        const pack = createDetailPackage(p, detailId, {
          producer: { app: 'ArmaduraStruct', version: appVersion },
        });
        const saved = await saveFile(
          `${safeName(pack.context.detail.name)}.osdetail.json`,
          JSON.stringify(pack, null, 2),
          'application/json',
          'json',
        );
        if (saved)
          notify(
            'Pacote OpenStruct exportado com unidades, origem, posições e vínculos.',
          );
      } catch (e) {
        notify(
          e instanceof Error
            ? e.message
            : 'Não foi possível exportar o pacote.',
        );
      }
      return;
    }
    if (a === 'interpret-cad') {
      if (isolationRef.current && p.scheduleLock) {
        notify(
          'Conclua a edição isolada antes de interpretar CAD com a RA bloqueada; a nova posição exige recalcular o quadro.',
        );
        return;
      }
      const owner = maskId ? p.hierarchy.objectDetails[maskId] : activeDetailId;
      if (activeSheet) {
        notify('Abra o desenho para interpretar uma referência CAD.');
        return;
      }
      if (isolationRef.current && owner !== isolationRef.current) {
        notify('Escolha uma máscara do detalhamento em edição.');
        return;
      }
      if (!p.masks.some((m) => p.hierarchy.objectDetails[m.id] === owner)) {
        notify('Importe primeiro uma máscara DXF/DWG neste detalhamento.');
        return;
      }
      setCadInterpretation({
        detailId: owner,
        maskId: maskId ?? undefined,
        projectId: p.id,
      });
      return;
    }
    if (a === 'insert-detail' || a === 'update-detail') {
      await startDetailTransfer(a === 'insert-detail' ? 'insert' : 'replace');
      return;
    }
    if (a === 'pdf') {
      await exportPaper(activeSheet ? [activeSheet.id] : undefined);
      return;
    }
    if (activeSheet && a === 'delete') {
      if (selectedView) {
        commit((p) => removePlacement(p, selectedView));
        setSelectedView(undefined);
      }
      return;
    }
    if (
      activeSheet &&
      [
        'copy',
        'move',
        'rotate',
        'mirror',
        'split',
        'join',
        'group',
        'ungroup',
        'import',
      ].includes(a)
    ) {
      notify(
        'Abra o desenho com duplo clique na vista para editar os objetos.',
      );
      return;
    }
    if (
      isolationRef.current &&
      [
        'new',
        'open',
        'renumber',
        'group',
        'ungroup',
        'lock-schedule',
        'refresh-schedule',
      ].includes(a)
    ) {
      notify('Conclua a edição isolada antes de usar este comando.');
      return;
    }
    if (
      groupSelection &&
      [
        'copy',
        'rotate',
        'mirror',
        'split',
        'join',
        'detail',
        'range',
        'repeat',
        'distribute',
      ].includes(a)
    ) {
      notify(
        'Abra o detalhamento para editar ou copiar objetos individualmente.',
      );
      return;
    }
    if (a === 'finish-detail') {
      finishDetailEdit();
      return;
    }
    if (a === 'edit-detail') {
      beginDetailEdit(selectedGroup?.id || activeDetailId);
      return;
    }
    if (a === 'group') {
      if (!selected.length && !maskId) {
        notify('Selecione os objetos a agrupar.');
        return;
      }
      setGroupName('Detalhamento');
      setGroupElementId(
        p.hierarchy.details.find((d) => d.id === activeDetailId)!.elementId,
      );
      setModal('group');
      return;
    }
    if (a === 'ungroup') {
      const groups = selectedGroups;
      if (!groups.length) {
        notify('Selecione um detalhamento agrupado.');
        return;
      }
      if (
        commit((current) =>
          groups.reduce(
            (next, d) => setDetailGrouped(next, d.id, false),
            current,
          ),
        )
      )
        notify(
          'Seleção desagrupada. As armaduras e seus quantitativos foram preservados.',
        );
      return;
    }
    if (a === 'convert' && polyline) {
      setTool('convert');
      return;
    }
    if (tools.includes(a as Tool)) {
      setTool(a as Tool);
      return;
    }
    try {
      if (a === 'sidebar') {
        setSidebarOpen(!sidebarOpen);
        setFocus(false);
      }
      if (a === 'focus') setFocus(!focus);
      if (a === 'refresh-schedule') {
        commit((p) =>
          p.scheduleLock
            ? {
                ...p,
                scheduleLock: createScheduleLock(p),
              }
            : { ...p },
        );
        notify('Relação de aço atualizada a partir das armaduras.');
      }
      if (a === 'lock-schedule') {
        commit((p) => ({
          ...p,
          scheduleLock: p.scheduleLock ? undefined : createScheduleLock(p),
        }));
        notify(
          p.scheduleLock
            ? 'Relação de aço em atualização automática.'
            : 'Relação de aço bloqueada. Use Atualizar RA após editar as barras.',
        );
      }
      if (a === 'renumber') {
        setNumberingOpen(true);
        return;
      }
      if (a === 'join') {
        const next = applyRebarBatch(
          p,
          executeRebarBatch(
            p,
            [{ type: 'bar.join', ids: selected as [string, string] }],
            { units: 'mm', scopeDetailId: isolationRef.current },
          ),
        );
        if (!commit(() => next)) return;
        select([next.bars.find((b) => selected.includes(b.id))!.id]);
        notify(
          'Poligonais emendadas em uma única barra. Para emendas com traspasse, use Dividir barra.',
        );
      }
      if (a === 'split') {
        if (!chosen || selected.length !== 1 || chosen.kind !== 'free')
          throw new Error('Selecione uma barra livre para dividir.');
        setSplitAt(geometry(chosen).length / 2);
        setModal('split');
      }
      if (a === 'undo') {
        setDraft([]);
        const h = historyRef.current;
        if (
          !canEditDetailChange(h.present, h.past.at(-1), isolationRef.current)
        ) {
          notify(
            'Não há alterações deste detalhamento para desfazer. Conclua a edição para acessar o histórico geral.',
          );
          return;
        }
        const updated = h.past.length
          ? {
              past: h.past.slice(0, -1),
              present: h.past.at(-1)!,
              future: [h.present, ...h.future],
            }
          : h;
        historyRef.current = updated;
        setHistory(updated);
      }
      if (a === 'redo') {
        setDraft([]);
        const h = historyRef.current;
        if (
          !canEditDetailChange(h.present, h.future[0], isolationRef.current)
        ) {
          notify('Não há alterações deste detalhamento para refazer.');
          return;
        }
        const updated = h.future.length
          ? {
              past: [...h.past, h.present],
              present: h.future[0],
              future: h.future.slice(1),
            }
          : h;
        historyRef.current = updated;
        setHistory(updated);
      }
      if (a === 'new') setModal('new');
      if (a === 'open') {
        const file = await pickNativeFile(['json']);
        if (file === undefined) projectInput.current?.click();
        else if (file) await onProjectFile(file);
      }
      if (a === 'import') {
        const file = await pickNativeFile(['dxf', 'dwg']);
        if (file === undefined) maskInput.current?.click();
        else if (file) await onMaskFile(file);
      }
      if (a === 'save') {
        const saved = await saveFile(
          `${safeName(p.name)}.armstruct.json`,
          JSON.stringify(p, null, 2),
          'application/json',
          'json',
        );
        if (saved)
          notify('Projeto salvo com armaduras, rebatimentos e máscaras.');
      }
      if (a === 'delete') {
        if (
          !commit((current) => {
            const commands: RebarCommand[] = current.bars
              .filter((b) => selected.includes(b.id))
              .map((b) => ({
                type: 'bar.delete',
                id: b.id,
                references: 'remove',
              }));
            const next = commands.length
              ? applyRebarBatch(
                  current,
                  executeRebarBatch(current, commands, {
                    units: 'mm',
                    scopeDetailId: isolationRef.current,
                  }),
                )
              : current;
            return {
              ...next,
              details: next.details.filter((d) => !selected.includes(d.id)),
              masks: next.masks.filter((m) => !selected.includes(m.id)),
              annotations: next.annotations.filter(
                (n) => !selected.includes(n.id),
              ),
              polylines: next.polylines.filter((l) => !selected.includes(l.id)),
            };
          })
        )
          return;
        select([]);
      }
      if (a === 'rotate' || a === 'mirror') {
        const transform = (points: Point[]) =>
          points.map((v) => {
            const d = sub(v, points[0]);
            return add(
              points[0],
              a === 'rotate' ? rotate(d, 90) : { x: -d.x, y: d.y },
            );
          });
        commit((p) => {
          const commands: RebarCommand[] = p.bars
            .filter((b) => selected.includes(b.id))
            .map((b) => ({ type: 'bar.transform', id: b.id, operation: a }));
          const next = commands.length
            ? applyRebarBatch(
                p,
                executeRebarBatch(p, commands, {
                  units: 'mm',
                  scopeDetailId: isolationRef.current,
                }),
              )
            : p;
          return {
            ...next,
            annotations: p.annotations.map((n) =>
              selected.includes(n.id)
                ? { ...n, points: transform(n.points) }
                : n,
            ),
            polylines: p.polylines.map((n) =>
              selected.includes(n.id)
                ? { ...n, points: transform(n.points) }
                : n,
            ),
          };
        });
      }
      if (a === 'fit') {
        if (page === 'drawing') canvas()?.fit();
        else {
          setPage('drawing');
          requestAnimationFrame(() => canvas()?.fit());
        }
      }
      if (a === 'grid') setGrid(!grid);
      if (a === 'snap') setSnap(!snap);
      if (a === 'ortho') setOrtho(!ortho);
      if (a === 'dimensions') setDimensions(!dimensions);
      if (a === 'schedule') setPage('schedule');
      if (a === 'help') setModal('help');
      if (['dxf', 'csv'].includes(a)) {
        const { toCsv, toDxf } = await import('./lib/exports');
        const data = a === 'dxf' ? toDxf(p) : toCsv(p);
        const saved = await saveFile(
          `${safeName(p.name)}.${a}`,
          data,
          a === 'csv' ? 'text/csv' : 'application/dxf',
          a,
        );
        if (saved) notify(`Exportação ${a.toUpperCase()} concluída.`);
      }
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : 'Não foi possível concluir a operação.',
      );
    }
  };
  const onMaskFile = async (file: File) => {
    const importDetailId = activeDetailId;
    if (p.masks.length >= 20) {
      notify('O limite desta versão é de 20 máscaras por projeto.');
      return;
    }
    setBusy(`Lendo ${file.name}…`);
    try {
      const mask = await importMask(file);
      if (
        !commit((p) =>
          completeOwnership(
            { ...p, masks: [...p.masks, mask] },
            importDetailId,
          ),
        )
      )
        return;
      select([]);
      setMaskId(mask.id);
      setSidebarOpen(true);
      setSidebarTab('properties');
      setPage('drawing');
      notify(
        `${mask.format} importado: ${mask.primitives.length} entidades.${mask.warnings.length ? ' Confira o relatório de importação.' : ' Confira a unidade e a escala no painel.'}`,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const onProjectFile = async (file: File) => {
    try {
      const next = await readProjectFile(file);
      if (!commit(() => next)) return;
      select([]);
      setTool('select');
      setTimeout(() => canvas()?.fit(), 50);
      notify('Projeto aberto.');
    } catch (e) {
      notify(
        `Projeto não aberto: ${e instanceof Error ? e.message : 'arquivo inválido'}`,
      );
    }
  };
  const runCommand = (raw: string) => {
    const value = raw.trim();
    setCommand('');
    const aliases: Record<string, Action> = {
      B: 'bar',
      BARRA: 'bar',
      L: 'bar',
      PL: 'polyline',
      POLILINHA: 'polyline',
      CONVERTER: 'convert',
      REPETIR: 'repeat',
      FAIXA: 'range',
      COTA: 'dimension-orthogonal',
      ALINHADA: 'dimension-aligned',
      CHAMADA: 'leader',
      CORTE: 'section',
      ARCO: 'section-arc',
      DIVIDIR: 'split',
      EMENDAR: 'join',
      RA: 'refresh-schedule',
      BLOQUEARRA: 'lock-schedule',
      E: 'stirrup',
      ESTRIBO: 'stirrup',
      V: 'select',
      H: 'pan',
      M: 'move',
      MOVE: 'move',
      C: 'copy',
      COPY: 'copy',
      R: 'detail',
      REBAT: 'detail',
      D: 'distribute',
      DIST: 'measure',
      MEDIR: 'measure',
      F: 'fit',
      ZOOM: 'fit',
      U: 'undo',
      REDO: 'redo',
      DEL: 'delete',
      Q: 'schedule',
      FORMA: 'follow',
      IMPORTAR: 'import',
      AGRUPAR: 'group',
      DESAGRUPAR: 'ungroup',
      EDITARDETALHE: 'edit-detail',
      CONCLUIR: 'finish-detail',
    };
    if (aliases[value.toUpperCase()]) {
      action(aliases[value.toUpperCase()]);
      cmdInput.current?.blur();
      return;
    }
    const polar = value.match(/^@([+-]?\d+(?:\.\d+)?)<([+-]?\d+(?:\.\d+)?)$/);
    if (polar) {
      const p = add(
        draft.at(-1) ?? { x: 0, y: 0 },
        rotate({ x: Number(polar[1]), y: 0 }, Number(polar[2])),
      );
      onPoint(p);
      return;
    }
    const xy = value.match(
      /^(@)?\s*([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)$/,
    );
    if (xy) {
      const base = xy[1] ? (draft.at(-1) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
      onPoint(add(base, { x: Number(xy[2]), y: Number(xy[3]) }));
      return;
    }
    if (!value) {
      finish();
      return;
    }
    notify(
      'Comando desconhecido. Use B, E, PL, COTA, CHAMADA, F, DIST ou consulte o Guia de uso.',
    );
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        detailTransfer ||
        cadInterpretation ||
        repetitionDetailId ||
        fabricationOpen ||
        numberingOpen
      ) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setDetailTransfer(null);
          detailRequest.current = null;
          setCadInterpretation(null);
          setRepetitionDetailId(undefined);
          setFabricationOpen(false);
          setNumberingOpen(false);
        } else if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o', 'z', 'y'].includes(e.key.toLowerCase())
        )
          e.preventDefault();
        return;
      }

      const typing = (e.target as HTMLElement)?.closest(
        'input,textarea,select',
      );
      if (e.key === 'Escape') {
        setModal(null);
        setTool('select');
        cmdInput.current?.blur();
        return;
      }
      if (typing) return;
      if (e.key === 'F4') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
        setFocus(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'F1') {
        e.preventDefault();
        setRibbonCollapsed((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setFocus((v) => !v);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          action('save');
        }
        if (e.key.toLowerCase() === 'o') {
          e.preventDefault();
          action('open');
        }
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          action(e.shiftKey ? 'redo' : 'undo');
        }
        if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          action('redo');
        }
        return;
      }
      if (modal) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish();
        return;
      }
      if (e.key === 'Delete') {
        action('delete');
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setSnap((v) => !v);
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setOrtho((v) => !v);
      }
      const a: Record<string, Action> = {
        b: 'bar',
        e: 'stirrup',
        v: 'select',
        h: 'pan',
        f: 'fit',
        m: 'move',
        c: 'copy',
        r: 'detail',
        d: 'distribute',
      };
      if (a[e.key.toLowerCase()]) action(a[e.key.toLowerCase()]);
      if (e.key === ':') {
        e.preventDefault();
        cmdInput.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  return (
    <div className={`app-shell ${focus ? 'focus-mode' : ''}`}>
      <input
        ref={maskInput}
        type="file"
        accept=".dxf,.dwg"
        hidden
        data-testid="mask-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onMaskFile(f);
        }}
      />
      <input
        ref={detailInput}
        type="file"
        hidden
        accept=".json"
        data-testid="detail-transfer-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onDetailFile(file);
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        hidden
        data-testid="project-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onProjectFile(f);
        }}
      />
      <header className="titlebar">
        <div className="app-brand">
          <img
            className="app-icon"
            src="/brand/armadurastruct-hephaestus.webp"
            alt=""
            width="32"
            height="32"
          />
          <strong>
            Armadura<span>Struct</span>
          </strong>
          <span className="version-badge">{appVersion}</span>
        </div>
        <div className="quick-tools">
          <button
            aria-label="Novo projeto"
            title="Novo projeto"
            onClick={() => action('new')}
          >
            <FilePlus2 size={15} />
          </button>
          <button
            aria-label="Abrir projeto"
            title="Abrir projeto"
            onClick={() => action('open')}
          >
            <FolderOpen size={15} />
          </button>
          <button
            aria-label="Salvar projeto"
            title="Salvar projeto · Ctrl+S"
            onClick={() => action('save')}
          >
            <Save size={15} />
          </button>
          <i />
          <button
            aria-label="Desfazer"
            title="Desfazer · Ctrl+Z"
            disabled={!canUndo}
            onClick={() => action('undo')}
          >
            <Undo2 size={15} />
          </button>
          <button
            aria-label="Refazer"
            title="Refazer · Ctrl+Y"
            disabled={!canRedo}
            onClick={() => action('redo')}
          >
            <Redo2 size={15} />
          </button>
        </div>
        <span className="window-project">{p.name}</span>
        <div className="titlebar-right">
          <span className="openstruct-wordmark">OPENSTRUCT</span>
          <i />
          <button
            aria-label="Alternar fundo do desenho"
            title="Alternar fundo do desenho"
            onClick={() => {
              setLight(!light);
              localStorage.setItem(
                'armadurastruct.canvas',
                !light ? 'light' : 'dark',
              );
            }}
          >
            {light ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button
            aria-label="Guia de uso"
            title="Guia de uso"
            onClick={() => setModal('help')}
          >
            <CircleHelp size={16} />
          </button>
        </div>
      </header>
      <Ribbon
        tab={tab}
        setTab={setTab}
        onAction={action}
        active={{
          [tool]: true,
          grid,
          snap,
          ortho,
          dimensions,
          'lock-schedule': !!p.scheduleLock,
          sidebar: sidebarOpen,
          focus,
        }}
        selected={selected.length}
        canUndo={canUndo}
        canRedo={canRedo}
        isolated={!!isolatedDetailId}
        groupSelected={groupSelection}
        collapsed={ribbonCollapsed || focus}
        setCollapsed={(v) => {
          setRibbonCollapsed(v);
          setFocus(false);
        }}
        settings={{
          diameter: newDiameter,
          quantity: newQuantity,
          spacing: newSpacing,
          cover,
        }}
        onSettings={(patch) => {
          if (patch.diameter !== undefined) setNewDiameter(patch.diameter);
          if (patch.quantity !== undefined) setNewQuantity(patch.quantity);
          if (patch.spacing !== undefined) setNewSpacing(patch.spacing);
        }}
      />
      {p.id === INITIAL_EXAMPLE_ID && (
        <div className="example-notice">
          <span>
            <strong>Exemplo ArmaduraStruct</strong> · Vigas e pilares · RA
            original de referência; comprimentos das dobras em conferência.
          </span>
          <button onClick={() => setExampleReviewOpen(true)}>
            Conferir exemplo
          </button>
        </div>
      )}
      <div className="workspace">
        <main className="main-workspace">
          <div className="document-tabs">
            <div className="document-strip" aria-label="Documentos abertos">
              <button
                className={
                  documentKey === 'model' && page === 'drawing' ? 'active' : ''
                }
                aria-label="Desenho"
                onClick={() => switchDocument('model')}
              >
                <span className="document-icon">⌗</span> Desenho{' '}
                <span className="tab-dot" />
              </button>
              {[
                ...p.sheets.map((s) => ({
                  key: `sheet:${s.id}`,
                  name: s.name,
                  prefix: '▤',
                  kind: 'folha',
                })),
                ...p.hierarchy.drawings.map((d) => ({
                  key: `drawing:${d.id}`,
                  name: `${p.hierarchy.details.find((n) => n.id === d.detailId)?.name} · ${d.name}`,
                  prefix: '⌗',
                  kind: 'desenho',
                })),
              ]
                .filter(
                  (d) =>
                    documents.projectId === p.id &&
                    documents.opened.includes(d.key),
                )
                .map((d) => (
                  <div
                    key={d.key}
                    className={`document-tab ${documentKey === d.key && page === 'drawing' ? 'active' : ''}`}
                  >
                    <button
                      title={d.name}
                      aria-label={`Aba ${d.kind} ${d.name}`}
                      onClick={() => switchDocument(d.key)}
                    >
                      {d.prefix} {d.name}
                    </button>
                    <button
                      className="close-document"
                      aria-label={`Fechar aba ${d.name}`}
                      onClick={() => closeDocument(d.key)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
            </div>
            <button
              className={page === 'schedule' ? 'active' : ''}
              onClick={() => setPage('schedule')}
            >
              <Table2 size={14} /> Quadro de aço <em>{p.bars.length}</em>
            </button>
            <div className="document-toolbar">
              <button
                aria-label="Foco no CAD"
                title="Foco no CAD · Ctrl+0"
                onClick={() => setFocus(!focus)}
              >
                <Focus size={14} />
              </button>
              <button
                aria-label="Alternar painel lateral"
                title="Painel lateral · F4"
                onClick={() => {
                  setSidebarOpen(!sidebarOpen);
                  setFocus(false);
                }}
              >
                <PanelRight size={14} />
              </button>
              <button
                onClick={() => action('pdf')}
                title={
                  activeSheet
                    ? 'Exportar esta folha em PDF'
                    : 'Exportar todas as folhas em PDF'
                }
              >
                <ArrowDownToLine size={14} />
                <span>{activeSheet ? 'PDF desta folha' : 'Exportar PDF'}</span>
              </button>
            </div>
          </div>
          {isolatedDetailId && (
            <div
              className="isolation-bar"
              role="region"
              aria-label="Edição isolada"
            >
              <nav aria-label="Caminho de edição">
                <span>Projeto</span>
                <b title={detailPath(p, isolatedDetailId)}>
                  {detailPath(p, isolatedDetailId)}
                </b>
              </nav>
              <span className="isolation-hint">
                Demais detalhamentos protegidos
              </span>
              <button onClick={finishDetailEdit}>Concluir edição</button>
            </div>
          )}
          {page === 'drawing' && activeSheet ? (
            <SheetCanvas
              key={`${p.id}:${sessionsProject.current === p.id ? 'ready' : 'loading'}:${documentKey}`}
              ref={paperCanvas}
              project={p}
              sheet={activeSheet}
              initialState={sessions.current.get(documentKey)?.camera}
              selectedView={selectedView}
              pan={tool === 'pan'}
              onSelect={(id) => {
                setSelectedView(id);
                setSidebarTab('sheets');
              }}
              onMove={(id, origin) =>
                commitLayout((p) => updatePlacement(p, id, { origin }))
              }
              onOpenDrawing={openDrawing}
            />
          ) : page === 'drawing' ? (
            <>
              {tool === 'follow' && (
                <div className="context-bar">
                  <span>SEGUIR FÔRMA</span>
                  <NumberField
                    label="Cobrimento"
                    value={cover}
                    min={0}
                    onChange={setCover}
                    suffix="mm"
                  />
                  <span>
                    Ø {newDiameter} mm · clique no contorno da máscara
                  </span>
                </div>
              )}
              <CadCanvas
                key={`${p.id}:${sessionsProject.current === p.id ? 'ready' : 'loading'}:${documentKey}`}
                initialState={sessions.current.get(documentKey)?.camera}
                ref={cad}
                project={p}
                isolatedDetailId={isolatedDetailId}
                onEditDetail={beginDetailEdit}
                tool={tool}
                selected={selected}
                setSelected={select}
                onPoint={onPoint}
                onPrimitive={follow}
                onFinish={finish}
                onBarChange={editBar}
                draft={draft}
                grid={grid}
                snap={snap}
                ortho={ortho}
                light={light}
                setTool={setTool}
                onCursor={onCursor}
                showDimensions={dimensions}
              />
              <div className="command-panel">
                <div className="command-history">
                  <ChevronRight size={12} />
                  <span>
                    {draft.length
                      ? `${draft.length} ponto(s) · ${prompts[tool]}`
                      : message}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runCommand(command);
                  }}
                >
                  <Terminal size={15} />
                  <label htmlFor="command-input">Comando</label>
                  <input
                    ref={cmdInput}
                    id="command-input"
                    aria-label="Comando CAD"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="Digite um comando ou coordenadas X,Y"
                    autoComplete="off"
                  />
                  <kbd>↵</kbd>
                </form>
              </div>
            </>
          ) : (
            <>
              <div
                className={`schedule-control ${scheduleChanged(p) ? 'stale' : ''}`}
              >
                <span>
                  {p.scheduleLock
                    ? scheduleChanged(p)
                      ? 'RA bloqueada · há alterações pendentes'
                      : 'RA bloqueada · valores conferidos'
                    : 'RA automática · vinculada ao desenho'}
                </span>
                <button onClick={() => action('refresh-schedule')}>
                  <RefreshCw size={14} />
                  Atualizar RA
                </button>
                <button onClick={() => action('lock-schedule')}>
                  <LockKeyhole size={14} />
                  {p.scheduleLock ? 'Desbloquear RA' : 'Bloquear RA'}
                </button>
              </div>
              <Schedule project={p} onSelect={(id) => select([id])} />
            </>
          )}
        </main>
        {sidebarOpen && !focus && (
          <aside className="sidebar-dock" aria-label="Painel lateral">
            <div
              className="sidebar-tabs"
              role="tablist"
              aria-label="Painel lateral"
            >
              <button
                role="tab"
                aria-selected={sidebarTab === 'project'}
                onClick={() => setSidebarTab('project')}
              >
                Projeto
              </button>
              <button
                role="tab"
                aria-selected={sidebarTab === 'properties'}
                onClick={() => setSidebarTab('properties')}
              >
                Propriedades
              </button>
              <button
                role="tab"
                aria-selected={sidebarTab === 'sheets'}
                onClick={() => setSidebarTab('sheets')}
              >
                Pranchas
              </button>
              <button
                className="dock-close"
                aria-label="Recolher painel lateral"
                title="Recolher painel · F4"
                onClick={() => setSidebarOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            {sidebarTab === 'sheets' ||
            (activeSheet && sidebarTab === 'properties') ? (
              <SheetManager
                key={`${p.id}:${activeSheet?.id ?? 'model'}`}
                project={p}
                sheetId={activeSheet?.id}
                selectedView={selectedView}
                onSelectView={setSelectedView}
                onChange={commitLayout}
                onExportAll={() => exportPaper()}
                onOpenSheet={(id) => {
                  switchDocument(`sheet:${id}`);
                  setSidebarTab('sheets');
                }}
                onOpenDrawing={openDrawing}
                locked={!!isolatedDetailId}
              />
            ) : sidebarTab === 'project' ? (
              <ProjectTree
                key={p.id}
                project={p}
                activeDetailId={activeDetailId}
                isolatedDetailId={isolatedDetailId}
                onEditDetail={beginDetailEdit}
                onOpenDrawing={openDrawing}
                onSelectDetail={(id) => select(detailObjectIds(p, id))}
                onActiveDetail={activateDetail}
                onHierarchy={(next) => commit(() => next)}
                selected={selected}
                maskId={maskId}
                onSelect={select}
                onMask={(id) => {
                  select([]);
                  setMaskId(id);
                  const owner = p.hierarchy.objectDetails[id];
                  if (owner) activateDetail(owner);
                  setSidebarTab('properties');
                }}
                onToggleMask={(id) =>
                  commit((p) => ({
                    ...p,
                    masks: p.masks.map((m) =>
                      m.id === id ? { ...m, visible: !m.visible } : m,
                    ),
                  }))
                }
                onRemoveMask={(id) => {
                  commit((p) => ({
                    ...p,
                    masks: p.masks.filter((m) => m.id !== id),
                  }));
                  if (id === maskId) setMaskId(null);
                }}
                onImport={() => action('import')}
                onDemo={() => {
                  setBusy('Carregando Exemplo ArmaduraStruct…');
                  void initialExampleProject()
                    .then((project) => {
                      commit(() => project);
                      select([]);
                      setTool('select');
                      setDocuments({
                        projectId: project.id,
                        active: `sheet:${INITIAL_EXAMPLE_SHEETS[0]}`,
                        opened: INITIAL_EXAMPLE_SHEETS.map(
                          (id) => `sheet:${id}`,
                        ),
                      });
                      setSidebarTab('sheets');
                    })
                    .catch((e) => notify(String(e)))
                    .finally(() => setBusy(''));
                }}
              />
            ) : selected.length === 1 &&
              p.details.some((d) => d.id === selected[0]) ? (
              <RepresentationInspector
                representation={p.details.find((d) => d.id === selected[0])!}
                onEditBar={() => {
                  const r = p.details.find((d) => d.id === selected[0])!;
                  const owner = p.hierarchy.objectDetails[r.barId];
                  const drawing = p.hierarchy.drawings.find(
                    (d) => d.detailId === owner,
                  );
                  if (drawing) {
                    openDrawing(drawing.id);
                    select([r.barId]);
                  }
                }}
                onChange={(patch) =>
                  commitRebars([
                    {
                      type: 'representation.update',
                      id: selected[0],
                      ...patch,
                    },
                  ])
                }
                onDelete={() => {
                  if (
                    commitRebars([
                      { type: 'representation.delete', id: selected[0] },
                    ])
                  )
                    select([]);
                }}
              />
            ) : groupSelection ? (
              <div className="inspector detail-inspector">
                <div className="panel-heading">
                  <Shapes size={15} />
                  <b>Detalhamento selecionado</b>
                </div>
                <div className="panel-scroll">
                  <h3>
                    {selectedGroup?.name ||
                      `${selectedGroups.length} detalhamentos`}
                  </h3>
                  {selectedGroup && (
                    <p className="field-help">
                      {detailPath(p, selectedGroup.id)}
                    </p>
                  )}
                  <p>{selected.length} objetos selecionados como conjunto.</p>
                  <p className="field-help">
                    Abra a edição isolada para alterar as peças, cotas e
                    chamadas.
                  </p>
                  {selectedGroup && (
                    <button
                      className="primary detail-edit-action"
                      onClick={() => beginDetailEdit(selectedGroup.id)}
                    >
                      Editar detalhamento isoladamente
                    </button>
                  )}
                  <button
                    className="detail-edit-action"
                    onClick={() => action('ungroup')}
                  >
                    Desagrupar seleção
                  </button>
                  <p className="field-help">
                    Desagrupar mantém as armaduras, os vínculos e o levantamento
                    de aço.
                  </p>
                </div>
              </div>
            ) : annotation || polyline ? (
              <DraftInspector
                annotation={annotation}
                polyline={polyline}
                project={p}
                onAnnotation={(patch) =>
                  commit((p) => ({
                    ...p,
                    annotations: p.annotations.map((n) =>
                      n.id === annotation?.id ? { ...n, ...patch } : n,
                    ),
                  }))
                }
                onPolyline={(patch) =>
                  commit((p) => ({
                    ...p,
                    polylines: p.polylines.map((n) =>
                      n.id === polyline?.id ? { ...n, ...patch } : n,
                    ),
                  }))
                }
              />
            ) : isolatedDetailId && !chosen && !mask ? (
              <div className="inspector">
                <div className="panel-heading">
                  <Shapes size={15} />
                  <b>Edição do detalhamento</b>
                </div>
                <p className="isolation-empty">
                  Selecione um objeto deste detalhamento para editar suas
                  propriedades. Use Concluir edição para voltar ao projeto.
                </p>
              </div>
            ) : (
              <Inspector
                project={p}
                bar={chosen}
                mask={mask}
                onBar={(patch) => chosen && editBar(chosen.id, patch)}
                onDistributionSpacing={(spacing) =>
                  chosen?.distribution &&
                  commitRebars([
                    {
                      type: 'distribution.set',
                      barId: chosen.id,
                      distribution: chosen.distribution,
                      count: { mode: 'spacing', spacing },
                    },
                  ])
                }
                onMask={(patch) =>
                  commit((p) => ({
                    ...p,
                    masks: p.masks.map((m) =>
                      m.id === maskId ? { ...m, ...patch } : m,
                    ),
                  }))
                }
                onProject={(patch) =>
                  commit((current) => {
                    if (!patch.details) return { ...current, ...patch };
                    const commands: RebarCommand[] = patch.details
                      .filter(
                        (d) =>
                          JSON.stringify(d) !==
                          JSON.stringify(
                            current.details.find((old) => old.id === d.id),
                          ),
                      )
                      .map((d) => ({
                        type: 'representation.update',
                        id: d.id,
                        barId: d.barId,
                        origin: d.origin,
                        rotation: d.rotation,
                        scale: d.scale,
                        identification: d.identification,
                      }));
                    return commands.length
                      ? applyRebarBatch(
                          current,
                          executeRebarBatch(current, commands, {
                            units: 'mm',
                            scopeDetailId: isolationRef.current,
                          }),
                        )
                      : current;
                  })
                }
                onSelectRepresentation={(id) => select([id])}
                onRemoveDetails={() =>
                  commitRebars(
                    p.details
                      .filter((d) => d.barId === chosen?.id)
                      .map((d) => ({
                        type: 'representation.delete',
                        id: d.id,
                      })),
                  )
                }
              />
            )}
          </aside>
        )}
      </div>
      <footer className="statusbar">
        <span
          className="active-detail-path"
          title={detailPath(p, activeDetailId)}
        >
          {detailPath(p, activeDetailId)}
        </span>
        <span
          className={`save-status ${saveState.startsWith('Falha') ? 'warning-text' : ''}`}
        >
          <Check size={12} />
          {saveState}
        </span>
        <span className="cursor-position" ref={cursorReadout}>
          X 0,0 · Y 0,0 · mm
        </span>
        <div className="status-toggles">
          <button
            className={grid ? 'active' : ''}
            onClick={() => setGrid(!grid)}
          >
            GRADE
          </button>
          <button
            className={snap ? 'active' : ''}
            onClick={() => setSnap(!snap)}
          >
            ENCAIXES <kbd>F3</kbd>
          </button>
          <button
            className={ortho ? 'active' : ''}
            onClick={() => setOrtho(!ortho)}
          >
            ORTO <kbd>F8</kbd>
          </button>
          <button
            className={dimensions ? 'active' : ''}
            onClick={() => setDimensions(!dimensions)}
          >
            COTAS
          </button>
        </div>
        <span className="version-footer">OpenStruct · {appVersion}</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Fechar aviso" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {(!ready || busy) && (
        <div className="busy-overlay">
          <LoaderCircle className="spin" size={28} />
          <b>{busy || 'Abrindo projeto…'}</b>
          <span>Processamento local</span>
        </div>
      )}
      {exampleReviewOpen && p.id === INITIAL_EXAMPLE_ID && (
        <Suspense
          fallback={<div className="busy-overlay">Preparando conferência…</div>}
        >
          <ExampleReviewDialog
            project={p}
            onClose={() => setExampleReviewOpen(false)}
          />
        </Suspense>
      )}
      {detailTransfer && (
        <Suspense
          fallback={<div className="busy-overlay">Preparando comparação…</div>}
        >
          <DetailTransferDialog
            project={p}
            source={detailTransfer.source}
            fileName={detailTransfer.fileName}
            mode={detailTransfer.mode}
            elementId={
              p.hierarchy.details.find((d) => d.id === activeDetailId)!
                .elementId
            }
            activeDetailId={activeDetailId}
            sourceDetailId={detailTransfer.sourceDetailId}
            sheetId={activeSheet?.id}
            onApply={acceptDetailTransfer}
            onClose={() => {
              setDetailTransfer(null);
              detailRequest.current = null;
            }}
          />
        </Suspense>
      )}
      {cadInterpretation && (
        <Suspense
          fallback={
            <div className="busy-overlay">Preparando interpretação…</div>
          }
        >
          <CadInterpretDialog
            project={p}
            detailId={cadInterpretation.detailId}
            maskId={cadInterpretation.maskId}
            onClose={() => setCadInterpretation(null)}
            onApply={(plan: CadInterpretation) => {
              if (
                p.id !== cadInterpretation.projectId ||
                (isolationRef.current &&
                  isolationRef.current !== cadInterpretation.detailId)
              ) {
                notify('O contexto mudou. Abra novamente a interpretação.');
                return false;
              }
              if (!commit((current) => applyCadInterpretation(current, plan)))
                return false;
              setCadInterpretation(null);
              setDraft([]);
              setToolRaw('select');
              setMaskId(null);
              setContext({
                projectId: p.id,
                detailId: cadInterpretation.detailId,
              });
              setSelectedRaw(plan.bar ? [plan.bar.id] : []);
              setSidebarTab('properties');
              setSidebarOpen(true);
              notify(
                'Posição física criada por atribuição explícita. A máscara foi preservada como referência.',
              );
              return true;
            }}
          />
        </Suspense>
      )}
      {numberingOpen && (
        <Suspense
          fallback={<div className="busy-overlay">Preparando numeração…</div>}
        >
          <NumberingDialog
            project={p}
            detailId={activeDetailId}
            selected={selected}
            onClose={() => setNumberingOpen(false)}
            onApply={(result) => {
              if (!commit((current) => applyRebarBatch(current, result)))
                return false;
              setNumberingOpen(false);
              notify(
                'Posições renumeradas. Geometria, vínculos e quantitativos preservados.',
              );
              return true;
            }}
          />
        </Suspense>
      )}
      {fabricationOpen && (
        <Suspense
          fallback={<div className="busy-overlay">Comparando posições…</div>}
        >
          <FabricationDialog
            project={p}
            onClose={() => setFabricationOpen(false)}
            onApply={(result) => {
              if (isolationRef.current) {
                notify('Conclua a edição isolada.');
                return false;
              }
              if (!commit((current) => applyRebarBatch(current, result)))
                return false;
              setFabricationOpen(false);
              notify(
                'Posições de fabricação atualizadas. Ocorrências, vistas e quantidades preservadas.',
              );
              return true;
            }}
          />
        </Suspense>
      )}
      {repetitionDetailId && (
        <Suspense
          fallback={<div className="busy-overlay">Preparando repetições…</div>}
        >
          <DetailRepetitionDialog
            project={p}
            detailId={repetitionDetailId}
            onClose={() => setRepetitionDetailId(undefined)}
            onApply={(next, id, base) => {
              if (historyRef.current.present !== base || isolationRef.current) {
                notify('O projeto/contexto mudou. Abra novamente a repetição.');
                return false;
              }
              if (!commit(() => next)) return false;
              setRepetitionDetailId(undefined);
              setSelectedRaw([]);
              setMaskId(null);
              setContext({ projectId: next.id, detailId: id });
              notify(
                'Repetição aplicada. Vistas e relação de aço usam uma única definição física.',
              );
              return true;
            }}
          />
        </Suspense>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'group'
                ? 'Agrupar em detalhamento'
                : modal === 'new'
                  ? 'Novo projeto'
                  : modal === 'split'
                    ? 'Dividir barra'
                    : 'Guia de uso'
            }
          >
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === 'group' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const current = historyRef.current.present;
                    const grouped = groupInDetail(
                      current,
                      maskId ? [maskId] : selected,
                      groupName,
                      groupElementId,
                    );
                    if (!commit(() => grouped.project)) return;
                    setContext({ projectId: current.id, detailId: grouped.id });
                    setSelectedRaw(
                      detailObjectIds(grouped.project, grouped.id),
                    );
                    setMaskId(null);
                    setModal(null);
                    setTool('select');
                    setSidebarTab('properties');
                    notify(
                      'Objetos agrupados sem alterar o aço. Duplo clique no conjunto abre a edição isolada.',
                    );
                  } catch (e) {
                    notify(
                      e instanceof Error
                        ? e.message
                        : 'Não foi possível agrupar.',
                    );
                  }
                }}
              >
                <h2>Agrupar em detalhamento</h2>
                <p>Os objetos mantêm seus IDs, coordenadas e dados físicos.</p>
                <label className="field">
                  <span>Nome do detalhamento</span>
                  <input
                    autoFocus
                    aria-label="Nome do novo detalhamento"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <label className="field">
                  <span>Elemento estrutural</span>
                  <select
                    aria-label="Elemento do novo detalhamento"
                    value={groupElementId}
                    onChange={(e) => setGroupElementId(e.target.value)}
                  >
                    {p.hierarchy.elements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {
                          p.hierarchy.floors.find((f) => f.id === e.floorId)
                            ?.name
                        }{' '}
                        / {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="modal-actions">
                  <button type="button" onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="primary" type="submit">
                    Agrupar objetos
                  </button>
                </div>
              </form>
            ) : modal === 'split' && chosen ? (
              <>
                <span className="eyebrow">{chosen.mark} · EDIÇÃO DA BARRA</span>
                <h2>Dividir barra</h2>
                <p>
                  Cria duas posições e mantém a quantidade de peças. O traspasse
                  é um comprimento informado pelo projetista; não há cálculo
                  automático de ancoragem.
                </p>
                <NumberField
                  label="Comprimento até o corte"
                  value={splitAt / 10}
                  onChange={(v) => setSplitAt(v * 10)}
                  min={0.01}
                  suffix="cm"
                />
                <NumberField
                  label="Traspasse informado"
                  value={lap / 10}
                  onChange={(v) => setLap(v * 10)}
                  min={0}
                  suffix="cm"
                />
                <p className="field-help">
                  O corte é medido pelo eixo da barra, incluindo as dobras. Toda
                  a sobreposição precisa caber em um trecho reto. Comprimento
                  atual: {format(geometry(chosen).length / 10)} cm.
                </p>
                <div className="modal-actions">
                  <button onClick={() => setModal(null)}>Cancelar</button>
                  <button
                    className="primary"
                    onClick={() => {
                      try {
                        const next = applyRebarBatch(
                          p,
                          executeRebarBatch(
                            p,
                            [
                              {
                                type: 'bar.split',
                                id: chosen.id,
                                station: splitAt,
                                lap,
                              },
                            ],
                            {
                              units: 'mm',
                              scopeDetailId: isolationRef.current,
                            },
                          ),
                        );
                        if (!commit(() => next)) return;
                        setModal(null);
                        notify(
                          'Barra dividida. As duas posições e o traspasse já entram no quantitativo.',
                        );
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    Aplicar divisão
                  </button>
                </div>
              </>
            ) : modal === 'new' ? (
              <>
                <span className="eyebrow">ARMADURASTRUCT</span>
                <h2>Novo projeto</h2>
                <p>Um espaço para organizar seus próximos detalhes.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    commit(() => ({
                      ...emptyProject(),
                      name: newName.trim() || 'Novo projeto',
                    }));
                    select([]);
                    setTool('select');
                    setModal(null);
                  }}
                >
                  <label className="field">
                    <span>Nome do projeto</span>
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={150}
                    />
                  </label>
                  <div className="modal-actions">
                    <button type="button" onClick={() => setModal(null)}>
                      Cancelar
                    </button>
                    <button className="primary" type="submit">
                      Criar projeto
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  DESENHAR. DETALHAR. QUANTIFICAR.
                </span>
                <h2>Seu ambiente de armaduras.</h2>
                <div className="help-steps">
                  <p>
                    <b>01 · Referencie a fôrma</b>Importe DXF ou DWG. Confira
                    unidade e escala com Medir. Camadas e opacidade estão nas
                    propriedades da máscara.
                  </p>
                  <p>
                    <b>02 · Crie suas posições</b>B desenha barras por vértices;
                    E cria estribos com dois cantos. Use diâmetro de dobra e
                    ganchos definidos para o projeto.
                  </p>
                  <p>
                    <b>03 · Detalhe e distribua</b>Crie rebatimentos, faixas,
                    cotas e chamadas vinculadas. Divida barras com traspasse
                    informado e confira os quantitativos na relação de aço.
                  </p>
                  <p>
                    <b>04 · Entregue o desenho</b>Salve o projeto completo e
                    exporte DXF, prancha PDF e CSV. Configure a escala por vista
                    na aba Pranchas; o DXF preserva a geometria em mm. Atualize
                    a RA se estiver bloqueada e desatualizada.
                  </p>
                </div>
                <div className="shortcut-grid">
                  <span>
                    <kbd>Enter</kbd> Concluir barra
                  </span>
                  <span>
                    <kbd>Esc</kbd> Cancelar comando
                  </span>
                  <span>
                    <kbd>F</kbd> Enquadrar
                  </span>
                  <span>
                    <kbd>Ctrl Z</kbd> Desfazer
                  </span>
                  <span>
                    <kbd>F3</kbd> Encaixes
                  </span>
                  <span>
                    <kbd>F8</kbd> Ortogonal
                  </span>
                  <span>
                    <kbd>F4</kbd> Painel lateral
                  </span>
                  <span>
                    <kbd>Ctrl F1</kbd> Faixa de comandos
                  </span>
                  <span>
                    <kbd>Ctrl 0</kbd> Foco no CAD
                  </span>
                  <span>
                    <kbd>PL</kbd> Polilinha CAD
                  </span>
                  <span>
                    <kbd>@500,0</kbd> Relativo em mm
                  </span>
                  <span>
                    <kbd>@500&lt;90</kbd> Polar
                  </span>
                </div>
                <p className="field-help">
                  Para seguir fôrma, selecione uma polilinha da máscara.
                  Contornos fechados são deslocados para dentro; linhas abertas,
                  para a esquerda do sentido do desenho. As terminações devem
                  ser conferidas pelo projetista.
                </p>
                <p className="field-help">
                  Leitura DWG: LibreDWG / GPL-3.0. O relatório de importação
                  informa entidades omitidas. Arquivos XREF externos e objetos
                  proprietários não são carregados.
                </p>
                <button className="primary" onClick={() => setModal(null)}>
                  Começar a detalhar
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
