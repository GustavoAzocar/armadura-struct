# Usar plugins no ArmaduraStruct 0.6.0

Abra a aba Plugins no Ribbon. O gerenciador ocupa a tela somente enquanto aberto;
a consulta não encerra nem altera o comando CAD em andamento.

- Instalar offline: escolha .osplugin, confira autor declarado, versão, origem,
  compatibilidade e permissões. Confirme o registro desativado. É possível cancelar
  a inspeção antes da confirmação. O arquivo deve ser compatível com o host.
- Meus plugins: consulte versões, origem, capacidades e integridade; remova uma
  versão com confirmação. O inventário persiste após reabrir, mesmo sem internet.
  Remover não apaga detalhamentos já existentes.
- Loja online: informe uma URL de catálogo HTTPS e consulte. Não há loja oficial
  configurada. Baixar e inspecionar só prepara o pacote; a confirmação seguinte
  registra. Cancelar, falha de rede ou catálogo vazio não altera projetos.
- Desenvolver plugins: leia/salve o guia e o JSON Schema. Os arquivos públicos,
  exemplos e ferramentas ficam no repositório para qualquer desenvolvedor.

Todos os plugins instalados permanecem desativados: execução de terceiros ainda
não está disponível. Integridade SHA-256 não comprova autoria. As permissões
mostradas são solicitadas pelo pacote e não são concedidas nesta versão.

Estados explícitos: incompatível (API/app/capacidade), indisponível nesta plataforma,
e instalado com execução ainda não suportada. Não há ações de ativar/atualizar.

No navegador ficam disponíveis o guia e os contratos. A inspeção, o catálogo e a
instalação durável usam o aplicativo desktop. Não é preciso internet para editar
o CAD nem para usar a instalação offline no desktop.
