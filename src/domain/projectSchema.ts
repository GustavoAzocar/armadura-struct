/**
 * Composição dos contratos /40 (séries) e /41 (máscaras independentes).
 * /41 também foi usado pela PR #217 e /42 está reservado à PR #218.
 * Não publicar a composição sob um cabeçalho aceito por leitores parciais.
 */
export const SERIES_MASK_PROJECT_SCHEMA = 'armadurastruct/43' as const;

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
