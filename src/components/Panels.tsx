import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileStack,
  Layers,
  LockKeyhole,
  Plus,
  Settings2,
  Shapes,
  Trash2,
  Unlink,
} from 'lucide-react';
import { distance, format, geometry, path, bounds } from '../domain/geometry';
import { schedule } from '../domain/model';
import type { Bar, Mask, Project } from '../domain/types';
export function NumberField({
  label,
  value,
  onChange,
  min = -1e9,
  max = 1e9,
  step = 'any',
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setText(String(value));
      return;
    }
    const n = Number(text.replace(',', '.'));
    if (
      text.trim() &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (step !== 1 || Number.isInteger(n))
    ) {
      if (n !== value) onChange(n);
    } else setText(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-suffix">
        <input
          aria-label={label}
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              cancelled.current = true;
              setText(String(value));
              e.currentTarget.blur();
            }
          }}
        />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
  maxLength = 150,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  maxLength?: number;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={label}
        maxLength={maxLength}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if ((text.trim() || allowEmpty) && text.trim() !== value)
            onChange(text.trim());
          setText(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function ShapePreview({ bar }: { bar: Bar }) {
  const g = geometry(bar),
    b = bounds(g.vertices),
    pad = Math.max(b.width, b.height) * 0.15 + 10;
  return (
    <svg
      className="shape-preview"
      viewBox={`${b.x - pad} ${-b.y - b.height - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`}
      aria-hidden="true"
    >
      <g transform="scale(1 -1)">
        <path
          d={path(g.segments)}
          fill="none"
          stroke={bar.color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
function Section({
  title,
  children,
  initial = true,
}: {
  title: string;
  children: React.ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="property-section">
      <button className="section-title" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
export function Inspector({
  bar,
  mask,
  onBar,
  onMask,
  onRemoveDetails,
  project,
  onProject,
}: {
  bar?: Bar;
  mask?: Mask;
  onBar: (patch: Partial<Bar>) => void;
  onMask: (patch: Partial<Mask>) => void;
  onRemoveDetails: () => void;
  project: Project;
  onProject: (patch: Partial<Project>) => void;
}) {
  const g = bar ? geometry(bar) : null;
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <Settings2 size={15} />
        <b>Propriedades</b>
        <span>{bar ? 'ARMADURA' : mask ? 'MÁSCARA' : 'PROJETO'}</span>
      </div>
      <div className="panel-scroll">
        {bar ? (
          <>
            <div className="object-heading">
              <span style={{ background: bar.color }}>{bar.mark}</span>
              <div>
                <b>
                  {bar.kind === 'stirrup'
                    ? 'Estribo retangular'
                    : 'Barra livre'}
                </b>
                <small>{bar.element}</small>
              </div>
            </div>
            <div className="preview-card">
              <ShapePreview bar={bar} />
              <div>
                <small>COMPRIMENTO UNITÁRIO</small>
                <strong>
                  {g!.errors.length ? 'Revisar' : format(g!.length / 1000, 3)}{' '}
                  <em>m</em>
                </strong>
              </div>
            </div>
            {!!g!.errors.length && (
              <div className="inline-warning" role="alert">
                <AlertTriangle size={15} />
                <span>{g!.errors.join(' ')}</span>
              </div>
            )}
            <Section title="Identificação">
              <TextField
                label="Posição"
                maxLength={40}
                value={bar.mark}
                onChange={(mark) => onBar({ mark })}
              />
              <TextField
                label="Elemento / grupo"
                maxLength={100}
                allowEmpty
                value={bar.element}
                onChange={(element) => onBar({ element })}
              />
              <div className="fields-2">
                <label className="field">
                  <span>Aço</span>
                  <select
                    aria-label="Aço"
                    value={bar.steel}
                    onChange={(e) =>
                      onBar({ steel: e.target.value as Bar['steel'] })
                    }
                  >
                    <option>CA-50</option>
                    <option>CA-60</option>
                  </select>
                </label>
                <label className="field">
                  <span>Bitola (mm)</span>
                  <select
                    aria-label="Bitola (mm)"
                    value={bar.diameter}
                    onChange={(e) =>
                      onBar({ diameter: Number(e.target.value) })
                    }
                  >
                    {[
                      4.2,
                      5,
                      6.3,
                      8,
                      10,
                      12.5,
                      16,
                      20,
                      22,
                      25,
                      32,
                      40,
                      ...(![
                        4.2, 5, 6.3, 8, 10, 12.5, 16, 20, 22, 25, 32, 40,
                      ].includes(bar.diameter)
                        ? [bar.diameter]
                        : []),
                    ].map((n) => (
                      <option key={n} value={n}>
                        Ø {format(n, n % 1 ? 1 : 0)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fields-2">
                <NumberField
                  label="Quantidade"
                  min={bar.distribution ? 2 : 1}
                  max={100000}
                  step={1}
                  value={bar.quantity}
                  onChange={(quantity) => onBar({ quantity })}
                />
                <label className="field">
                  <span>Cor da posição</span>
                  <input
                    type="color"
                    aria-label="Cor da posição"
                    value={bar.color}
                    onChange={(e) => onBar({ color: e.target.value })}
                  />
                </label>
              </div>
            </Section>
            <Section title="Geometria e dobras">
              {bar.kind === 'stirrup' && (
                <>
                  <div className="fields-2">
                    <NumberField
                      label="Largura no eixo"
                      value={bar.width}
                      min={1}
                      onChange={(width) => onBar({ width })}
                      suffix="mm"
                    />
                    <NumberField
                      label="Altura no eixo"
                      value={bar.height}
                      min={1}
                      onChange={(height) => onBar({ height })}
                      suffix="mm"
                    />
                  </div>
                  <NumberField
                    label="Prolongamento reto do gancho"
                    value={bar.hook}
                    min={0}
                    onChange={(hook) => onBar({ hook })}
                    suffix="mm"
                  />
                </>
              )}
              <NumberField
                label="Diâmetro interno da dobra"
                min={1}
                max={2000}
                value={bar.mandrel}
                onChange={(mandrel) => onBar({ mandrel })}
                suffix="mm"
              />
              <p className="field-help">
                Comprimento pelo eixo, descontando os trechos retos substituídos
                pelos arcos. Mandril definido pelo projetista.
              </p>
              {bar.kind === 'free' && (
                <details className="vertices-editor">
                  <summary>Vértices locais · mm</summary>
                  {bar.points.map((pt, i) => (
                    <div key={i} className="vertex-row">
                      <span>{i + 1}</span>
                      <NumberField
                        label={`X do vértice ${i + 1}`}
                        value={pt.x}
                        onChange={(x) =>
                          onBar({
                            points: bar.points.map((p, j) =>
                              j === i ? { ...p, x } : p,
                            ),
                          })
                        }
                      />
                      <NumberField
                        label={`Y do vértice ${i + 1}`}
                        value={pt.y}
                        onChange={(y) =>
                          onBar({
                            points: bar.points.map((p, j) =>
                              j === i ? { ...p, y } : p,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </details>
              )}
            </Section>
            {bar.distribution && (
              <Section title="Distribuição vinculada">
                <NumberField
                  label="Espaçamento máximo"
                  min={1}
                  value={
                    distance(bar.origin, bar.distribution.end) /
                    (bar.quantity - 1)
                  }
                  suffix="mm"
                  onChange={(s) =>
                    onBar({
                      quantity: Math.min(
                        100000,
                        Math.max(
                          2,
                          Math.ceil(
                            distance(bar.origin, bar.distribution!.end) / s,
                          ) + 1,
                        ),
                      ),
                    })
                  }
                />
                <p className="field-help">
                  Inclui as duas extremidades. Ao ajustar o espaçamento, a
                  quantidade é arredondada para cima.
                </p>
                <button
                  className="text-button"
                  onClick={() => onBar({ distribution: undefined })}
                >
                  <Unlink size={13} /> Remover distribuição
                </button>
              </Section>
            )}
            <Section title="Posicionamento" initial={false}>
              <div className="fields-2">
                <NumberField
                  label="X da origem"
                  value={bar.origin.x}
                  onChange={(x) => onBar({ origin: { ...bar.origin, x } })}
                  suffix="mm"
                />
                <NumberField
                  label="Y da origem"
                  value={bar.origin.y}
                  onChange={(y) => onBar({ origin: { ...bar.origin, y } })}
                  suffix="mm"
                />
              </div>
              <NumberField
                label="Rotação"
                value={bar.rotation}
                onChange={(rotation) => onBar({ rotation })}
                suffix="°"
              />
            </Section>
            {project.details.some((d) => d.barId === bar.id) && (
              <div className="detail-info">
                <Layers size={15} />
                <span>
                  Rebatimento vinculado à posição.
                  <button onClick={onRemoveDetails}>
                    Remover rebatimentos
                  </button>
                </span>
              </div>
            )}
          </>
        ) : mask ? (
          <>
            <div className="mask-heading">
              <FileStack size={27} />
              <b>{mask.name}</b>
              <small>
                {mask.format} · {mask.primitives.length.toLocaleString('pt-BR')}{' '}
                entidades
              </small>
            </div>
            <Section title="Referência de desenho">
              <div className="readonly-label">
                <LockKeyhole size={13} /> Máscara protegida de edição
              </div>
              <label className="field">
                <span>Opacidade · {Math.round(mask.opacity * 100)}%</span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={mask.opacity}
                  onChange={(e) => onMask({ opacity: Number(e.target.value) })}
                  aria-label="Opacidade"
                />
              </label>
              <label className="field">
                <span>Unidade de origem</span>
                <select
                  aria-label="Unidade da máscara"
                  value={mask.scale}
                  onChange={(e) => onMask({ scale: Number(e.target.value) })}
                >
                  <option value={1}>Milímetros · 1:1</option>
                  <option value={10}>Centímetros · ×10</option>
                  <option value={1000}>Metros · ×1000</option>
                  <option value={25.4}>Polegadas · ×25,4</option>
                  {![1, 10, 1000, 25.4].includes(mask.scale) && (
                    <option value={mask.scale}>
                      Personalizada · ×{mask.scale}
                    </option>
                  )}
                </select>
              </label>
              <NumberField
                label="Fator de escala"
                min={0.000001}
                max={1000000}
                value={mask.scale}
                onChange={(scale) => onMask({ scale })}
              />
              <p className="field-help">
                Unidade declarada no arquivo: {mask.sourceUnit}. Confirme com a
                ferramenta Medir.
              </p>
              <div className="fields-2">
                <NumberField
                  label="X da máscara"
                  value={mask.origin.x}
                  onChange={(x) => onMask({ origin: { ...mask.origin, x } })}
                />
                <NumberField
                  label="Y da máscara"
                  value={mask.origin.y}
                  onChange={(y) => onMask({ origin: { ...mask.origin, y } })}
                />
              </div>
              <NumberField
                label="Rotação da máscara"
                value={mask.rotation}
                onChange={(rotation) => onMask({ rotation })}
                suffix="°"
              />
            </Section>
            <Section title="Camadas">
              {Object.entries(mask.layers).map(([l, v]) => (
                <label key={l} className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={v}
                    onChange={() =>
                      onMask({ layers: { ...mask.layers, [l]: !v } })
                    }
                  />
                  <Layers size={12} />
                  <span>{l}</span>
                </label>
              ))}
            </Section>
            {!!mask.warnings.length && (
              <Section title="Relatório de importação">
                <div className="import-warnings">
                  {mask.warnings.map((w, i) => (
                    <p key={i}>
                      <AlertTriangle size={12} />
                      {w}
                    </p>
                  ))}
                </div>
              </Section>
            )}
          </>
        ) : (
          <>
            <div className="object-heading">
              <span className="neutral">
                <Shapes size={20} />
              </span>
              <div>
                <b>Dados do projeto</b>
                <small>Selecione uma armadura para editar.</small>
              </div>
            </div>
            <Section title="Projeto">
              <TextField
                label="Nome do projeto"
                value={project.name}
                onChange={(name) => onProject({ name })}
              />
              <TextField
                label="Responsável"
                allowEmpty
                value={project.author}
                onChange={(author) => onProject({ author })}
              />
            </Section>
            <div className="help-card">
              <b>Precisão desde o primeiro ponto</b>
              <p>
                Digite coordenadas na linha de comando. Use{' '}
                <code>1000,500</code> ou <code>@500,0</code> para deslocamentos
                relativos.
              </p>
              <p>
                <kbd>Enter</kbd> conclui a barra. <kbd>Esc</kbd> cancela o
                comando.
              </p>
            </div>
          </>
        )}
      </div>
      <div className="panel-foot">GEOMETRIA REAL · DADOS VINCULADOS</div>
    </aside>
  );
}
export function ProjectTree({
  project,
  selected,
  maskId,
  onSelect,
  onMask,
  onToggleMask,
  onRemoveMask,
  onImport,
  onDemo,
}: {
  project: Project;
  selected: string[];
  maskId: string | null;
  onSelect: (ids: string[]) => void;
  onMask: (id: string) => void;
  onToggleMask: (id: string) => void;
  onRemoveMask: (id: string) => void;
  onImport: () => void;
  onDemo: () => void;
}) {
  const [barsOpen, setBarsOpen] = useState(true),
    [masksOpen, setMasksOpen] = useState(true);
  const rows = schedule(project),
    valid = rows.filter((r) => !r.errors.length);
  return (
    <aside className="project-tree">
      <div className="panel-heading">
        <Layers size={15} />
        <b>Navegador do projeto</b>
      </div>
      <div className="project-caption">
        <span>PROJETO ATIVO</span>
        <b>{project.name}</b>
        <small>
          {project.bars.length} posições · {project.masks.length} referências
        </small>
      </div>
      <div className="panel-scroll">
        <button
          className="tree-section"
          onClick={() => setMasksOpen(!masksOpen)}
        >
          {masksOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <FileStack size={14} /> Máscaras <em>{project.masks.length}</em>
        </button>
        {masksOpen && (
          <>
            <div className="tree-mask-list">
              {project.masks.map((m) => (
                <div
                  key={m.id}
                  className={`mask-row ${maskId === m.id ? 'selected' : ''}`}
                >
                  <button className="mask-select" onClick={() => onMask(m.id)}>
                    <span className="file-badge">{m.format}</span>
                    <span>{m.name}</span>
                  </button>
                  <button
                    title={m.visible ? 'Ocultar máscara' : 'Mostrar máscara'}
                    aria-label={`${m.visible ? 'Ocultar' : 'Mostrar'} ${m.name}`}
                    onClick={() => onToggleMask(m.id)}
                  >
                    {m.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    title="Remover máscara"
                    aria-label={`Remover ${m.name}`}
                    onClick={() => onRemoveMask(m.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button className="import-tree" onClick={onImport}>
              <Plus size={14} /> Adicionar DXF / DWG
            </button>
          </>
        )}
        <button className="tree-section" onClick={() => setBarsOpen(!barsOpen)}>
          {barsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Shapes size={14} /> Armaduras <em>{project.bars.length}</em>
        </button>
        {barsOpen && (
          <div className="bar-list">
            {project.bars.map((b) => (
              <button
                key={b.id}
                className={`bar-row ${selected.includes(b.id) ? 'selected' : ''}`}
                onClick={() => onSelect([b.id])}
              >
                <span
                  className="bar-mark"
                  style={{ color: b.color, borderColor: `${b.color}50` }}
                >
                  {b.mark}
                </span>
                <span>
                  <b>
                    {b.kind === 'stirrup' ? 'Estribo' : 'Barra'} Ø
                    {format(b.diameter, b.diameter % 1 ? 1 : 0)}
                  </b>
                  <small>{b.element}</small>
                </span>
                <em>×{b.quantity}</em>
              </button>
            ))}
            {!project.bars.length && (
              <p className="tree-empty">Suas posições aparecerão aqui.</p>
            )}
          </div>
        )}
        <div className="tree-note">
          <LockKeyhole size={13} />
          <p>
            As máscaras ficam protegidas. As armaduras permanecem editáveis.
          </p>
        </div>
      </div>
      <div className="tree-summary">
        <span>AÇO DO PROJETO</span>
        <div>
          <strong>
            {format(
              valid.reduce((s, r) => s + r.weight, 0),
              2,
            )}
          </strong>
          <small>kg</small>
        </div>
        <footer>
          <span>{rows.reduce((s, r) => s + r.quantity, 0)} peças</span>
          <span>
            {format(
              valid.reduce((s, r) => s + r.totalLength, 0),
              2,
            )}{' '}
            m
          </span>
        </footer>
        {valid.length !== rows.length && (
          <small className="warning-text">
            Total parcial · geometria a revisar
          </small>
        )}
      </div>
      <button className="example-button" onClick={onDemo}>
        Carregar projeto de exemplo
      </button>
    </aside>
  );
}
export function Schedule({
  project,
  onSelect,
}: {
  project: Project;
  onSelect: (id: string) => void;
}) {
  const rows = schedule(project),
    valid = rows.filter((r) => !r.errors.length);
  return (
    <div className="schedule-page">
      <div className="document-intro">
        <span className="eyebrow">DOCUMENTAÇÃO / QUANTITATIVOS</span>
        <h1>
          Quadro de aço<span>Atualização automática</span>
        </h1>
        <p>
          Cada posição contabilizada uma vez. Rebatimentos compartilham os
          mesmos dados.
        </p>
      </div>
      <div className="schedule-stats">
        <div>
          <span>POSIÇÕES</span>
          <b>{rows.length.toString().padStart(2, '0')}</b>
        </div>
        <div>
          <span>COMPRIMENTO TOTAL</span>
          <b>
            {format(
              valid.reduce((s, r) => s + r.totalLength, 0),
              2,
            )}{' '}
            <small>m</small>
          </b>
        </div>
        <div>
          <span>PESO TEÓRICO</span>
          <b>
            {format(
              valid.reduce((s, r) => s + r.weight, 0),
              2,
            )}{' '}
            <small>kg</small>
          </b>
        </div>
      </div>
      {rows.some((r) => r.errors.length > 0) && (
        <div className="inline-warning">
          Quadro parcial: corrija as posições marcadas antes de exportar.
        </div>
      )}
      <div className="schedule-table-wrap">
        <table className="schedule-table">
          <thead>
            <tr>
              <th>Posição</th>
              <th>Formato</th>
              <th>Elemento</th>
              <th>Aço / Ø mm</th>
              <th>Qtd.</th>
              <th>C. unit. m</th>
              <th>C. total m</th>
              <th>Peso kg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.bar.id}
                onClick={() => onSelect(r.bar.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelect(r.bar.id);
                }}
              >
                <td>
                  <span className="position-tag" style={{ color: r.bar.color }}>
                    {r.mark}
                  </span>
                </td>
                <td>
                  <ShapePreview bar={r.bar} />
                </td>
                <td>{r.element}</td>
                <td>
                  {r.steel} / {format(r.diameter, r.diameter % 1 ? 1 : 0)}
                </td>
                <td>{r.quantity}</td>
                <td>{r.errors.length ? 'Revisar' : format(r.unitLength, 3)}</td>
                <td>{r.errors.length ? '—' : format(r.totalLength, 3)}</td>
                <td>{r.errors.length ? '—' : format(r.weight, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="schedule-empty">
            Crie a primeira armadura para gerar o quadro.
          </div>
        )}
      </div>
      <div className="schedule-notes">
        <b>Critério de levantamento</b>
        <p>
          Comprimentos pelo eixo, com arcos de dobra. Massa teórica calculada
          com 7.850 kg/m³. Perdas, emendas adicionais e otimização de corte não
          são acrescentadas automaticamente.
        </p>
        <p>
          O detalhamento utiliza os mandris e os ganchos informados pelo
          projetista.
        </p>
      </div>
    </div>
  );
}
