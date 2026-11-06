import { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import Ribbon, { type Action } from './components/Ribbon';
import CadCanvas, { type CadHandle } from './components/CadCanvas';
import {
  Inspector,
  NumberField,
  ProjectTree,
  Schedule,
  DraftInspector,
} from './components/Panels';
import {
  decodeProject,
  demoProject,
  emptyProject,
  newBar,
  nextMark,
  scheduleChanged,
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
  importMask,
  pickNativeFile,
  restore,
  safeName,
  saveFile,
} from './lib/files';
import {
  transformBar,
  splitBar,
  joinBars,
  quantityForSpacing,
  renumber,
} from './domain/editing';
import { annotationError } from './domain/drafting';
import { version as appVersion } from '../package.json';
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
    present: demoProject(),
    future: [],
  }));
  const p = history.present;
  const [ready, setReady] = useState(false),
    [selected, setSelectedRaw] = useState<string[]>([]),
    [maskId, setMaskId] = useState<string | null>(null);
  const [tool, setToolRaw] = useState<Tool>('select'),
    [draft, setDraft] = useState<Point[]>([]),
    [tab, setTab] = useState('Armaduras'),
    [page, setPage] = useState<'drawing' | 'schedule'>('drawing');
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
  const [modal, setModal] = useState<'new' | 'help' | 'split' | null>(null),
    [newName, setNewName] = useState('Novo projeto'),
    [cover, setCover] = useState(30),
    [newDiameter, setNewDiameter] = useState(8),
    [newQuantity, setNewQuantity] = useState(1),
    [newSpacing, setNewSpacing] = useState(150),
    [splitAt, setSplitAt] = useState(500),
    [lap, setLap] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<'project' | 'properties'>(
    'project',
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('armadurastruct.sidebar') !== 'closed',
  );
  const [ribbonCollapsed, setRibbonCollapsed] = useState(
    () => localStorage.getItem('armadurastruct.ribbon') === 'collapsed',
  );
  const [focus, setFocus] = useState(false);
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
  const cad = useRef<CadHandle>(null),
    maskInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    cmdInput = useRef<HTMLInputElement>(null);
  const cursorReadout = useRef<HTMLSpanElement>(null);
  const onCursor = useCallback((point: Point) => {
    if (cursorReadout.current)
      cursorReadout.current.textContent = `X ${format(point.x, 1)}   Y ${format(point.y, 1)}   mm`;
  }, []);
  const chosen = p.bars.find((b) => b.id === selected[0]),
    mask = p.masks.find((m) => m.id === maskId);
  const annotation = p.annotations.find((a) => a.id === selected[0]);
  const polyline = p.polylines.find((a) => a.id === selected[0]);
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
      .then((raw) => {
        if (raw && alive) {
          const project = decodeProject(raw);
          setHistory({ past: [], present: project, future: [] });
        }
      })
      .catch(() => {
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
    if (!ready) return;
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
    (change: (current: Project) => Project) =>
      setHistory((h) => ({
        past: [...h.past.slice(-39), h.present],
        present: change(h.present),
        future: [],
      })),
    [],
  );
  const select = (ids: string[]) => {
    setSelectedRaw(ids);
    setMaskId(null);
    if (ids.length) setSidebarTab('properties');
  };
  const setTool = (t: Tool) => {
    setToolRaw(t);
    setDraft([]);
    setPage('drawing');
    setMessage(prompts[t]);
  };
  const editBar = (id: string, patch: Partial<Bar>) => {
    if (
      patch.mark &&
      p.bars.some((b) => b.id !== id && b.mark === patch.mark)
    ) {
      notify('Essa posição já existe. Escolha outra identificação.');
      return;
    }
    commit((p) => ({
      ...p,
      bars: p.bars.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  };
  const insertBar = (b: Bar, removePolyline?: string) => {
    commit((p) => ({
      ...p,
      bars: [...p.bars, b],
      polylines: removePolyline
        ? p.polylines.filter((l) => l.id !== removePolyline)
        : p.polylines,
    }));
    select([b.id]);
    setDraft([]);
    setMessage(`${b.mark} criada. Continue desenhando ou pressione Esc.`);
  };
  const finish = () => {
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
        for (const b of p.bars.filter((b) => selected.includes(b.id))) {
          const id = uid();
          copies.set(b.id, id);
          selectedIds.push(id);
          next = {
            ...next,
            bars: [
              ...next.bars,
              {
                ...b,
                id,
                mark: nextMark(next),
                origin: add(b.origin, delta),
                distribution: b.distribution
                  ? {
                      ...b.distribution,
                      start: b.distribution.start
                        ? add(b.distribution.start, delta)
                        : undefined,
                      end: add(b.distribution.end, delta),
                    }
                  : undefined,
              },
            ],
          };
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
      } else
        next = {
          ...p,
          bars: p.bars.map((b) =>
            selected.includes(b.id)
              ? {
                  ...b,
                  origin: add(b.origin, delta),
                  distribution: b.distribution
                    ? {
                        ...b.distribution,
                        start: b.distribution.start
                          ? add(b.distribution.start, delta)
                          : undefined,
                        end: add(b.distribution.end, delta),
                      }
                    : undefined,
                }
              : b,
          ),
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
        };
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
        editBar(chosen.id, {
          distribution: { end: point, render: 'bars' },
          quantity: quantityForSpacing(
            distance(chosen.origin, point),
            newSpacing,
          ),
        });
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
        editBar(chosen.id, {
          distribution: { start, end, render: 'ticks' },
          quantity: quantityForSpacing(distance(start, end), newSpacing),
        });
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
      commit((p) => ({
        ...p,
        details: [...p.details, { id: uid(), barId: chosen.id, origin: point }],
      }));
      setTool('select');
      notify('Rebatimento criado. Ele permanece vinculado à posição original.');
      return;
    }
    if (tool === 'distribute') {
      if (distance(chosen.origin, point) < 1) return;
      editBar(chosen.id, {
        distribution: { end: point },
        quantity: Math.max(2, chosen.quantity),
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
  const action = async (a: Action) => {
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
                scheduleLock: {
                  at: new Date().toISOString(),
                  bars: structuredClone(p.bars),
                },
              }
            : { ...p },
        );
        notify('Relação de aço atualizada a partir das armaduras.');
      }
      if (a === 'lock-schedule') {
        commit((p) => ({
          ...p,
          scheduleLock: p.scheduleLock
            ? undefined
            : { at: new Date().toISOString(), bars: structuredClone(p.bars) },
        }));
        notify(
          p.scheduleLock
            ? 'Relação de aço em atualização automática.'
            : 'Relação de aço bloqueada. Use Atualizar RA após editar as barras.',
        );
      }
      if (a === 'renumber') {
        commit(renumber);
        notify(
          'Posições renumeradas; chamadas e rebatimentos mantiveram os vínculos.',
        );
      }
      if (a === 'join') {
        const next = joinBars(p, selected);
        commit(() => next);
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
        setHistory((h) =>
          h.past.length
            ? {
                past: h.past.slice(0, -1),
                present: h.past.at(-1)!,
                future: [h.present, ...h.future],
              }
            : h,
        );
      }
      if (a === 'redo') {
        setDraft([]);
        setHistory((h) =>
          h.future.length
            ? {
                past: [...h.past, h.present],
                present: h.future[0],
                future: h.future.slice(1),
              }
            : h,
        );
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
        commit((p) => ({
          ...p,
          bars: p.bars.filter((b) => !selected.includes(b.id)),
          details: p.details.filter((d) => !selected.includes(d.barId)),
          annotations: p.annotations.filter(
            (a) =>
              !selected.includes(a.id) && !selected.includes(a.barId ?? ''),
          ),
          polylines: p.polylines.filter((a) => !selected.includes(a.id)),
        }));
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
        commit((p) => ({
          ...p,
          bars: p.bars.map((b) =>
            selected.includes(b.id) ? transformBar(b, a) : b,
          ),
          annotations: p.annotations.map((n) =>
            selected.includes(n.id) ? { ...n, points: transform(n.points) } : n,
          ),
          polylines: p.polylines.map((n) =>
            selected.includes(n.id) ? { ...n, points: transform(n.points) } : n,
          ),
        }));
      }
      if (a === 'fit') {
        if (page === 'drawing') cad.current?.fit();
        else {
          setPage('drawing');
          requestAnimationFrame(() => cad.current?.fit());
        }
      }
      if (a === 'grid') setGrid(!grid);
      if (a === 'snap') setSnap(!snap);
      if (a === 'ortho') setOrtho(!ortho);
      if (a === 'dimensions') setDimensions(!dimensions);
      if (a === 'schedule') setPage('schedule');
      if (a === 'help') setModal('help');
      if (['pdf', 'dxf', 'csv'].includes(a)) {
        const { toCsv, toDxf, toPdf } = await import('./lib/exports');
        const data = a === 'pdf' ? toPdf(p) : a === 'dxf' ? toDxf(p) : toCsv(p);
        const saved = await saveFile(
          `${safeName(p.name)}.${a}`,
          data,
          a === 'pdf'
            ? 'application/pdf'
            : a === 'csv'
              ? 'text/csv'
              : 'application/dxf',
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
    if (p.masks.length >= 20) {
      notify('O limite desta versão é de 20 máscaras por projeto.');
      return;
    }
    setBusy(`Lendo ${file.name}…`);
    try {
      const mask = await importMask(file);
      commit((p) => ({ ...p, masks: [...p.masks, mask] }));
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
      if (file.size > 100 * 1024 * 1024)
        throw new Error('Use um projeto de até 100 MB.');
      const next = decodeProject(await file.text());
      commit(() => next);
      select([]);
      setTool('select');
      setTimeout(() => cad.current?.fit(), 50);
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
            disabled={!history.past.length}
            onClick={() => action('undo')}
          >
            <Undo2 size={15} />
          </button>
          <button
            aria-label="Refazer"
            title="Refazer · Ctrl+Y"
            disabled={!history.future.length}
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
        canUndo={!!history.past.length}
        canRedo={!!history.future.length}
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
      <div className="workspace">
        <main className="main-workspace">
          <div className="document-tabs">
            <button
              className={page === 'drawing' ? 'active' : ''}
              onClick={() => setPage('drawing')}
            >
              <span className="document-icon">⌗</span> Desenho{' '}
              <span className="tab-dot" />
            </button>
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
                title="Exportar prancha PDF"
              >
                <ArrowDownToLine size={14} />
                <span>Exportar PDF</span>
              </button>
            </div>
          </div>
          {page === 'drawing' ? (
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
                ref={cad}
                project={p}
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
                className="dock-close"
                aria-label="Recolher painel lateral"
                title="Recolher painel · F4"
                onClick={() => setSidebarOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            {sidebarTab === 'project' ? (
              <ProjectTree
                project={p}
                selected={selected}
                maskId={maskId}
                onSelect={select}
                onMask={(id) => {
                  select([]);
                  setMaskId(id);
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
                  commit(() => demoProject());
                  select([]);
                  setTool('select');
                  setTimeout(() => cad.current?.fit(), 50);
                }}
              />
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
            ) : (
              <Inspector
                project={p}
                bar={chosen}
                mask={mask}
                onBar={(patch) => chosen && editBar(chosen.id, patch)}
                onMask={(patch) =>
                  commit((p) => ({
                    ...p,
                    masks: p.masks.map((m) =>
                      m.id === maskId ? { ...m, ...patch } : m,
                    ),
                  }))
                }
                onProject={(patch) => commit((p) => ({ ...p, ...patch }))}
                onRemoveDetails={() =>
                  commit((p) => ({
                    ...p,
                    details: p.details.filter((d) => d.barId !== chosen?.id),
                  }))
                }
              />
            )}
          </aside>
        )}
      </div>
      <footer className="statusbar">
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
              modal === 'new'
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
            {modal === 'split' && chosen ? (
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
                        const next = splitBar(p, chosen.id, splitAt, lap);
                        commit(() => next);
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
                    exporte DXF, prancha PDF e CSV. Escolha a escala do PDF nas
                    propriedades do projeto; o DXF preserva a geometria em mm.
                    Atualize a RA se estiver bloqueada e desatualizada.
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
