import { useEffect, useRef, useState } from 'react';
import type { DrawingLayer } from '../domain/types';
import {
  WELDED_MESH_CATALOG,
  catalogWeldedMesh,
  customWeldedMesh,
  formatSteelArea,
  weldedMeshCriteriaIssues,
  weldedMeshLabel,
  type WeldedMeshCriteria,
  type WeldedMeshDefinition,
  type WeldedMeshDirection,
} from '../domain/weldedMesh';

/**
 * Critérios dos próximos lançamentos de telas soldadas.
 *
 * Unidades: os comprimentos dos critérios (afastamentos e sobreposições) são
 * digitados em mm, como na janela do estribo. As propriedades da tela seguem a
 * tabela de referência: Ø em mm, espaçamento em cm, As em cm²/m, painel em m,
 * kg/m² e kg/painel; o domínio guarda tudo em mm, mm²/m e kg.
 * Um modelo do catálogo é só leitura; editar exige escolher explicitamente a
 * configuração personalizada, que fica identificada como tal.
 */
const NEW_CUSTOM = '__new-custom',
  CUSTOM = '__custom';
const STARTS: [WeldedMeshCriteria['start'], string][] = [
  ['bottom-left', 'Inferior esquerdo'],
  ['bottom-right', 'Inferior direito'],
  ['top-left', 'Superior esquerdo'],
  ['top-right', 'Superior direito'],
];
const TABS = ['Tela', 'Paginação', 'Representação'] as const;

const fmt = (v: number, digits: number) =>
  Number.isFinite(v)
    ? v.toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      })
    : '—';
/** Converte sem resíduo de ponto flutuante (2,45 m → 2450 mm). */
const scaled = (v: number, factor: number) => Number((v * factor).toFixed(6));
const wires = (d: WeldedMeshDirection) =>
  `Ø${fmt(d.diameter, 1)} c/${fmt(d.spacing / 10, d.spacing % 10 ? 1 : 0)}`;

