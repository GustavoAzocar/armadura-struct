import { normalizeCad, parseDxf } from './import';
self.onmessage = async (
  event: MessageEvent<{ name: string; buffer: ArrayBuffer; base: string }>,
) => {
  try {
    const { name, buffer, base } = event.data;
    if (/\.dwg$/i.test(name)) {
      const signature = new TextDecoder().decode(buffer.slice(0, 6));
      if (!/^AC10\d{2}$/.test(signature))
        throw new Error('Cabeçalho DWG não reconhecido.');
      const { LibreDwg, Dwg_File_Type } = await import(
        '@mlightcad/libredwg-web'
      );
      const engine = await LibreDwg.create(base);
      const readerWarnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        readerWarnings.push(args.map(String).join(' '));
        originalWarn(...args);
      };
      let ptr: number | undefined;
      try {
        ptr = engine.dwg_read_data(buffer, Dwg_File_Type.DWG);
        if (!ptr)
          throw new Error('O leitor não conseguiu interpretar este DWG.');
        const mask = normalizeCad(engine.convert(ptr), name, 'DWG');
        mask.warnings.push(...readerWarnings.map((w) => `Leitor DWG: ${w}`));
        self.postMessage({ mask });
      } finally {
        console.warn = originalWarn;
        if (ptr) engine.dwg_free(ptr);
      }
    } else {
      let text = new TextDecoder().decode(buffer);
      if (text.includes('\ufffd'))
        text = new TextDecoder('windows-1252').decode(buffer);
      self.postMessage({ mask: parseDxf(text, name) });
    }
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : 'Falha na leitura do desenho.',
    });
  }
};
