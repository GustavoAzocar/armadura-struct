# AGENTS.md

ArmaduraStruct: CAD 2D de armaduras do ecossistema OpenStruct (GPL-3.0-or-later). Interface React 19 + TypeScript + Vite, empacotada como app desktop Tauri 2 (Rust). O idioma do projeto é **português do Brasil**: interface, commits, docs, CHANGELOG e testes. Mapa dos módulos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Regras de contribuição: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Comandos

Node >= 22.12 (CI usa 22). Use `npm ci`; o `postinstall` copia o WASM do leitor DWG para `public/wasm`.

| Tarefa                                         | Comando                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Interface no navegador (http://127.0.0.1:1420) | `npm run dev`                                                                                 |
| App desktop                                    | `npm run desktop:dev` (precisa de Rust e pré-requisitos do Tauri 2)                           |
| Verificação principal                          | `npm run check` = `tsc -b` + `vitest run` + teste do release + validação do plugin de exemplo |
| Só testes unitários / um arquivo / um teste    | `npm test` / `npx vitest run tests/helix.test.ts` / `npx vitest run -t "nome do teste"`       |
| Formatação (Prettier)                          | `npm run format` / `npm run format:check`                                                     |
| Build web                                      | `npm run build`                                                                               |
| E2E (Playwright, Chromium)                     | `npx playwright install chromium`, depois `npm run build && npm run test:e2e`                 |
| Rust                                           | ver [CONTRIBUTING](docs/CONTRIBUTING.md#verificações)                                         |

- Os E2E sobem `npm run preview` na porta 1420 e usam `workers: 1`. Eles rodam sobre o **build** (`dist`), então rode `npm run build` antes. Um único arquivo: `npx playwright test tests/e2e/symbols.spec.ts`.
- Não há ESLint. Tipos (`tsc -b`, `strict`) e Prettier (`semi`, `singleQuote`, `trailingComma: all`) são os portões de estilo. O CI roda `format:check` primeiro.
- O CI (`.github/workflows/ci.yml`) roda: format:check, check, build, E2E (inclui specs repetidos com `--repeat-each=5`) e, em Linux e Windows, os testes Rust e o build desktop.

## Onde mexer

- `src/domain/`: regras, geometria, quantitativos, esquemas Zod e formato do projeto. É a camada testada com Vitest. Sem React; evite DOM novo aqui.
- `src/components/`: diálogos, painéis, faixa de comandos e canvases (`CadCanvas.tsx`, `SheetCanvas.tsx`).
- `src/App.tsx` (mais de 11 mil linhas): estado do documento, histórico e orquestração das sessões de comando. Mudanças aqui são frequentes; leia só a região necessária (use busca), não o arquivo inteiro.
- `src/lib/`: arquivos, pasta de projeto, exportações (DXF/PDF/CSV), atualizações; é onde ficam as pontes com o Tauri (`isTauri()`).
- `src/cad/`: importação DXF/DWG em worker. `src/plugins/` + `public/plugins/v1/`: contrato de plugins.
- `src-tauri/` e `crates/`: Rust. O frontend só fala com ele por comandos `invoke` declarados em `src-tauri/src/lib.rs`.
- `tests/*.test.ts` (Vitest, domínio e lib), `tests/e2e/*.spec.ts` (Playwright), `tests/fixtures/` (DXF/DWG de referência com hashes; não regrave: `.gitattributes` os marca como binários).

## Regras que não são óbvias no código

1. **Toda alteração do projeto passa por `commit(change)`** em `App.tsx`: função pura `Project -> Project`, validada (visibilidade, layers, `validateRebarChange`, isolamento) e gravada no histórico (até 40 passos de desfazer). Não mute `Project`; devolva cópias. Operações compostas devem ser **uma única** entrada no histórico (confirmação atômica).
2. **O formato do arquivo é versionado e restritivo.** A versão atual do projeto é o literal `schema` de `Project` em `src/domain/types.ts`; a do pacote de intercâmbio é `DETAIL_PACKAGE_SCHEMA` em `src/domain/detailPackage.ts`, com JSON Schema em `docs/openstruct-detail-vNN.schema.json` (na master desta revisão: `armadurastruct/35` e `openstruct.detail/23`; confira no código antes de citar). Os JSON Schema de versões anteriores são contratos publicados: não os altere. Projetos antigos precisam continuar abrindo; dados novos em arquivo de formato antigo devem ser **recusados** em `decodeProject` (`src/domain/model.ts`). As duas variantes de desenvolvimento do formato 34 são lidas preservando vínculos de arquivos e convenções de cotagem; o projeto é salvo em 35. Só suba o formato quando o dado novo não puder ser lido por versões anteriores, e veja [CONTRIBUTING](docs/CONTRIBUTING.md#alterações-de-formato) antes.
3. **Unidades:** coordenadas e geometria em **mm**; ângulos em graus na interface e no pacote; comprimentos do quadro em m; cotas gráficas em cm. Não misture.
4. **Comprimento e peso usam o eixo físico da barra**, com arcos de dobra. Alterar comprimento, peso ou quantitativo exige teste com referência analítica reproduzível.
5. **A quantidade guardada na barra é por grupo.** O quadro aplica multiplicador da armadura e repetição do detalhamento uma só vez. Não multiplique de novo.
6. **Aço, símbolos, máscaras e telas são conceitos separados.** Máscaras (DXF/DWG) e símbolos são gráficos e nunca criam aço sozinhos. Relação de aço bloqueada (`scheduleLock`) guarda uma fotografia.
7. **Hierarquia:** pavimento (`floor`) → grupo/elemento (`element`) → detalhamento (`detail`). Todo objeto pertence a um detalhamento (`completeOwnership`).
8. **Interface e `localStorage`:** preferências de UI podem usar `localStorage` (sempre dentro de `try/catch`, como em `App.tsx`). Conteúdo do documento vai no `Project`; recuperação automática usa IndexedDB (`src/lib/files.ts`).
   `linkedFiles` guarda somente caminhos relativos; o acesso aos arquivos depende da pasta autorizada na sessão (`src/lib/projectFolder.ts`). Vincular/desvincular e o histórico devem respeitar o isolamento de detalhamento, inclusive o guard central de `src/domain/detailEditing.ts`.
9. **Segurança do desktop:** a CSP e as capabilities do Tauri (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`) são estreitas de propósito. Não as amplie para resolver um problema de funcionalidade. Plugins de terceiros **não executam** nesta versão (pacotes ficam desativados).
10. **Crates vendorizados:** `crates/openstruct-distribution` é cópia adaptada do launcher (licença MIT, ver `UPSTREAM.md`). Nunca acesse `state.json` sem o `launcher.lock`. Não gere nem altere chaves, `trust.json` ou `catalog.signed.json`.

## Fluxo de trabalho

- Um recurso novo normalmente toca: `src/domain/*` (lógica + esquema), `src/components/*` e `App.tsx` (interface/comando), `src/domain/shortcuts.ts` (se tiver comando ou atalho), testes Vitest e Playwright, `docs/<RECURSO>.md` (nome por assunto, em maiúsculas com hífens, não `AS-NN`) listado no índice [docs/README.md](docs/README.md), linha em `CHANGELOG.md` (seção "Não lançado") e item no `README.md`.
- Imagens de `docs/*.png` são geradas pelos specs E2E (`page.screenshot({ path: 'docs/...' })`) e referenciadas pelos guias. Regenere-as pelo spec; não edite à mão.
- Rode ao menos `npm run format:check` e `npm run check` antes de concluir. Se tocou em interface, rode também os specs E2E afetados e informe se não pôde rodá-los.
- **Autoria de commits:** não substitua a identidade do contribuidor. Confira `git var GIT_AUTHOR_IDENT`; em trabalho conjunto use trailer `Co-authored-by`.
- Não edite `package-lock.json` à mão nem arquivos de release (`.github/release-request.json`, `.github/release-notes/`). Publicação segue [docs/RELEASES.md](docs/RELEASES.md) e é decisão do mantenedor.
