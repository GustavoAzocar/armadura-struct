# Metadados documentais de cada desenho

Cada registro em `project.hierarchy.drawings` (`DetailDrawing`) representa um desenho específico vinculado a um detalhamento estrutural (`detailId`). Além de `id`, `detailId` e `name`, cada desenho suporta metadados documentais opcionais próprios, separados da autoria/notas globais do projeto (`project.author`, `project.notes`) e das propriedades de cada folha/prancha (`sheet.properties`).

## Campos e relação com `name`

- **Título do desenho (`name`)**: reaproveita o campo `DetailDrawing.name` já existente (obrigatório, 1 a 100 caracteres após `trim`, sem caracteres de controle), evitando criar um campo concorrente. Quando permanece `'Desenho principal'` ou coincide com o nome do detalhamento, `drawingLabel` continua apresentando o nome do detalhamento; caso contrário, exibe `Detalhamento · Título`.
- **Autor informado (`author?`)**: opcional, até 150 caracteres. É um texto documental informado explicitamente pelo usuário para aquele desenho, sem inferência por conta, sistema operacional ou GitHub e sem caráter de assinatura verificada. Quando vazio, é omitido (`undefined`).
- **Data documental (`date?`)**: opcional, representada exclusivamente como data civil ISO `AAAA-MM-DD` (anos `1000`–`9999`, validada por aritmética inteira de calendário incluindo anos bissextos), sem horário nem deslocamento por fuso. Pode permanecer vazia (`undefined`).
- **Comentários (`notes?`)**: opcional, texto puro de até 5.000 caracteres com quebras de linha normalizadas (`\n`) e bloqueio de caracteres de controle inválidos. Renderizado exclusivamente como texto literal na interface, sem interpretar HTML.
- **Associação hierárquica somente leitura**: pavimento, elemento (grupo) e detalhamento são derivados em tempo de leitura de `project.hierarchy` (`drawingHierarchyContext`), sem duplicação nos dados do desenho. Renomear pavimento, grupo ou detalhamento atualiza imediatamente a exibição sem alterar os metadados do desenho.

## Fluxo de edição, histórico e segurança de contexto

- **Acesso**: disponível na árvore da aba **Projeto** (botão **Propriedades do desenho** na linha do detalhamento com desenho único ou em cada desenho filho quando há múltiplos desenhos) e no contexto do desenho ativo (barra **Edição isolada** e cartão da aba **Propriedades**).
- **Transação e cancelamento**: abrir o painel, editar rascunhos ou cancelar (**Cancelar**, **×** ou `Esc`) não altera o projeto nem grava histórico. Confirmar (**Salvar**) valida os campos e aplica uma única operação atômica desfazível/refazível (`Ctrl+Z` / `Ctrl+Y`), inclusive dentro da aba isolada do próprio desenho.
- **Troca ou exclusão de contexto**: trocar de aba/desenho, mudar de detalhamento ativo, substituir o projeto ou excluir o desenho durante a edição descarta imediatamente o rascunho pendente, impedindo aplicar dados ao desenho errado. Caso o desenho seja alterado externamente, o formulário marca o rascunho como desatualizado e bloqueia a submissão.

## Persistência, compatibilidade, duplicação e transferência

- **Schema `armadurastruct/26`**: arquivos `armadurastruct/1` a `armadurastruct/25` abrem normalmente e migram para `armadurastruct/26` mantendo `author`, `date` e `notes` ausentes (`undefined`), sem exigir preenchimento nem inventar valores. Arquivos de versões anteriores que contenham esses campos são rejeitados explicitamente. Autosave e recuperação local preservam integralmente os metadados.
- **Duplicação de desenho (`duplicateDrawing`)**: cria um novo `DetailDrawing` no mesmo `detailId` com `id` exclusivo, título `<título> (cópia)` (respeitando 100 caracteres), cópia independente de `author`, `date` e `notes` e clonagem profunda (`structuredClone`) do contexto de layers/visibilidade `drawing:<id>` quando existente, sem duplicar aço ou vistas e sem compartilhar objetos mutáveis.
- **Duplicação de folhas/vistas (`duplicateSheet`, `duplicatePlacement`)**: cria novos IDs apenas para folha/posicionamento e mantém `drawingId` apontando para o mesmo desenho.
- **Reunião de repetições (`previewMergeRepetitions`)**: reassocia desenhos dos detalhamentos absorvidos ao detalhamento representante mantendo o `id` e os metadados próprios de cada desenho em objetos independentes.
- **Transferência de detalhamento (`previewDetailTransfer`)**:
  - Em `mode: 'insert'`, clona todos os desenhos do detalhamento de origem para o novo `detailId`, gerando novos IDs sem colisão e preservando `name`, `author`, `date` e `notes` sem compartilhar referências mutáveis.
  - Em `mode: 'replace'`, preserva os desenhos locais do destino (IDs, vistas em pranchas e metadados documentais locais), evitando sobrescrever autoria local durante revisões geométricas/físicas.

## Limites desta entrega

Esta entrega não implementa controle de revisões por desenho, status de desenvolvimento, campos personalizados genéricos, preenchimento automático de selos/carimbos nem inclusão automática dos novos metadados em pranchas, PDF, DXF ou CSV. Geometria, armaduras, vínculos, relação de aço e quantitativos permanecem inalterados.
