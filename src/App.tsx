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
} from 'lucide-react';
import Ribbon, { type Action } from './components/Ribbon';
import CadCanvas, { type CadHandle } from './components/CadCanvas';
import {
  Inspector,
  NumberField,
  ProjectTree,
  Schedule,
} from './components/Panels';
import {
  decodeProject,
  demoProject,
  emptyProject,
  newBar,
  nextMark,
} from './domain/model';
import {
  add,
  distance,
  format,
  offsetChain,
  rotate,
  sub,
  vertices,
} from './domain/geometry';
import {
  uid,
  type Bar,
  type Point,
  type Primitive,
  type Project,
  type Tool,
} from './domain/types';
import {
  autosave,
  importMask,
  pickNativeFile,
  restore,
  safeName,
  saveFile,
} from './lib/files';
type History = { past: Project[]; present: Project; future: Project[] };
const prompts: Record<Tool, string> = {
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
  const [modal, setModal] = useState<'new' | 'help' | null>(null),
    [newName, setNewName] = useState('Novo projeto'),
    [cover, setCover] = useState(30),
    [newDiameter, setNewDiameter] = useState(8);
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
  const insertBar = (b: Bar) => {
    commit((p) => ({ ...p, bars: [...p.bars, b] }));
    select([b.id]);
    setDraft([]);
    setMessage(`${b.mark} criada. Continue desenhando ou pressione Esc.`);
  };
  const finish = () => {
    if (tool === 'bar' && draft.length >= 2) {
      const origin = draft[0];
      insertBar({
        ...newBar(nextMark(p)),
        diameter: newDiameter,
        mandrel: newDiameter * 5,
        origin,
        points: draft.map((v) => sub(v, origin)),
      });
    } else setDraft([]);
  };
  const onPoint = (point: Point) => {
    if (tool === 'bar') {
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
    if (!chosen) return;
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
    if (tool === 'move' || tool === 'copy') {
      if (!draft.length) {
        setDraft([point]);
        return;
      }
      const delta = sub(point, draft[0]);
      if (tool === 'move')
        commit((p) => ({
          ...p,
          bars: p.bars.map((b) =>
            selected.includes(b.id)
              ? {
                  ...b,
                  origin: add(b.origin, delta),
                  distribution: b.distribution
                    ? { end: add(b.distribution.end, delta) }
                    : undefined,
                }
              : b,
          ),
        }));
      else {
        const copies: Bar[] = [];
        let temp = { ...p };
        for (const b of p.bars.filter((b) => selected.includes(b.id))) {
          const copy = {
            ...b,
            id: uid(),
            mark: nextMark(temp),
            origin: add(b.origin, delta),
            distribution: b.distribution
              ? { end: add(b.distribution.end, delta) }
              : undefined,
          };
          copies.push(copy);
          temp = { ...temp, bars: [...temp.bars, copy] };
        }
        commit((p) => ({ ...p, bars: [...p.bars, ...copies] }));
        select(copies.map((b) => b.id));
      }
      setTool('select');
    }
  };
  const follow = (primitive: Primitive) => {
    try {
      const points = offsetChain(
        primitive.points,
        cover + newDiameter / 2,
        !!primitive.closed,
      );
      const origin = points[0];
      if (points.length > 500)
        throw new Error(
          'Use um contorno com até 500 vértices para criar a armadura.',
        );
      insertBar({
        ...newBar(nextMark(p)),
        origin,
        diameter: newDiameter,
        mandrel: newDiameter * 5,
        points: points.map((v) => sub(v, origin)),
      });
      notify(
        'Barra criada a partir da fôrma. Confira as dobras e defina as terminações.',
      );
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const action = async (a: Action) => {
    if (tools.includes(a as Tool)) {
      setTool(a as Tool);
      return;
    }
    try {
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
        }));
        select([]);
      }
      if (a === 'rotate')
        commit((p) => ({
          ...p,
          bars: p.bars.map((b) =>
            selected.includes(b.id)
              ? {
                  ...b,
                  rotation: (b.rotation + 90) % 360,
                  distribution: b.distribution
                    ? {
                        end: add(
                          b.origin,
                          rotate(sub(b.distribution.end, b.origin), 90),
                        ),
                      }
                    : undefined,
                }
              : b,
          ),
        }));
      if (a === 'mirror')
        commit((p) => ({
          ...p,
          bars: p.bars.map((b) =>
            selected.includes(b.id)
              ? {
                  ...b,
                  kind: 'free',
                  points: vertices(b).map((v) => ({ x: -v.x, y: v.y })),
                }
              : b,
          ),
        }));
      if (a === 'fit') {
        setPage('drawing');
        setTimeout(() => cad.current?.fit(), 0);
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
      PL: 'bar',
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
      'Comando desconhecido. Use B, E, M, C, R, F, DIST ou coordenadas X,Y.',
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
    <div className="app-shell">
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
          <span className="app-monogram">
            A<span />
          </span>
          <strong>
            Armadura<span>Struct</span>
          </strong>
          <span className="version-badge">0.1</span>
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
        active={{ [tool]: true, grid, snap, ortho, dimensions }}
        selected={!!chosen}
        canUndo={!!history.past.length}
        canRedo={!!history.future.length}
      />
      <div className="workspace">
        <ProjectTree
          project={p}
          selected={selected}
          maskId={maskId}
          onSelect={select}
          onMask={(id) => {
            select([]);
            setMaskId(id);
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
              <div className="context-bar">
                <span className="command-mode">
                  {tool === 'select'
                    ? 'SELEÇÃO'
                    : tool === 'bar'
                      ? 'BARRA LIVRE'
                      : tool === 'stirrup'
                        ? 'ESTRIBO'
                        : tool.toUpperCase()}
                </span>
                <span>
                  {selected.length
                    ? `${selected.length} posição selecionada`
                    : 'Clique ou desenhe uma janela para selecionar'}
                </span>
                {['bar', 'stirrup', 'follow'].includes(tool) && (
                  <label>
                    Ø{' '}
                    <select
                      aria-label="Bitola de criação"
                      value={newDiameter}
                      onChange={(e) => setNewDiameter(Number(e.target.value))}
                    >
                      {[5, 6.3, 8, 10, 12.5, 16, 20, 25, 32].map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>{' '}
                    mm
                  </label>
                )}
                {tool === 'follow' && (
                  <div className="cover-field">
                    <NumberField
                      label="Cobrimento"
                      value={cover}
                      min={0}
                      onChange={setCover}
                      suffix="mm"
                    />
                  </div>
                )}
                <span className="context-right">
                  {snap ? 'OSNAP ATIVO' : 'OSNAP DESLIGADO'}
                </span>
              </div>
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
            <Schedule project={p} onSelect={(id) => select([id])} />
          )}
        </main>
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
        <span className="version-footer">OpenStruct · 0.1.0</span>
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
            aria-label={modal === 'new' ? 'Novo projeto' : 'Guia de uso'}
          >
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === 'new' ? (
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
                    <b>03 · Detalhe e distribua</b>Selecione uma barra. R cria
                    seu rebatimento; D define uma distribuição. As propriedades
                    atualizam o quadro automaticamente.
                  </p>
                  <p>
                    <b>04 · Entregue o desenho</b>Salve o projeto completo e
                    exporte DXF, prancha PDF e CSV. O PDF ajusta a vista à
                    folha; o DXF preserva a escala real em mm.
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
