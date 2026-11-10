# Biblioteca de símbolos CAD

Em **Máscaras → Controle de máscaras → Biblioteca de símbolos** (`symbols`), guarde desenhos CAD reutilizáveis e insira-os quantas vezes precisar. A biblioteca só contém definições criadas ou importadas explicitamente por você; não existe catálogo externo implícito. Símbolos são **gráficos**: não são detalhamentos físicos e nunca carregam armaduras, posições, quantitativos ou RA.

## Fluxo

1. **Criar.** Ative uma máscara, abra a biblioteca e clique **Novo símbolo…**. Informe nome e categoria, marque as entidades da máscara ativa (pesquisa por nome/ID; só entidades visíveis, com captura e desbloqueadas) e defina o **ponto base** em mm do modelo (ou use _Canto inferior esquerdo da seleção_). A geometria é gravada relativa a esse ponto, já com origem, rotação e escala da máscara aplicadas. Nada do aço nem da máscara é alterado.
2. **Buscar e visualizar.** A lista filtra por nome ou categoria e mostra uma prévia; a prévia nunca modifica o projeto.
3. **Inserir.** Escolha posição (X, Y em mm), rotação (°) e escala. Em **Escolher posição no desenho** a janela se esconde, uma prévia acompanha o cursor (com os encaixes do CAD) e o clique devolve o ponto; Esc cancela sem alterar nada. O ponto base da criação tem o mesmo botão **Escolher no desenho**. Coordenadas absolutas digitadas no Comando CAD também valem.
   - **Instância vinculada** (padrão): reutiliza a definição. Cada instância guarda só posição, rotação, escala e layer; transformar uma não muda as outras. Pertence ao detalhamento ativo e segue layers, visibilidade, isolamento e impressão como qualquer objeto.
   - **Cópia independente**: acrescenta entidades novas (IDs novos) à máscara ativa, sem vínculo; editar a definição não as altera. Em máscara nativa, símbolos com texto ou geometria importada só podem ser inseridos como instância.
4. **Editar a definição.** _Editar…_ permite renomear, recategorizar e substituir a geometria pela seleção atual. Antes de confirmar, o painel informa quantas instâncias serão atualizadas; a confirmação é uma única operação no histórico. A revisão do símbolo sobe a cada mudança de geometria.
5. **Transformar ou desvincular uma instância.** Clique na instância no desenho (Delete a exclui, com desfazer) ou selecione-a na lista de instâncias: _Aplicar transformação_, _Desvincular em cópia_ (troca por entidades independentes na máscara ativa) ou _Excluir instância_.
6. **Remover.** Uma definição usada só sai junto com suas instâncias, após confirmação explícita, em uma operação desfazível. Não sobram instâncias órfãs.
7. **Catálogo.** _Exportar catálogo_ grava `*.simbolos.json` (formato nativo `armadurastruct.symbols/1`); _Importar catálogo…_ valida o arquivo inteiro antes de alterar o projeto, gera identidades novas e, para nomes repetidos (sem diferenciar maiúsculas), **renomeia** (`Nome (2)`) ou **ignora**, conforme a opção escolhida. Nunca sobrescreve uma definição existente.

Esc volta uma etapa (formulário → biblioteca) e, na biblioteca, fecha. A janela é modal: trocar de projeto, desenho ou isolamento não é possível com ela aberta, e confirmações repetidas não duplicam a operação (o mesmo snapshot do projeto não é aplicado duas vezes).

## Persistência e compatibilidade

Projetos com símbolos usam o formato **`armadurastruct/27`** (`symbols` e `symbolInstances`). Projetos `1` a `26` abrem normalmente e migram para o 27 sem alterar conteúdo; um arquivo anterior ao 27 que contenha esses campos é rejeitado. A validação ao abrir recusa instância sem definição, nomes ou IDs duplicados, layer inexistente, escala inválida, instância sem dono na hierarquia e geometria nativa inconsistente. Salvar/reabrir e autosave (que grava o mesmo JSON e volta por `decodeProject`) conservam tudo, inclusive estilo e plotagem da instância.

Canvas, pranchas/PDF e DXF desenham as instâncias pela mesma geometria compartilhada (`drawingPrimitives`). Círculos e arcos seguem a discretização das máscaras nas saídas (erro radial máximo 0,05 mm × escala); o projeto conserva a forma analítica. Quadro de aço, CSV e RA não mudam ao inserir, transformar ou remover símbolos.

## Limitações conhecidas

- Mover por arraste e captura (snap) na geometria das instâncias não existem: a posição se altera pela janela (campos numéricos ou **Escolher posição no desenho**).
- Uma instância usa **um único layer** (escolhido na inserção); layers e estilos por entidade da origem não são guardados na definição.
- O pacote OpenStruct de detalhamento ainda não transporta símbolos: exportar um detalhamento que contenha instâncias é **recusado com aviso**, para não perder dados em silêncio. Desvincule as instâncias em cópias independentes antes de exportar.
- A reunião de repetições de detalhamento remove as instâncias dos detalhamentos descartados, como já faz com as máscaras deles (comportamento implementado, sem teste dedicado).
- O DWG não é escrito; o DXF recebe os símbolos expandidos em entidades.
- Navegador e desktop dividem o mesmo código. A validação automatizada foi feita em Chromium no Windows; builds desktop Linux/Windows seguem a CI existente e o aplicativo instalado não foi testado interativamente.

## Testes

`tests/symbols.test.ts` cobre criação (ponto base, máscara girada/escalada, nomes duplicados, limites, layers, contexto), instâncias (reuso da definição, aço intacto, transformação independente, cópia, desvinculação), edição com impacto, remoção sem órfãos, persistência/migração/casos inválidos, PDF/DXF/CSV, catálogo e integração com visões e hierarquia. `tests/e2e/symbols.spec.ts` percorre o fluxo na interface, incluindo escolha de pontos por clique com prévia, Esc, seleção/Delete por clique, histórico (desfazer/refazer), reabertura, importação inválida e capturas em `docs/simbolos-*.png`.
