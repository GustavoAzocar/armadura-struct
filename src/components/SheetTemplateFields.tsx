import { useId, useState } from 'react';
import type { PaperPrimitive, PaperRect } from '../domain/paper';
import type {
  SheetTemplate,
  SheetTemplateField,
} from '../domain/sheetTemplates';
import { LINE_TYPES } from '../domain/layers';
import { sheetSize } from '../domain/paperFormat';
import { DEFAULT_TEXT_FONT } from '../domain/textStyle';
import {
  uid,
  type DrawingStyle,
  type Point,
  type Sheet,
} from '../domain/types';

export function DraftNumber({
  label,
  value,
  onChange,
  unit = 'mm',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <label className="template-field">
      <span>{label}</span>
      <span className="input-suffix">
        <input
          value={
            draft ??
            (Number.isFinite(value) ? String(value).replace('.', ',') : '')
          }
          inputMode="decimal"
          aria-label={label}
          aria-invalid={!Number.isFinite(value)}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            onChange(text.trim() ? Number(text.replace(',', '.')) : NaN);
          }}
          onBlur={() => setDraft(undefined)}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

export function PointFields({
  label,
  value,
  onChange,
  unit = 'mm',
}: {
  label: string;
  value: Point;
  onChange: (point: Point) => void;
  unit?: string;
}) {
  return (
    <div className="template-fields">
      <DraftNumber
        label={`${label} X`}
        value={value.x}
        unit={unit}
        onChange={(x) => onChange({ ...value, x })}
      />
      <DraftNumber
        label={`${label} Y`}
        value={value.y}
        unit={unit}
        onChange={(y) => onChange({ ...value, y })}
      />
    </div>
  );
}

export function RectFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PaperRect;
  onChange: (rect: PaperRect) => void;
}) {
  return (
    <div className="template-fields">
      {(['x', 'y', 'width', 'height'] as const).map((key, i) => (
        <DraftNumber
          key={key}
          label={`${label} · ${['X', 'Y', 'largura', 'altura'][i]}`}
          value={value[key]}
          onChange={(number) => onChange({ ...value, [key]: number })}
        />
      ))}
    </div>
  );
}

export function TemplatePaperFields({
  template,
  setTemplate,
  onChooseArea,
}: {
  template: SheetTemplate;
  setTemplate: (next: SheetTemplate) => void;
  onChooseArea: () => void;
}) {
  const change = (patch: Partial<SheetTemplate>) =>
    setTemplate({ ...template, ...patch });
  const size = sheetSize(template);
  return (
    <>
      <fieldset>
        <legend>Papel</legend>
        <div className="template-fields">
          <label className="template-field">
            <span>Formato</span>
            <select
              value={template.format}
              onChange={(event) =>
                change({ format: event.target.value as Sheet['format'] })
              }
            >
              {['A0', 'A1', 'A2', 'A3', 'A4', 'custom'].map((format) => (
                <option key={format} value={format}>
                  {format === 'custom' ? 'Personalizado' : format}
                </option>
              ))}
            </select>
          </label>
          <label className="template-field">
            <span>Orientação</span>
            <select
              value={template.orientation}
              onChange={(event) =>
                change({
                  orientation: event.target.value as Sheet['orientation'],
                })
              }
            >
              <option value="portrait">Retrato</option>
              <option value="landscape">Paisagem</option>
            </select>
          </label>
          {template.format === 'custom' && (
            <>
              <DraftNumber
                label="Lado A do papel"
                value={template.customSize.width}
                onChange={(width) =>
                  change({ customSize: { ...template.customSize, width } })
                }
              />
              <DraftNumber
                label="Lado B do papel"
                value={template.customSize.height}
                onChange={(height) =>
                  change({ customSize: { ...template.customSize, height } })
                }
              />
            </>
          )}
        </div>
        <p className="template-hint">
          {Number.isFinite(size.width) && Number.isFinite(size.height)
            ? `${size.width} × ${size.height} mm. Origem no canto inferior esquerdo.`
            : 'Informe as duas dimensões do papel.'}
        </p>
      </fieldset>
      <fieldset>
        <legend>Área útil</legend>
        <RectFields
          label="Área útil"
          value={template.useful}
          onChange={(useful) => change({ useful })}
        />
        <button type="button" onClick={onChooseArea}>
          Marcar área útil por dois pontos
        </button>
      </fieldset>
      <fieldset>
        <legend>Selo</legend>
        <label className="template-check">
          <input
            type="checkbox"
            checked={!!template.seal}
            onChange={(event) => {
              const { x, y, width, height } = template.useful;
              const sealWidth = Math.min(width / 2, 160);
              change({
                seal: event.target.checked
                  ? {
                      x: x + width - sealWidth,
                      y,
                      width: sealWidth,
                      height: Math.min(height / 3, 40),
                    }
                  : undefined,
              });
            }}
          />{' '}
          Reservar espaço para o selo
        </label>
        {template.seal && (
          <RectFields
            label="Reserva do selo"
            value={template.seal}
            onChange={(seal) => change({ seal })}
          />
        )}
      </fieldset>
    </>
  );
}