export default function WeldedMeshCriteriaDialog({
  initial,
  layers,
  onAccept,
  onClose,
}: {
  initial: WeldedMeshCriteria;
  layers: DrawingLayer[];
  onAccept: (c: WeldedMeshCriteria) => void;
  onClose: () => void;
}) {
  const [c, set] = useState(() => structuredClone(initial)),
    [tab, setTab] = useState<(typeof TABS)[number]>('Tela');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>('select,input')?.focus();
    return () => {
      dialog.current?.close();
      if (old?.isConnected) old.focus();
    };
  }, []);
  const change = (patch: Partial<WeldedMeshCriteria>) =>
    set((v) => ({ ...v, ...patch }));
  const mesh = (patch: Partial<WeldedMeshDefinition>) =>
    set((v) => ({ ...v, mesh: { ...v.mesh, ...patch } }));
  const direction = (
    key: 'longitudinal' | 'transverse',
    patch: Partial<WeldedMeshDirection>,
  ) =>
    set((v) => ({
      ...v,
      mesh: { ...v.mesh, [key]: { ...v.mesh[key], ...patch } },
    }));
  const issues = weldedMeshCriteriaIssues(c);
  const custom = c.mesh.source === 'custom';
  const pickModel = (value: string) => {
    if (value === CUSTOM) return;
    if (value === NEW_CUSTOM) {
      change({ mesh: customWeldedMesh(c.mesh, {}) });
      return;
    }
    const m = catalogWeldedMesh(value);
    if (m) change({ mesh: m });
  };
  /** Campo numérico; vazio vira NaN e aparece nos problemas, sem lançar. */
  const num = (
    label: string,
    value: number,
    fn: (v: number) => void,
    min: number | undefined = 0,
  ) => (
    <label className="field">
      {label}
      <input
        type="number"
        step="any"
        min={min}
        required
        aria-label={label}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) =>
          fn(e.target.value === '' ? NaN : Number(e.target.value))
        }
      />
    </label>
  );
  const property = (
    label: string,
    key: 'longitudinal' | 'transverse',
    field: keyof WeldedMeshDirection,
  ) => {
    const d = c.mesh[key];
    const shown =
      field === 'spacing'
        ? d.spacing / 10
        : field === 'steelArea'
          ? d.steelArea / 100
          : d.diameter;
    if (!custom)
      return field === 'steelArea'
        ? formatSteelArea(d.steelArea)
        : field === 'spacing'
          ? `${fmt(shown, d.spacing % 10 ? 1 : 0)} cm`
          : `${fmt(shown, 1)} mm`;
    const factor = field === 'spacing' ? 10 : field === 'steelArea' ? 100 : 1;
    return (
      <input
        type="number"
        step="any"
        min={0}
        required
        aria-label={label}
        value={Number.isNaN(shown) ? '' : shown}
        onChange={(e) =>
          direction(key, {
            [field]:
              e.target.value === ''
                ? NaN
                : scaled(Number(e.target.value), factor),
          })
        }
      />
    );
  };
  const rows: [string, keyof WeldedMeshDirection, string][] = [
    ['Bitola', 'diameter', 'mm'],
    ['Espaçamento', 'spacing', 'cm'],
    ['Área de aço', 'steelArea', 'cm²/m'],
  ];
  return (
    <dialog
      ref={dialog}
      className="modal stirrup-dialog welded-mesh-dialog"
      aria-labelledby="welded-mesh-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!issues.length) onAccept({ ...c, mark: c.mark.trim() });
        }}
      >
        <div className="panel-heading">
          <b id="welded-mesh-title">Critérios de telas soldadas</b>
          <button
            type="button"
            aria-label="Fechar critérios de telas soldadas"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <nav className="stirrup-tabs" aria-label="Etapas dos critérios">
          {TABS.map((t) => (
            <button
              type="button"
              key={t}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="stirrup-dialog-body">
          <div>
            {tab === 'Tela' && (
              <>
                <label className="field">
                  Modelo
                  <select
                    aria-label="Modelo de tela"
                    value={custom ? CUSTOM : c.mesh.designation}
                    onChange={(e) => pickModel(e.target.value)}
                  >
                    {WELDED_MESH_CATALOG.map((m) => (
                      <option key={m.id} value={m.designation}>
                        {m.designation} — {wires(m.longitudinal)} ·{' '}
                        {formatSteelArea(m.longitudinal.steelArea)}
                      </option>
                    ))}
                    {custom ? (
                      <option value={CUSTOM}>{weldedMeshLabel(c.mesh)}</option>
                    ) : (
                      <option value={NEW_CUSTOM}>
                        Personalizada (a partir de {c.mesh.designation})
                      </option>
                    )}
                  </select>
                </label>
                {custom && (
                  <div className="fields-2">
                    <label className="field">
                      Designação
                      <input
                        aria-label="Designação da tela personalizada"
                        value={c.mesh.designation}
                        maxLength={40}
                        onChange={(e) => mesh({ designation: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Aço
                      <select
                        aria-label="Categoria do aço"
                        value={c.mesh.steel}
                        onChange={(e) =>
                          mesh({
                            steel: e.target
                              .value as WeldedMeshDefinition['steel'],
                          })
                        }
                      >
                        <option value="CA-60">CA-60</option>
                        <option value="CA-50">CA-50</option>
                      </select>
                    </label>
                  </div>
                )}
                <table
                  className="welded-mesh-properties"
                  aria-label="Propriedades da tela por direção"
                >
                  <thead>
                    <tr>
                      <th scope="col">Propriedade</th>
                      <th scope="col">Longitudinal</th>
                      <th scope="col">Transversal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, field, unit]) => (
                      <tr key={field}>
                        <th scope="row">
                          {label} ({unit})
                        </th>
                        <td>
                          {property(
                            `${label} longitudinal (${unit})`,
                            'longitudinal',
                            field,
                          )}
                        </td>
                        <td>
                          {property(
                            `${label} transversal (${unit})`,
                            'transverse',
                            field,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {custom ? (
                  <>
                    <div className="fields-2">
                      {num(
                        'Comprimento do painel (m)',
                        c.mesh.length / 1000,
                        (v) => mesh({ length: scaled(v, 1000) }),
                      )}
                      {num('Largura do painel (m)', c.mesh.width / 1000, (v) =>
                        mesh({ width: scaled(v, 1000) }),
                      )}
                    </div>
                    <div className="fields-2">
                      {num('Massa por área (kg/m²)', c.mesh.massPerArea, (v) =>
                        mesh({ massPerArea: v }),
                      )}
                      {num('Massa por painel (kg)', c.mesh.massPerPanel, (v) =>
                        mesh({ massPerPanel: v }),
                      )}
                    </div>
                  </>
                ) : (
                  <p className="welded-mesh-panel" aria-label="Painel">
                    Painel {fmt(c.mesh.length / 1000, 2)} m (comprimento,
                    longitudinal) × {fmt(c.mesh.width / 1000, 2)} m (largura) ·{' '}
                    {c.mesh.steel} · {fmt(c.mesh.massPerArea, 2)} kg/m² ·{' '}
                    {fmt(c.mesh.massPerPanel, 1)} kg/painel
                  </p>
                )}
                <p className="field-help">
                  {custom
                    ? 'Configuração personalizada: os valores são do projetista e não se apresentam como modelo do catálogo.'
                    : 'Modelo do catálogo, somente leitura. Para editar valores, escolha a opção personalizada.'}
                </p>
              </>
            )}
            {tab === 'Paginação' && (
              <>
                <div className="fields-2">
                  {num(
                    'Orientação (graus)',
                    c.orientation,
                    (v) => change({ orientation: v }),
                    undefined,
                  )}
                  <label className="field">
                    Início da paginação
                    <select
                      aria-label="Início da paginação"
                      value={c.start}
                      onChange={(e) =>
                        change({
                          start: e.target.value as WeldedMeshCriteria['start'],
                        })
                      }
                    >
                      {STARTS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="field-help">
                  Orientação: direção dos fios longitudinais em relação ao eixo
                  X, no sentido anti-horário. Canto de início no referencial da
                  tela: esquerda e direita ao longo do comprimento, inferior e
                  superior ao longo da largura.
                </p>
                <fieldset>
                  <legend>Afastamento em planta (não é cobrimento)</legend>
                  <div className="fields-2">
                    {num('Afastamento do contorno (mm)', c.edgeOffset, (v) =>
                      change({ edgeOffset: v }),
                    )}
                    {num(
                      'Afastamento das aberturas (mm)',
                      c.openingOffset,
                      (v) => change({ openingOffset: v }),
                    )}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Sobreposição entre painéis</legend>
                  <div className="fields-2">
                    {num(
                      'Sobreposição no comprimento (mm)',
                      c.lengthOverlap,
                      (v) => change({ lengthOverlap: v }),
                    )}
                    {num('Sobreposição na largura (mm)', c.widthOverlap, (v) =>
                      change({ widthOverlap: v }),
                    )}
                  </div>
                  <p className="field-help">
                    Informada pelo projetista. Não é um comprimento de traspasse
                    normativo.
                  </p>
                </fieldset>
              </>
            )}
            {tab === 'Representação' && (
              <>
                <div className="fields-2">
                  <label className="field">
                    Posição
                    <input
                      aria-label="Posição"
                      value={c.mark}
                      maxLength={20}
                      onChange={(e) => change({ mark: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Layer
                    <select
                      aria-label="Layer das telas"
                      value={c.layerId ?? ''}
                      onChange={(e) =>
                        change({ layerId: e.target.value || undefined })
                      }
                    >
                      <option value="">Pelo papel (ARMADURAS)</option>
                      {layers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend>Apresentação</legend>
                  {(
                    [
                      ['panels', 'Contorno das peças'],
                      ['wires', 'Malha nominal (fios)'],
                      ['identification', 'Identificação'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="check" key={key}>
                      <input
                        type="checkbox"
                        checked={c.display[key]}
                        onChange={(e) =>
                          change({
                            display: { ...c.display, [key]: e.target.checked },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
          </div>
          <MeshPreview c={c} />
        </div>
        {issues.length > 0 && (
          <ul className="stirrup-error welded-mesh-issues" role="alert">
            {issues.slice(0, 4).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <p className="field-help stirrup-criteria-note">
          Critérios para os próximos lançamentos. Serão salvos com o projeto ao
          confirmar um lançamento. Telas já lançadas não mudam.
        </p>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary"
            type="submit"
            disabled={issues.length > 0}
          >
            Usar critérios
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/**
 * Esquema de 2 × 2 painéis no referencial da tela, girado pela orientação.
 * Os painéis são translúcidos: onde dois se sobrepõem, a cor fica mais forte.
 */
function MeshPreview({ c }: { c: WeldedMeshCriteria }) {
  const m = c.mesh;
  const ok =
    [m.length, m.width, c.lengthOverlap, c.widthOverlap].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) &&
    m.width > 0 &&
    c.lengthOverlap < m.length &&
    c.widthOverlap < m.width;
  // Valores inválidos (ainda sendo digitados): desenha um painel de referência.
  const L = ok ? m.length : 6000,
    W = ok ? m.width : 2450;
  const a =
    ((Number.isFinite(c.orientation) ? c.orientation : 0) * Math.PI) / 180;
  const su = ok ? L - c.lengthOverlap : L,
    sv = ok ? W - c.widthOverlap : W;
  const U = L + su,
    V = W + sv;
  // Modelo (y para cima) → SVG (y para baixo).
  const at = (u: number, v: number) => ({
    x: u * Math.cos(a) - v * Math.sin(a),
    y: -(u * Math.sin(a) + v * Math.cos(a)),
  });
  const right = c.start.endsWith('right'),
    top = c.start.startsWith('top');
  const panels = [0, 1].flatMap((i) =>
    [0, 1].map((j) => {
      // A grade cresce a partir do canto de início.
      const u0 = right ? U - L - i * su : i * su,
        v0 = top ? V - W - j * sv : j * sv;
      return {
        n: j * 2 + i + 1,
        corners: [
          at(u0, v0),
          at(u0 + L, v0),
          at(u0 + L, v0 + W),
          at(u0, v0 + W),
        ],
        center: at(u0 + L / 2, v0 + W / 2),
      };
    }),
  );
  const all = panels.flatMap((p) => p.corners);
  const xs = all.map((p) => p.x),
    ys = all.map((p) => p.y);
  const size = Math.max(...xs) - Math.min(...xs),
    margin = Math.max(size, Math.max(...ys) - Math.min(...ys)) * 0.08 + 1;
  const stroke = Math.max(U, V) / 150;
  const start = at(right ? U : 0, top ? V : 0);
  const arrowFrom = at(U * 0.15, -V * 0.08),
    arrowTo = at(U * 0.55, -V * 0.08);
  return (
    <aside
      className="stirrup-shape-preview welded-mesh-preview"
      aria-label="Prévia dos critérios"
    >
      <svg
        role="img"
        aria-label="Paginação de 2 × 2 painéis"
        viewBox={`${Math.min(...xs) - margin} ${Math.min(...ys) - margin} ${size + margin * 2} ${Math.max(...ys) - Math.min(...ys) + margin * 2}`}
      >
        <defs>
          <marker
            id="welded-mesh-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {panels.map((p) => (
          <g key={p.n}>
            <polygon
              points={p.corners.map((q) => `${q.x},${q.y}`).join(' ')}
              fill="currentColor"
              fillOpacity={0.14}
              stroke="currentColor"
              strokeWidth={stroke}
            />
            <text
              x={p.center.x}
              y={p.center.y}
              fontSize={Math.min(L, W) * 0.3}
              textAnchor="middle"
              dominantBaseline="central"
              fill="currentColor"
            >
              {p.n}
            </text>
          </g>
        ))}
        <line
          x1={arrowFrom.x}
          y1={arrowFrom.y}
          x2={arrowTo.x}
          y2={arrowTo.y}
          stroke="currentColor"
          strokeWidth={stroke}
          markerEnd="url(#welded-mesh-arrow)"
        />
        <circle cx={start.x} cy={start.y} r={stroke * 4} fill="currentColor" />
      </svg>
      <b>{weldedMeshLabel(c.mesh)}</b>
      <span>
        Longitudinal {wires(c.mesh.longitudinal)} ·{' '}
        {formatSteelArea(c.mesh.longitudinal.steelArea)}
      </span>
      <span>
        Transversal {wires(c.mesh.transverse)} ·{' '}
        {formatSteelArea(c.mesh.transverse.steelArea)}
      </span>
      {ok ? (
        <span>
          Passo da grade: {fmt(su / 1000, 2)} × {fmt(sv / 1000, 2)} m
        </span>
      ) : (
        <span>Prévia ilustrativa: corrija as dimensões e sobreposições.</span>
      )}
      <small>
        Seta: direção longitudinal. Ponto: canto de início, painel 1. Faixas
        mais escuras: sobreposição. Valores definidos pelo projetista; a prévia
        não dimensiona a tela.
      </small>
    </aside>
  );
}
