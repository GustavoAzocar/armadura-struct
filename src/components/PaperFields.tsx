import type { Project, Sheet, SheetPlacement } from '../domain/types';
import { alignPlacement, fitPlacement, usefulArea } from '../domain/paper';
import { updatePlacement, updateSheet } from '../domain/sheets';
import { NumberField, TextField } from './Panels';
type Change = (change: (p: Project) => Project) => boolean;

export function SheetPaperFields({
  sheet,
  onChange,
}: {
  sheet: Sheet;
  onChange: Change;
}) {
  const area = usefulArea(sheet);
  return (
    <>
      {sheet.format === 'custom' && (
        <div className="paper-fields">
          <NumberField
            label="Lado A do papel"
            value={sheet.customSize.width}
            min={50}
            onChange={(width) =>
              onChange((p) =>
                updateSheet(p, sheet.id, {
                  customSize: { ...sheet.customSize, width },
                }),
              )
            }
            suffix="mm"
          />
          <NumberField
            label="Lado B do papel"
            value={sheet.customSize.height}
            min={50}
            onChange={(height) =>
              onChange((p) =>
                updateSheet(p, sheet.id, {
                  customSize: { ...sheet.customSize, height },
                }),
              )
            }
            suffix="mm"
          />
          <p className="field-help">
            A orientação coloca o lado maior na horizontal ou vertical. Limite
            de cada lado: 50 a 5.000 mm.
          </p>
        </div>
      )}
      <details className="paper-fields">
        <summary>Área útil e reserva do selo</summary>
        {(['left', 'right', 'top', 'bottom'] as const).map((key, i) => (
          <NumberField
            key={key}
            label={`Margem ${['esquerda', 'direita', 'superior', 'inferior'][i]}`}
            value={sheet.margins[key]}
            min={0}
            onChange={(n) =>
              onChange((p) =>
                updateSheet(p, sheet.id, {
                  margins: { ...sheet.margins, [key]: n },
                }),
              )
            }
            suffix="mm"
          />
        ))}
        <p className="field-help">
          Área útil: {area.width} × {area.height} mm. As margens não alteram
          posições ou escalas.
        </p>
        <label className="paper-checkbox">
          <input
            type="checkbox"
            checked={sheet.seal.enabled}
            onChange={(e) =>
              onChange((p) =>
                updateSheet(p, sheet.id, {
                  seal: { ...sheet.seal, enabled: e.target.checked },
                }),
              )
            }
          />
          Reservar selo
        </label>
        {sheet.seal.enabled && (
          <>
            <NumberField
              label="Largura do selo"
              value={sheet.seal.width}
              min={1}
              onChange={(width) =>
                onChange((p) =>
                  updateSheet(p, sheet.id, { seal: { ...sheet.seal, width } }),
                )
              }
              suffix="mm"
            />
            <NumberField
              label="Altura do selo"
              value={sheet.seal.height}
              min={1}
              onChange={(height) =>
                onChange((p) =>
                  updateSheet(p, sheet.id, { seal: { ...sheet.seal, height } }),
                )
              }
              suffix="mm"
            />
            <p className="field-help">
              Reserva no canto inferior direito da área útil. Vistas sobre o
              selo bloqueiam o PDF.
            </p>
          </>
        )}
      </details>
    </>
  );
}
export function ViewPaperFields({
  view,
  onChange,
}: {
  view: SheetPlacement;
  onChange: Change;
}) {
  return (
    <div className="paper-fields">
      <NumberField
        label="Escala da vista 1:N"
        value={view.scale}
        min={0.01}
        onChange={(scale) =>
          onChange((p) => updatePlacement(p, view.id, { scale }))
        }
      />
      <NumberField
        label="Texto no papel"
        value={view.textHeight}
        min={2}
        onChange={(textHeight) =>
          onChange((p) => updatePlacement(p, view.id, { textHeight }))
        }
        suffix="mm"
      />
      <TextField
        label="Título da vista"
        value={view.title}
        allowEmpty
        maxLength={200}
        onChange={(title) =>
          onChange((p) => updatePlacement(p, view.id, { title }))
        }
      />
      <div className="sheet-actions">
        <button onClick={() => onChange((p) => alignPlacement(p, view.id))}>
          Centralizar conteúdo
        </button>
        <button onClick={() => onChange((p) => fitPlacement(p, view.id))}>
          Ajustar escala ao quadro
        </button>
      </div>
      <p className="field-help">
        Centralizar mantém a escala. Ajustar escala escolhe explicitamente uma
        escala que caiba no quadro. Comprimentos e pesos vêm do modelo.
      </p>
      <details>
        <summary>Origem no modelo</summary>
        <NumberField
          label="Modelo X"
          value={view.modelOrigin.x}
          onChange={(x) =>
            onChange((p) =>
              updatePlacement(p, view.id, {
                modelOrigin: { ...view.modelOrigin, x },
              }),
            )
          }
          suffix="mm"
        />
        <NumberField
          label="Modelo Y"
          value={view.modelOrigin.y}
          onChange={(y) =>
            onChange((p) =>
              updatePlacement(p, view.id, {
                modelOrigin: { ...view.modelOrigin, y },
              }),
            )
          }
          suffix="mm"
        />
        <p className="field-help">
          Este ponto físico é colocado na origem da vista no papel, antes da
          rotação.
        </p>
      </details>
    </div>
  );
}
