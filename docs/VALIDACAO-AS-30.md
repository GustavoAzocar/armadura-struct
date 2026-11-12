# Validação da AS-30

O inspetor de armaduras e rebatimentos permite escolher a convenção de cotagem
e consultar a memória do corte. Os critérios abaixo correspondem à
[issue #136](https://github.com/ricardocorsini/armadura-struct/issues/136).
As referências geométricas e as formas cobertas estão no
[guia de convenções](CONVENCOES-COTAGEM-ARMADURAS.md).

| Critério                                        | Evidência                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reta, L, U e estribo retangular fechado         | `barDimensions.test.ts` e `barDevelopment.test.ts` conferem as referências, retas, arcos e totais em mm, com tolerância menor que 0,001 mm nas comparações analíticas.                                                               |
| Bitola, mandril, cobrimento e ganchos           | Os testes de domínio conferem tangências, raio no eixo e conversão da referência de concreto. Ganchos legados e paramétricos compõem o corte uma vez, inclusive quando ocultos no desenho.                                           |
| Geometria inválida e formas sem suporte externo | Os testes cobrem segmentos insuficientes, coordenadas não finitas, mudanças de sentido, pontas e formas fora da convenção. A consulta informa a indisponibilidade.                                                                   |
| Convenções independentes, histórico e consulta  | `bar-cotation.spec.ts` cobre alternância pelo inspetor, teclado, Desfazer/Refazer, consulta sem entrada de histórico, atualização após mudar a bitola e zoom. `barDimensionLabels.test.ts` cobre âncoras, escala, rotação e espelho. |
| Persistência e vínculos                         | `barCotationPersistence.test.ts`, `barCotationTransfer.test.ts` e o fluxo Chromium cobrem legado, formatos /34 e /23, mm/cm/m, cópia, transferência, salvar, reabrir e recuperação.                                                  |
| Saídas e aço                                    | `barDimensionExports.test.ts` confere CAD, prancha, PDF e DXF. A relação de aço e o CSV preservam corte, massa e 24 peças (3 × 2 × 4), inclusive com texto manual em anotação.                                                       |

As cotas automáticas usam cm com uma casa decimal e conservam as âncoras
existentes. Unidade, precisão e arredondamento por anotação foram testados
no contrato existente. A edição individual desses atributos e da posição do
texto das cotas automáticas pertence a AS-27/28.

A política atual usa o desenvolvimento geométrico como comprimento de corte.
Uma política comercial futura de EDU-09 fica fora desta validação.

A validação local usou Node 22 no Windows. `npm run check` passou com 1.203
testes de domínio e integração, seis testes de distribuição e a validação
do plugin de exemplo. Build web e formatação passaram. Os três fluxos de
cotagem passaram no Chromium, incluindo zoom e recuperação. Outros seis
fluxos de intercâmbio e inicialização passaram na etapa 4. A suíte completa
de navegador e os aplicativos nativos para Linux e Windows aguardam o CI.
