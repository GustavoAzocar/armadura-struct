/** Campo CSV entre aspas. Textos que começam como fórmula recebem apóstrofo
 * para que planilhas não os executem; aspas são duplicadas. */
export const csvField = (v: unknown) =>
  `"${String(v)
    .replace(/^(?=[=+@\-\t\r])/, "'")
    .replace(/"/g, '""')}"`;
