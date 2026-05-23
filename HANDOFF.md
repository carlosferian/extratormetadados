# Documento de Handoff — Extrator de Metadados TRE-PR

Este documento apresenta o conceito geral, a arquitetura técnica, as estratégias de resiliência e as instruções para testes futuros do **Extrator de Metadados do TRE-PR**.

---

## 🌟 1. Conceito Geral do Projeto

O **Extrator de Metadados** é uma ferramenta desenvolvida sobre a tecnologia **Google Apps Script** integrada com modelos avançados de Inteligência Artificial (como o **Google Gemini 2.5**). 

Seu objetivo principal é automatizar a identificação, enriquecimento e organização de metadados padrão **Dublin Core** a partir de documentos digitalizados (scans), PDFs nativos, imagens e outros formatos, armazenados no Google Drive institucional do TRE-PR. 

Esses metadados estruturados são essenciais para alimentar o pipeline de preservação digital de longo prazo do sistema **Archivematica** no Tribunal Regional Eleitoral do Paraná, garantindo a integridade, indexabilidade e conformidade histórica do acervo digitalizado.

---

## 🛠️ 2. Arquitetura do Sistema

O projeto é dividido em módulos modulares e de responsabilidade única na pasta `src/`:

```text
E:\cursos\extratormetadados\extratormetadados\src
├── ApiClient.js      # Gerencia chamadas HTTP aos provedores de IA (Gemini, OpenAI, OpenRouter, Ollama)
├── Export.js          # Gera e exporta o CSV formatado de acordo com as especificações do Archivematica
├── Gemini.js          # Configurações brutas auxiliares
├── Interface.html     # Painel visual (Web App / Sidebar) com layout reativo premium em duas colunas
├── Listing.js         # Realiza a listagem recursiva e mapeamento de arquivos e subpastas no Drive
├── Main.js            # Ponto de entrada, manipulação de configurações e rotas expostas do Web App
├── Process.js         # Orquestra o fluxo de leitura, prompt engineering, envio para a IA e gravação
└── Spreadsheet.js     # Gerencia a criação, leitura e edição em lote da planilha "metadata"
```

---

## 🎨 3. UI/UX: Painel Interativo de Duas Colunas

A interface foi projetada para se comportar de forma inteligente dependendo do contexto de exibição:

* **Modo Web App (Tela Cheia no Navegador)**: Divide-se majestosamente em duas colunas:
  * **Coluna Esquerda (340px)**: Configurações do diretório e provedores de IA, Card Reativo de progresso, Stepper Visual dinâmico (Etapas 1 a 4), Mini-Dashboard de contagem e estimativa reativa de tempo restante, além dos logs técnicos colapsáveis.
  * **Coluna Direita (Projeção)**: Uma tabela rica interativa integrada com a planilha `metadata`. Conta com caixa de pesquisa de arquivo instantânea, contador de seleção, checkboxes e botões de ação em massa (como marcar/desmarcar itens para o repositório).
* **Modo Sidebar (Barra Lateral no Sheets - 300px)**: O CSS Grid empilha a tabela interativa abaixo do painel de controle de forma totalmente fluida, mantendo a operabilidade integral da ferramenta.

---

## 🛡️ 4. Estratégias de Resiliência e Gestão de Limites do Apps Script

Para garantir que o script processe lotes gigantes de arquivos e arquivos pesados (até 50MB) sem travar ou estourar as quotas restritas do Google Workspace, foram aplicadas as seguintes engenharias:

1. **Gestão Segura de Memória (RAM)**:
   * Evita carregar arquivos inteiros na memória via `blob.getBytes()` (o que causa travamento em arquivos maiores de 8MB devido ao teto de 50MB de RAM do Apps Script).
   * **Fluxo de Leitura Resiliente**:
     * **Arquivos < 8MB**: Processados normalmente via conversão direta Base64 para multimodalidade da IA.
     * **Arquivos 8MB - 20MB**: Convertidos em nuvem para documento textual (OCR usando Drive API) e enviados apenas como texto, mantendo o consumo de memória estável.
     * **Arquivos > 20MB ou Não Suportados**: Enviados à IA sem conteúdo binário (`type: none`). A IA é induzida pelo prompt robusto a inferir metadados e datas baseando-se estritamente no nome rico e estruturado do arquivo.
2. **Blindagem contra Erros 404 (Auto-Migração)**:
   * A API do Gemini removeu versões legadas (como `1.5-flash` e `2.0-flash`).
   * Adicionamos um interceptor automático no backend que detecta o uso de modelos antigos nas configurações salvas do usuário e os redireciona imediatamente para o modelo estável mais recente **`gemini-2.5-flash`**.
3. **Persistência de Fila (Checkpointing)**:
   * A listagem recursiva e o processamento em lote salvam o progresso a cada arquivo no cache e propriedades (`CacheService` / `PropertiesService`). 
   * Se o script for interrompido pelo limite de 6 minutos de execução do Google, o progresso é salvo e o usuário pode continuar exatamente de onde parou.

---

## 🚀 5. Pipeline de CI/CD (GitHub Actions ➔ CLASP)

O deploy do sistema está 100% automatizado:
* Sempre que uma alteração é integrada, a GitHub Actions lê as credenciais seguras do arquivo `.clasprc.json` (salvo na variável de ambiente `CLASPRC_JSON` da organização) e executa o empurrão automático do código direto para o script hospedado no Google Cloud do TRE-PR usando o CLI **`@google/clasp`**.

---

## 🧪 6. Roteiro para Testes e Evoluções Futuras

Quando formos retomar o progresso no futuro, aqui está a trilha de testes recomendada:

1. **Teste E2E de OCR em PDF Escaneado**:
   * Colocar um PDF escaneado pesado (entre 10MB e 18MB) na pasta de leitura.
   * Selecioná-lo na tabela da UI e rodar "Descrever com IA".
   * Verificar nos logs se a conversão OCR ocorreu e se a data interna foi extraída corretamente.
2. **Teste de Ação em Lote**:
   * Marcar 5 itens na tabela visual, clicar em `Marcar como NÃO` e verificar se a planilha atualiza instantaneamente a coluna `repositório`.
3. **Validação de CSV**:
   * Rodar o lote completo, clicar em `Exportar CSV` e validar se o arquivo baixado está no formato idêntico ao exigido pelo Archivematica.
