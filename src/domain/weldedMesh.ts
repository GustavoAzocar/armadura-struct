import { z } from 'zod';
import { uid } from './types';

/**
 * Telas soldadas: catálogo e critérios de lançamento.
 *
 * Unidades do domínio: comprimentos em mm, área de aço em mm²/m (inteiros no
 * catálogo, sem resíduo de ponto flutuante), massas em kg (por m² e por
 * painel). A interface exibe a área no convencional cm²/m; a conversão de
 * cm/m acontece só na entrada/exibição.
 * Um painel "deitado" é a mesma tela girada: as dimensões ficam fixas e a
 * posição vem da orientação do lançamento.
 * Longitudinal = fios paralelos à maior dimensão do painel (`length`);
 * transversal = fios paralelos à menor (`width`).
 * Este módulo não dimensiona nem valida adequação estrutural da tela.
 */
const n = z.number().finite();

export const weldedMeshDirectionSchema = z
  .object({
    /** mm */
    diameter: n.positive().max(100),
    /** mm, entre eixos de fios */
    spacing: n.positive().max(10000),
    /** mm²/m */
    steelArea: n.positive().max(100000),
  })
  .strict();

export const weldedMeshDefinitionSchema = z
  .object({
    /** Identificação estável: `catalog:<designação>` ou `custom:<id>`. */
    id: z.string().min(1).max(120),
    designation: z.string().trim().min(1).max(40),
    family: z.enum(['Q', 'EQ', 'T', 'L', 'R', 'M']),
    source: z.enum(['catalog', 'custom']),
    steel: z.enum(['CA-50', 'CA-60']),
    presentation: z.enum(['panel']),
    /** mm, dimensão longitudinal (a maior). */
    length: n.positive().max(100000),
    /** mm, dimensão transversal. */
    width: n.positive().max(100000),
    longitudinal: weldedMeshDirectionSchema,
    transverse: weldedMeshDirectionSchema,
    /** kg/m², nominal. */
    massPerArea: n.nonnegative().max(10000),
    /** kg por painel, nominal; independente de massPerArea × área. */
    massPerPanel: n.nonnegative().max(100000),
  })
  .strict();

