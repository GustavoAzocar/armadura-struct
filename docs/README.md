# Documentação do ArmaduraStruct

Índice dos guias por área. Para começar, leia o [Guia de uso](GUIA.md) e os [atalhos de teclado](ATALHOS.md). Os guias `AS-NN` levam o número da tarefa que os originou; o assunto está ao lado.

A master desta revisão salva projetos em `armadurastruct/35` e pacotes em `openstruct.detail/23` ([JSON Schema](openstruct-detail-v23.schema.json)). Guias de entregas anteriores podem citar contratos históricos; confira os formatos atuais no código e nas [regras de contribuição](CONTRIBUTING.md#alterações-de-formato).

## Projeto e organização

- [Novo projeto com organização inicial](NOVO-PROJETO.md)
- [Pavimento → grupo → detalhamento](ORGANIZACAO-PROJETO.md)
- [Criação contextual na árvore](ARVORE-CRIACAO-CONTEXTUAL.md)
- [Metadados documentais de cada desenho](METADADOS-DESENHO.md)
- [Pasta do projeto e arquivos vinculados](PASTA-PROJETO.md)
- [Projetos e documentos recentes](PROJETOS-RECENTES.md)
- [AS-03 · Repetição de detalhamentos e quantitativos](AS-03.md)

## Armaduras

- [Estribos pela seção e pela faixa](ESTRIBOS.md)
- [Estribo helicoidal](ESTRIBO-HELICOIDAL.md)
- [Grampos de pilar S/C](GRAMPOS-PILAR.md)
- [Grampo de viga em U](GRAMPOS_VIGA.md)
- [Telas soldadas](TELAS-SOLDADAS.md)
- [Seguir fôrma por uma ou várias linhas](SEGUIR-FORMA.md)
- [Menu Armaduras — organização compacta](MENU-ARMADURAS.md)
- [AS-25 · Inserir, continuar e remover vértices](AS-25.md)
- [AS-26 · Comprimentos, ângulos e extensão de barras](AS-26.md)
- [Convenções de cotagem de armaduras e memória de corte](CONVENCOES-COTAGEM-ARMADURAS.md)
- [AS-52 · Representações independentes de armaduras](AS-52.md)
- [AS-53 · Duplicar a armadura completa](AS-53.md)
- [AS-54 · Posições de fabricação e ocorrências](AS-54.md)
- [AS-55 · Renumeração espacial e faixa de marcas](AS-55.md)
- [AS-56 · Quantidade por grupo e dados de montagem](AS-56.md)

## Edição no CAD

- [Encaixes de objetos no CAD 2D](ENCAIXES-CAD.md)
- [Configurações CAD](CONFIGURACOES-CAD.md)
- [Copiar propriedades gráficas](COPIAR-PROPRIEDADES.md)
- [Textos CAD livres](TEXTOS-LIVRES.md)
- [Proporção dos textos durante o zoom](TEXTOS-E-ZOOM.md)
- [Biblioteca de símbolos CAD](SIMBOLOS.md)
- [AS-23 · Alinhar objetos, detalhamentos e vistas](AS-23.md)
- [AS-24 · Menu contextual e transformações por base comum](AS-24.md)
- [Fluidez do CAD e medições reproduzíveis](DESEMPENHO-CAD.md)
- [Interação CAD por frame](FLUIDEZ-INTERACAO-CAD.md)

## Máscaras (DXF/DWG e nativas)

- [Importação em lote e associação](MASCARAS-LOTE.md)
- [Escolher a máscara para desenhar](MASCARA-ATIVA.md)
- [Máscaras nativas e organização dos comandos](MASCARAS-NATIVAS.md)
- [Ajustar escala por dois pontos](ESCALA-MASCARA.md)
- [Mover](MASCARAS-MOVER.md), [Rotacionar](MASCARAS-ROTACIONAR.md), [Espelhar](MASCARAS-ESPELHAR.md), [Copiar e Apagar](MASCARAS-COPIAR-APAGAR.md)
- [Offset](MASCARAS-OFFSET.md) e [Ajustar / Estender](MASCARAS-AJUSTAR-ESTENDER.md)
- [Medir e cotar](MASCARAS-MEDIR-COTAR.md) e [Medir contorno](MASCARAS-MEDIR-CONTORNO.md)

## Layers, visibilidade e impressão

- [AS-19 · Layers nativos com estilos](AS-19.md)
- [AS-20 · Perfis de layers](AS-20.md)
- [AS-21 · Estilos de impressão](AS-21.md)
- [AS-22 · Ocultar, isolar e recuperar objetos por vista](AS-22.md)

## Pranchas e quantitativos

- [AS-04 · Gerenciador de pranchas e abas](AS-04.md)
- [AS-05 · Composição de folhas em escala](AS-05.md)
- [Quadro de aço vinculado à prancha](QUADRO-NA-PRANCHA.md)
- [CSV da relação do aço por escopo](CSV-POR-ESCOPO.md)

## Intercâmbio, API e plugins

- [AS-08 · Inserção e atualização seletiva de detalhamentos](AS-08.md)
- [AS-09 · Pacotes de detalhamento (`openstruct.detail`) e adaptação assistida de CAD](AS-09.md); JSON Schema por versão em `openstruct-detail-vNN.schema.json` e exemplos em [examples/](examples/)
- [AS-51 · API executável de armaduras](AS-51.md)
- [Usar plugins](plugins/USER-GUIDE.md), [contrato para desenvolvedores](plugins/DEVELOPERS.md), [decisão de arquitetura](plugins/ARCHITECTURE.md) e [validação da v1](plugins/VALIDATION.md)

## Distribuição e atualizações

- [Atualizações do ArmaduraStruct](ATUALIZACOES.md)
- [Distribuição desktop (publicação)](RELEASES.md)

## Desenvolvimento

- [Arquitetura](ARCHITECTURE.md)
- [Contribuir](CONTRIBUTING.md)
- [Instruções para agentes de programação](../AGENTS.md)
- Relatórios de validação: [encaixes CAD (#162)](VALIDACAO-ENCAIXES-CAD.md), [convenções de cotagem (AS-30)](VALIDACAO-AS-30.md), [plugins v1](plugins/VALIDATION.md)