const drawnStyle: DrawingStyle = {
  color: '#263044',
  fill: 'none',
  fillColor: '#263044',
  lineWidth: 0.25,
  lineScale: 1,
  lineType: LINE_TYPES[0],
};

function VertexEditor({
  line,
  onChange,
}: {
  line: PaperPrimitive;
  onChange: (line: PaperPrimitive) => void;
}) {
  const style = line.resolvedStyle ?? drawnStyle;
  return (
    <>
      <div className="template-fields">
        <label className="template-field">
          <span>Cor</span>
          <input
            type="color"
            value={style.color}
            onChange={(event) =>
              onChange({
                ...line,
                resolvedStyle: { ...style, color: event.target.value },
              })
            }
          />
        </label>
        <DraftNumber
          label="Espessura da linha"
          value={style.lineWidth}
          onChange={(lineWidth) =>
            onChange({ ...line, resolvedStyle: { ...style, lineWidth } })
          }
        />
        <label className="template-field">
          <span>Tipo de linha</span>
          <select
            value={style.lineType.name}
            onChange={(event) => {
              const lineType = LINE_TYPES.find(
                (kind) => kind.name === event.target.value,
              );
              if (lineType)
                onChange({ ...line, resolvedStyle: { ...style, lineType } });
            }}
          >
            {!LINE_TYPES.some((kind) => kind.name === style.lineType.name) && (
              <option>{style.lineType.name}</option>
            )}
            {LINE_TYPES.map((kind, i) => (
              <option key={kind.name} value={kind.name}>
                {['Contínua', 'Tracejada', 'Pontilhada', 'Traço e ponto'][i]}
              </option>
            ))}
          </select>
        </label>
        <label className="template-check">
          <input
            type="checkbox"
            checked={!!line.closed}
            onChange={(event) =>
              onChange({ ...line, closed: event.target.checked })
            }
          />{' '}
          Contorno fechado
        </label>
      </div>
      <div className="template-vertices">
        {line.points.map((point, index) => (
          <div className="template-vertex" key={index}>
            <PointFields
              label={`Vértice ${index + 1}`}
              value={point}
              onChange={(next) =>
                onChange({
                  ...line,
                  points: line.points.map((value, i) =>
                    i === index ? next : value,
                  ),
                })
              }
            />
            <button
              type="button"
              disabled={line.points.length <= (line.closed ? 3 : 2)}
              onClick={() =>
                onChange({
                  ...line,
                  points: line.points.filter((_, i) => i !== index),
                })
              }
            >
              Remover vértice {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const last = line.points.at(-1) ?? { x: 0, y: 0 };
            onChange({
              ...line,
              points: [...line.points, { x: last.x + 10, y: last.y }],
            });
          }}
        >
          Adicionar vértice
        </button>
      </div>
    </>
  );
}

function FieldEditor({
  field,
  onChange,
}: {
  field: SheetTemplateField;
  onChange: (field: SheetTemplateField) => void;
}) {
  const change = (patch: Partial<SheetTemplateField>) =>
    onChange({ ...field, ...patch });
  return (
    <>
      <label className="template-field">
        <span>Nome do campo</span>
        <input
          value={field.label}
          maxLength={100}
          onChange={(event) => change({ label: event.target.value })}
        />
      </label>
      <label className="template-field">
        <span>Texto estático</span>
        <input
          value={field.text}
          maxLength={500}
          onChange={(event) => change({ text: event.target.value })}
        />
      </label>
      <RectFields
        label="Caixa de texto"
        value={field.box}
        onChange={(box) => change({ box })}
      />
      <PointFields
        label="Inserção do texto"
        value={field.origin}
        onChange={(origin) => change({ origin })}
      />
      <div className="template-fields">
        <label className="template-field">
          <span>Fonte</span>
          <select
            value={field.font}
            onChange={(event) =>
              change({ font: event.target.value as SheetTemplateField['font'] })
            }
          >
            <option value="helvetica">Helvetica</option>
            <option value="times">Times</option>
            <option value="courier">Courier</option>
          </select>
        </label>
        <label className="template-field">
          <span>Alinhamento</span>
          <select
            value={field.align}
            onChange={(event) =>
              change({
                align: event.target.value as SheetTemplateField['align'],
              })
            }
          >
            <option value="left">Esquerda</option>
            <option value="center">Centro</option>
            <option value="right">Direita</option>
          </select>
        </label>
        <DraftNumber
          label="Altura do texto"
          value={field.height}
          onChange={(height) => change({ height })}
        />
        <DraftNumber
          label="Rotação do texto"
          value={field.rotation}
          unit="°"
          onChange={(rotation) => change({ rotation })}
        />
      </div>
    </>
  );
}

export function TemplateArtworkFields({
  template,
  setTemplate,
}: {
  template: SheetTemplate;
  setTemplate: (next: SheetTemplate) => void;
}) {
  const [shapeIndex, setShapeIndex] = useState(0);
  const [fieldId, setFieldId] = useState('');
  const heading = useId();
  const line = template.geometry[shapeIndex];
  const field =
    template.fields.find(({ id }) => id === fieldId) ?? template.fields[0];
  const lineChanges = (next: PaperPrimitive) =>
    setTemplate({
      ...template,
      geometry: template.geometry.map((item, i) =>
        i === shapeIndex ? next : item,
      ),
    });
  const fieldChanges = (next: SheetTemplateField) =>
    setTemplate({
      ...template,
      fields: template.fields.map((item) =>
        item.id === next.id ? next : item,
      ),
    });
  return (
    <>
      <fieldset>
        <legend>Traços e contornos</legend>
        <button
          type="button"
          onClick={() => {
            const { x, y, width } = template.useful;
            setShapeIndex(template.geometry.length);
            setTemplate({
              ...template,
              geometry: [
                ...template.geometry,
                {
                  layer: 'MARGEM',
                  points: [
                    { x, y },
                    { x: x + Math.min(width, 25), y },
                  ],
                  resolvedStyle: drawnStyle,
                },
              ],
            });
          }}
        >
          Adicionar linha
        </button>
        {template.geometry.length > 0 && (
          <>
            <label className="template-field">
              <span>Elemento gráfico</span>
              <select
                value={line ? shapeIndex : ''}
                onChange={(event) => setShapeIndex(Number(event.target.value))}
              >
                {!line && <option value="">Escolha um elemento</option>}
                {template.geometry.map((item, index) => (
                  <option key={index} value={index}>
                    {item.text !== undefined
                      ? `Texto ${index + 1} · ${item.text.slice(0, 42)}`
                      : `${item.closed ? 'Contorno' : 'Linha'} ${index + 1} · ${item.layer}`}
                  </option>
                ))}
              </select>
            </label>
            {line && (
              <>
                {line.text !== undefined ? (
                  <>
                    <label className="template-field">
                      <span>Texto importado</span>
                      <input
                        value={line.text}
                        maxLength={500}
                        onChange={(event) =>
                          lineChanges({ ...line, text: event.target.value })
                        }
                      />
                    </label>
                    <PointFields
                      label="Inserção do texto importado"
                      value={line.points[0]}
                      onChange={(point) =>
                        lineChanges({ ...line, points: [point] })
                      }
                    />
                    <DraftNumber
                      label="Altura do texto importado"
                      value={line.textHeight ?? 2.5}
                      onChange={(textHeight) =>
                        lineChanges({ ...line, textHeight })
                      }
                    />
                    <div className="template-fields">
                      <label className="template-field">
                        <span>Fonte do texto importado</span>
                        <select
                          value={line.textFont?.family ?? 'sans'}
                          onChange={(event) =>
                            lineChanges({
                              ...line,
                              textFont: {
                                ...(line.textFont ?? DEFAULT_TEXT_FONT),
                                family: event.target.value,
                              },
                            })
                          }
                        >
                          <option value="sans">Helvetica</option>
                          <option value="serif">Times</option>
                          <option value="mono">Courier</option>
                        </select>
                      </label>
                      <label className="template-field">
                        <span>Alinhamento do texto importado</span>
                        <select
                          value={line.textAlign ?? 'left'}
                          onChange={(event) =>
                            lineChanges({
                              ...line,
                              textAlign: event.target.value as
                                | 'left'
                                | 'center'
                                | 'right',
                            })
                          }
                        >
                          <option value="left">Esquerda</option>
                          <option value="center">Centro</option>
                          <option value="right">Direita</option>
                        </select>
                      </label>
                      <DraftNumber
                        label="Rotação do texto importado"
                        value={line.textRotation ?? 0}
                        unit="°"
                        onChange={(textRotation) =>
                          lineChanges({ ...line, textRotation })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <VertexEditor line={line} onChange={lineChanges} />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShapeIndex(Math.max(0, shapeIndex - 1));
                    setTemplate({
                      ...template,
                      geometry: template.geometry.filter(
                        (_, index) => index !== shapeIndex,
                      ),
                    });
                  }}
                >
                  Remover elemento gráfico
                </button>
              </>
            )}
          </>
        )}
      </fieldset>
      <fieldset aria-labelledby={heading}>
        <legend id={heading}>Caixas e textos estáticos</legend>
        <button
          type="button"
          onClick={() => {
            const area = template.seal ?? template.useful;
            const width = Math.min(60, area.width),
              height = Math.min(12, area.height);
            const id = uid();
            setFieldId(id);
            setTemplate({
              ...template,
              fields: [
                ...template.fields,
                {
                  id,
                  label: `Campo ${template.fields.length + 1}`,
                  text: '',
                  box: { x: area.x, y: area.y, width, height },
                  origin: {
                    x: area.x + Math.min(2, width / 4),
                    y: area.y + height / 2,
                  },
                  font: 'helvetica',
                  height: Math.min(2.5, height / 3),
                  align: 'left',
                  rotation: 0,
                },
              ],
            });
          }}
        >
          Adicionar campo
        </button>
        {field && (
          <>
            <label className="template-field">
              <span>Caixa em edição</span>
              <select
                value={field.id}
                onChange={(event) => setFieldId(event.target.value)}
              >
                {template.fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || 'Campo sem nome'}
                  </option>
                ))}
              </select>
            </label>
            <FieldEditor key={field.id} field={field} onChange={fieldChanges} />
            <button
              type="button"
              onClick={() =>
                setTemplate({
                  ...template,
                  fields: template.fields.filter(
                    (item) => item.id !== field.id,
                  ),
                })
              }
            >
              Remover campo
            </button>
          </>
        )}
      </fieldset>
    </>
  );
}
