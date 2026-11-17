/**
 * Composição dos contratos /40 (séries) e /41 (máscaras independentes).
 * /41 também foi usado pela PR #217 e /42 está reservado à PR #218.
 * Não publicar a composição sob um cabeçalho aceito por leitores parciais.
 */
export const SERIES_MASK_PROJECT_SCHEMA = 'armadurastruct/43' as const;

/** /41 também existe na PR #217; não descarte seus campos ao ler máscaras. */
export function hasUnsupportedSealProperties(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const data = input as Record<string, unknown>;
  return (
    data.sealPropertyDefinitions !== undefined ||
    data.sealPropertyValues !== undefined ||
    (Array.isArray(data.sheets) &&
      data.sheets.some(
        (sheet) =>
          sheet &&
          typeof sheet === 'object' &&
          (sheet as Record<string, unknown>).sealPropertyValues !== undefined,
      ))
  );
}

/** Conserva a versão após retirar recursos; nunca rebaixa a composição. */
export function withSeriesMaskVersion<T extends { schema: string }>(
  project: T,
  feature: 'armadurastruct/40' | 'armadurastruct/41',
): T {
  if (
    project.schema === SERIES_MASK_PROJECT_SCHEMA ||
    project.schema === feature
  )
    return project;
  return {
    ...project,
    schema:
      project.schema === 'armadurastruct/40' ||
      project.schema === 'armadurastruct/41'
        ? SERIES_MASK_PROJECT_SCHEMA
        : feature,
  };
}