export const weldedMeshCriteriaSchema = z
  .object({
    /** Cópia dos parâmetros efetivos: o catálogo pode mudar sem afetar lançamentos. */
    mesh: weldedMeshDefinitionSchema,
    /** Graus, anti-horário: direção longitudinal em relação a +X. */
    orientation: n.min(-360000).max(360000),
    /** Canto da região (no referencial da tela) onde começa a paginação. */
    start: z.enum(['bottom-left', 'bottom-right', 'top-left', 'top-right']),
    /** mm, afastamento em planta do contorno externo (não é cobrimento). */
    edgeOffset: n.nonnegative().max(100000),
    /** mm, afastamento em planta das aberturas. */
    openingOffset: n.nonnegative().max(100000),
    /** mm, sobreposição entre painéis consecutivos ao longo do comprimento. */
    lengthOverlap: n.nonnegative().max(100000),
    /** mm, sobreposição entre painéis consecutivos ao longo da largura. */
    widthOverlap: n.nonnegative().max(100000),
    /** Identificação da posição no desenho e no quadro. */
    mark: z.string().trim().min(1).max(20),
    layerId: z.string().min(1).max(200).optional(),
    display: z
      .object({
        wires: z.boolean(),
        panels: z.boolean(),
        identification: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type WeldedMeshDirection = z.infer<typeof weldedMeshDirectionSchema>;
export type WeldedMeshDefinition = z.infer<typeof weldedMeshDefinitionSchema>;
export type WeldedMeshCriteria = z.infer<typeof weldedMeshCriteriaSchema>;

/** Linhas do cadastro de referência: espaçamento (mm), Ø (mm), As (mm²/m), kg/m², kg/painel. */
const REFERENCE: [string, number, number, number, number, number][] = [
  ['Q61', 150, 3.4, 61, 0.97, 14.3],
  ['Q75', 150, 3.8, 75, 1.21, 17.8],
  ['Q92', 150, 4.2, 92, 1.48, 21.8],
  ['Q113', 100, 3.8, 113, 1.8, 26.4],
  ['Q138', 100, 4.2, 138, 2.2, 32.3],
  ['EQ158', 150, 5.5, 158, 2.54, 37.3],
  ['Q166', 100, 4.6, 166, 2.63, 38.7],
  ['Q196', 100, 5.0, 196, 3.11, 45.8],
  ['Q238', 100, 5.5, 238, 3.77, 55.4],
  ['EQ257', 150, 7.0, 257, 4.11, 60.4],
  ['Q283', 100, 6.0, 283, 4.48, 65.9],
  ['Q335', 150, 8.0, 335, 5.37, 78.9],
  ['Q385', 100, 7.0, 385, 6.1, 89.7],
  ['EQ473', 150, 9.5, 473, 7.57, 111.3],
  ['Q503', 100, 8.0, 503, 7.97, 117.2],
  ['EQ591', 120, 9.5, 591, 9.41, 138.3],
  ['Q709', 100, 9.5, 709, 11.24, 165.3],
  ['Q785', 100, 10.0, 785, 12.46, 183.1],
];

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** Painéis CA-60 de 2,45 × 6,00 m, iguais nas duas direções. Somente leitura. */
export const WELDED_MESH_CATALOG: readonly WeldedMeshDefinition[] = deepFreeze(
  REFERENCE.map(
    ([designation, spacing, diameter, steelArea, kgM2, kgPanel]) => {
      const direction = { diameter, spacing, steelArea };
      return {
        id: `catalog:${designation}`,
        designation,
        family: designation.startsWith('EQ') ? 'EQ' : 'Q',
        source: 'catalog',
        steel: 'CA-60',
        presentation: 'panel',
        length: 6000,
        width: 2450,
        longitudinal: { ...direction },
        transverse: { ...direction },
        massPerArea: kgM2,
        massPerPanel: kgPanel,
      } satisfies WeldedMeshDefinition;
    },
  ),
);

/** Cópia editável de um modelo do catálogo, ou undefined. */
export function catalogWeldedMesh(
  designation: string,
): WeldedMeshDefinition | undefined {
  const m = WELDED_MESH_CATALOG.find((m) => m.designation === designation);
  return m && structuredClone(m);
}

/** Configuração personalizada a partir de outra tela; nunca se passa por catálogo. */
export function customWeldedMesh(
  base: WeldedMeshDefinition,
  changes: Partial<WeldedMeshDefinition>,
  id = `custom:${uid()}`,
): WeldedMeshDefinition {
  return {
    ...structuredClone(base),
    ...structuredClone(changes),
    id,
    source: 'custom',
  };
}

export function weldedMeshLabel(m: WeldedMeshDefinition) {
  return m.source === 'custom'
    ? `${m.designation} (personalizada)`
    : m.designation;
}

const LENGTH_FACTOR = { mm: 1, cm: 10, m: 1000 } as const;
export function lengthToMm(value: number, unit: keyof typeof LENGTH_FACTOR) {
  return value * LENGTH_FACTOR[unit];
}

const pt = (v: number, digits: number) =>
  v.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
/** Guardada em mm²/m; exibida no convencional cm²/m: 92 → "0,92 cm²/m". */
export function formatSteelArea(mm2PerM: number) {
  return `${pt(mm2PerM / 100, 2)} cm²/m`;
}

const LABELS: Record<string, string> = {
  id: 'Identificação da tela',
  designation: 'Designação',
  family: 'Família',
  source: 'Origem da tela',
  steel: 'Categoria do aço',
  presentation: 'Apresentação',
  length: 'Comprimento do painel',
  width: 'Largura do painel',
  'longitudinal.diameter': 'Bitola longitudinal',
  'longitudinal.spacing': 'Espaçamento longitudinal',
  'longitudinal.steelArea': 'Área de aço longitudinal',
  'transverse.diameter': 'Bitola transversal',
  'transverse.spacing': 'Espaçamento transversal',
  'transverse.steelArea': 'Área de aço transversal',
  massPerArea: 'Massa nominal por área',
  massPerPanel: 'Massa nominal por painel',
  orientation: 'Orientação',
  start: 'Início da paginação',
  edgeOffset: 'Afastamento do contorno',
  openingOffset: 'Afastamento das aberturas',
  lengthOverlap: 'Sobreposição no comprimento',
  widthOverlap: 'Sobreposição na largura',
  mark: 'Posição',
  layerId: 'Layer',
  display: 'Apresentação da malha',
};

function zodIssues(result: z.ZodSafeParseResult<unknown>, prefix = '') {
  if (result.success) return [];
  return result.error.issues.map((i) => {
    const path = i.path.join('.').replace(/^mesh\./, '');
    const label = LABELS[path] ?? (path || 'Valor');
    const rule =
      i.code === 'too_small'
        ? i.inclusive
          ? 'deve ser maior ou igual a zero'
          : 'deve ser maior que zero'
        : i.code === 'too_big'
          ? 'excede o limite permitido'
          : i.code === 'invalid_type'
            ? 'deve ser um número finito'
            : 'é inválido';
    return `${prefix}${label} ${rule}.`;
  });
}

/** Lista de problemas da definição; vazia quando válida. */
export function weldedMeshIssues(m: WeldedMeshDefinition): string[] {
  const issues = zodIssues(weldedMeshDefinitionSchema.safeParse(m));
  if (issues.length) return issues;
  if (m.length < m.width)
    issues.push(
      'O comprimento (longitudinal) deve ser a maior dimensão do painel. Para um painel em outra posição, mantenha as dimensões e gire pela orientação do lançamento.',
    );
  if (m.source === 'catalog') {
    const reference = WELDED_MESH_CATALOG.find((c) => c.id === m.id);
    if (!reference || JSON.stringify(reference) !== JSON.stringify(m))
      issues.push(
        'Valores diferentes do catálogo: use uma configuração personalizada.',
      );
  }
  return issues;
}

export const defaultWeldedMeshCriteria = (): WeldedMeshCriteria => ({
  mesh: catalogWeldedMesh('Q92')!,
  orientation: 0,
  start: 'bottom-left',
  edgeOffset: 0,
  openingOffset: 0,
  lengthOverlap: 0,
  widthOverlap: 0,
  mark: 'TS1',
  display: { wires: true, panels: true, identification: true },
});

/** Lista de problemas dos critérios; vazia quando válidos. */
export function weldedMeshCriteriaIssues(c: WeldedMeshCriteria): string[] {
  const { mesh: definition, ...criteria } = c;
  const mesh = weldedMeshIssues(definition);
  const rest = zodIssues(
    weldedMeshCriteriaSchema.omit({ mesh: true }).safeParse(criteria),
  );
  const issues = [...mesh, ...rest];
  if (issues.length) return issues;
  if (c.lengthOverlap >= c.mesh.length)
    issues.push(
      `Sobreposição no comprimento deve ser menor que o comprimento do painel (${c.mesh.length} mm).`,
    );
  if (c.widthOverlap >= c.mesh.width)
    issues.push(
      `Sobreposição na largura deve ser menor que a largura do painel (${c.mesh.width} mm).`,
    );
  return issues;
}
