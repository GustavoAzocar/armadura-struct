# Avisos de terceiros

O código original de ArmaduraStruct é Copyright (C) 2026 Ricardo Corsini e colaboradores OpenStruct, disponibilizado sob GPL-3.0-or-later. Consulte [LICENSE](LICENSE).

| Componente                           | Licença informada         | Código-fonte                                   |
| ------------------------------------ | ------------------------- | ---------------------------------------------- |
| LibreDWG Web 0.8.4                   | GPL-3.0                   | https://github.com/mlightcad/libredwg-web      |
| GNU LibreDWG (núcleo do leitor WASM) | GPL-3.0-or-later          | https://www.gnu.org/software/libredwg/         |
| dxf-parser 1.1.2                     | MIT                       | https://github.com/gdsestimating/dxf-parser    |
| React                                | MIT                       | https://github.com/facebook/react              |
| Tauri e plugins fs/dialog            | MIT / Apache-2.0          | https://github.com/tauri-apps/tauri            |
| Vite, TypeScript, Zod                | MIT / Apache-2.0 / MIT    | Repositórios indicados nos respectivos pacotes |
| Lucide React                         | ISC                       | https://github.com/lucide-icons/lucide         |
| jsPDF                                | MIT                       | https://github.com/parallax/jsPDF              |
| Inter (via Fontsource)               | SIL Open Font License 1.1 | https://github.com/rsms/inter                  |

O leitor DWG é executado localmente em WebAssembly, sem serviço proprietário ou envio do desenho. O pacote publicado contém o binário do leitor, copiado no `postinstall`. O leitor não foi modificado neste projeto. As instruções e scripts para recompilá-lo ficam no repositório LibreDWG Web. O lockfile identifica a versão e a integridade do pacote utilizado.

As distribuições devem preservar estas licenças e disponibilizar o código-fonte correspondente, inclusive das dependências GPL, de acordo com seus termos. O instalador é preparado nesta etapa como artefato de desenvolvimento do GitHub Actions; uma distribuição pública estável deve incluir os fontes correspondentes do leitor e da aplicação.

## Arquivos de teste

`tests/fixtures/entities-2d.dwg` e `entities-2d.dxf` são do corpus de testes do [GNU LibreDWG](https://github.com/LibreDWG/libredwg/tree/master/test/test-data/2000), sob a licença do projeto (GPL-3.0-or-later). São usados exclusivamente para verificar a importação. A procedência e os hashes estão em `tests/fixtures/README.md`.

## Identidade

O símbolo provisório de OpenStruct foi reaproveitado do projeto ConsoloStruct do mesmo autor. O ícone definitivo do ArmaduraStruct será desenvolvido posteriormente. AutoCAD e DWG são marcas de seus respectivos titulares; o projeto não possui afiliação com a Autodesk.

## Núcleo de distribuição OpenStruct

Os contratos e adaptadores vendorizados de `launcher-core` 0.2.4 são distribuídos sob MIT, copyright (c) 2026 Ricardo Corsini e colaboradores. A origem e as adaptações estão em `crates/openstruct-distribution/UPSTREAM.md`.

MIT License

Copyright (c) 2026 Ricardo Corsini e colaboradores

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
