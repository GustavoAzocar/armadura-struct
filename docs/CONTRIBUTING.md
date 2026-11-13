# Contribuir

Complementa a seção **Contribuir** do [README](../README.md) (issues, identidade de autoria e créditos). Para agentes de IA, veja também [AGENTS.md](../AGENTS.md); a estrutura do código está em [ARCHITECTURE.md](ARCHITECTURE.md).

## Preparar o ambiente

```bash
git clone https://github.com/ricardocorsini/armadura-struct.git
cd armadura-struct
npm ci
npm run dev            # interface em http://127.0.0.1:1420
npm run desktop:dev    # app Tauri (exige Rust e os pré-requisitos do Tauri 2)
```

Node.js 22.12 ou superior. Os pré-requisitos por sistema estão no [README](../README.md#executar).

## Fluxo de PR

O repositório principal é `ricardocorsini/armadura-struct` (branch `master`). O fluxo usado no histórico é: fork, branch própria a partir da `master` atualizada, PR para a `master` do repositório principal.

1. Abra (ou localize) uma issue com o caso de uso. Para problema geométrico, inclua dimensões e o resultado esperado.
2. Crie uma branch a partir da `master` atual. Nomes vistos no histórico: `feat/...`, `fix/...`, `docs/...`.
3. Mantenha o PR focado em uma entrega. Se a `master` avançar, traga-a para a sua branch antes de pedir revisão.
4. Antes de enviar, rode o que o CI roda (próxima seção) e informe no PR o que **não** pôde rodar.
5. Confira `git var GIT_AUTHOR_IDENT` antes do commit: nome e e-mail devem ser do contribuidor e ligados à conta do GitHub. Trabalho conjunto usa `Co-authored-by`.

### Mensagens de commit

Português, no imperativo ou descritivo, com prefixo no estilo Conventional Commits e referência à issue quando houver. Exemplos reais do histórico:

```text
feat(cad): adquire referências para extensão e paralelo (#165)
fix: reunir detalhamentos equivalentes que contêm somente telas
test: aguardar recuperação antes de consultar contorno
docs: uso, limites e capturas da biblioteca de símbolos
chore: preparar ArmaduraStruct 0.6.1 com notas de publicação
```

### Revisão antes de mesclar

1. Confira a necessidade, o escopo e os critérios da issue.
2. Revise a lógica dos caminhos alterados: validação de entradas, unidades, estado/histórico, isolamento, geometria e efeitos sobre o aço. CI verde é evidência de execução dos testes, não substitui a revisão do código.
3. Verifique compatibilidade de arquivos, schemas públicos e consumidores compartilhados; considere as versões reservadas por PRs paralelas.
4. Teste regressões pertinentes com resultados conferíveis, invariância física/quantitativa e arquivos exportados reais. Para interface, confira o fluxo e as capturas; registre limites de validação.
5. Corrija problemas antes do merge, atualize descrição/documentação e valide o commit final com a CI. Preserve a autoria e encerre somente as issues cujos critérios foram atendidos. Ao concluir, sugira a próxima revisão.

## Verificações

| Verificação                  | Comando                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| Formatação                   | `npm run format:check` (corrija com `npm run format`)                 |
| Tipos + unitários + contrato | `npm run check`                                                       |
| Build web                    | `npm run build`                                                       |
| E2E                          | `npx playwright install chromium` e `npm run test:e2e` (após o build) |
| Rust                         | comandos abaixo, a partir da raiz                                     |

```bash
cargo fmt --manifest-path crates/openstruct-plugins/Cargo.toml -- --check
cargo test --manifest-path crates/openstruct-plugins/Cargo.toml
cargo test --manifest-path crates/openstruct-distribution/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml project_folder::tests
```

O CI (`.github/workflows/ci.yml`) executa tudo isso em Ubuntu 22.04, mais o build desktop em Linux (deb/AppImage) e Windows (NSIS). Não há linter além do TypeScript `strict` e do Prettier (`semi`, `singleQuote`, `trailingComma: all`).

## Testes

- **Unitários** (Vitest, `tests/*.test.ts`): um arquivo por módulo ou recurso, como `tests/helix.test.ts` para `src/domain/helix*.ts`. Testam o domínio sem navegador.
- **E2E** (Playwright, `tests/e2e/*.spec.ts`): fluxos reais no Chromium contra o build. Padrão dos specs: abrir `/`, carregar um projeto pelo input `data-testid="project-input"` e acionar comandos pelo campo **Comando CAD** ou pela faixa de comandos. Helpers compartilhados ficam em `tests/e2e/*.helpers.ts`.
- Alterações de **comprimento, peso ou quantitativo** exigem uma referência analítica reproduzível no teste (fórmula ou valor conferível à mão), não só um valor capturado da saída.
- Arquivos CAD de referência ficam em `tests/fixtures/` (origem e SHA-256 em `tests/fixtures/README.md`). Só anexe arquivos que você pode compartilhar.
- Capturas de tela de documentação são geradas pelos próprios specs (`page.screenshot({ path: 'docs/...' })`).

## Documentar o que você entregou

Um recurso visível ao usuário normalmente inclui:

- `docs/<RECURSO>.md`: fluxo, convenções, limites e compatibilidade, com nome por assunto (maiúsculas e hífens). Veja `docs/SIMBOLOS.md` ou `docs/TELAS-SOLDADAS.md` como modelo.
- Entrada no índice [docs/README.md](README.md), na área correspondente.
- Linha em `CHANGELOG.md`, na seção **Não lançado**, com link para o guia.
- Item na lista de recursos do `README.md`.
- Se houver comando ou atalho novo, registro em `src/domain/shortcuts.ts` (a central de atalhos usa esse catálogo).

## Alterações de formato

O arquivo do projeto (`Project.schema`, hoje `armadurastruct/35` ou `/37`) e o pacote de intercâmbio (`DETAIL_PACKAGE_SCHEMA` = `openstruct.detail/23`; `BAND_DETAIL_PACKAGE_SCHEMA` = `/24`) são contratos persistidos. O formato 37 é adotado ao usar faixa sem traços; pacotes com essa apresentação usam 24. Confira os literais em `src/domain/types.ts` e `src/domain/detailPackage.ts` antes de documentar ou propor uma versão. Regras observadas no código e no histórico:

- **Não suba o formato** se o dado novo puder ser lido por versões anteriores sem perda. Suba quando um arquivo novo, aberto por um aplicativo antigo, seria interpretado errado.
- `decodeProject` (`src/domain/model.ts`) deve continuar abrindo todos os formatos anteriores e **recusar** dados novos em arquivos de formato antigo, com mensagem do tipo "exigem formato NN".
- O pacote tem lista de versões aceitas e `DETAIL_PACKAGE_SCHEMA` em `src/domain/detailPackage.ts`, e um JSON Schema novo em `docs/openstruct-detail-vNN.schema.json`. O commit `9b5e6c4` (estribo helicoidal, formato 33 / pacote 22) mostra o conjunto completo de arquivos tocados, incluindo testes que fixam o número da versão.
- Há contribuições em paralelo que **reservam** números de formato e de pacote (o CHANGELOG cita isso). Combine o número com o mantenedor antes de usá-lo e registre a reserva no CHANGELOG.
- Ao integrar contratos que reutilizaram um número, preserve a leitura de cada variante e escolha um novo número para salvar a composição. O formato nativo 35 reúne as duas variantes de desenvolvimento do 34 (arquivos vinculados e cotagem); leitores anteriores recusam o 35. A regressão está em `tests/projectFormatCompatibility.test.ts`, e a cotagem usa o pacote 23 ([JSON Schema](openstruct-detail-v23.schema.json)). O pacote de um detalhamento não inclui os caminhos globais de `Project.linkedFiles` nem concede acesso à pasta de origem.
- Documente a compatibilidade no guia do recurso (quais formatos abrem, quais são recusados) e lembre ao usuário de manter cópias antes de salvar em formato novo.

## Dependências, licença e distribuição

- O projeto é GPL-3.0-or-later. Novas dependências precisam ter licença compatível e entrar em `THIRD_PARTY_NOTICES.md`.
- Versões de release, tags e o catálogo assinado são do mantenedor. Siga [RELEASES.md](RELEASES.md); não edite `.github/release-request.json` nem `.github/release-notes/` em PRs de funcionalidade.
- Segurança do desktop: a CSP e as permissões do Tauri são deliberadamente estreitas. Qualquer ampliação precisa de justificativa explícita no PR.
