import type { Project, SheetSteelSchedule } from '../domain/types';
import { NumberField } from './Panels';
export type SheetScheduleRequest = {
  projectId: string;
  sheetId: string;
  options: Omit<SheetSteelSchedule, 'origin'>;
};
export default function SheetSchedulePanel({
  project,
  value,
  onSheet,
  onChange,
  onCancel,
}: {
  project: Project;
  value: SheetScheduleRequest;
  onSheet: (id: string) => void;
  onChange: (options: SheetScheduleRequest['options']) => void;
  onCancel: () => void;
}) {
  return (
    <section className="transform-panel" aria-label="Inserir quadro na prancha">
      <div className="transform-heading">
        <b>Quadro de aço da prancha</b>
        <span>Papel · mm</span>
      </div>
      <label className="field">
        <span>Prancha de destino</span>
        <select
          aria-label="Prancha do quadro"
          value={value.sheetId}
          onChange={(e) => onSheet(e.target.value)}
        >
          {project.sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="Altura do texto do quadro"
        value={value.options.textHeight}
        min={1.8}
        max={5}
        suffix="mm"
        onChange={(textHeight) => onChange({ ...value.options, textHeight })}
      />
      <NumberField
        label="Acréscimo no peso"
        value={value.options.allowancePercent}
        min={0}
        max={100}
        suffix="%"
        onChange={(allowancePercent) =>
          onChange({ ...value.options, allowancePercent })
        }
      />
      <p>
        Mova o cursor sobre o papel e clique para inserir pelo canto superior
        esquerdo. O quadro acompanha as armaduras desta folha; vistas repetidas
        não somam aço.
      </p>
      <p>
        Texto em tamanho real no papel, independente das escalas das vistas. Esc
        ou botão direito cancela.
      </p>
      {project.sheets.find((s) => s.id === value.sheetId)?.steelSchedule && (
        <p>Esta folha já tem um quadro. O clique reposiciona o existente.</p>
      )}
      <button onClick={onCancel}>Cancelar inserção do quadro</button>
    </section>
  );
}
