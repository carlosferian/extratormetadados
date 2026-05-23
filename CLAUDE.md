# Extrator de Metadados — TRE-PR

Ferramenta Google Apps Script para extração, descrição por IA e exportação de metadados Dublin Core de acervos no Google Drive, com saída no formato Archivematica.

---

## Contexto do projeto

O Tribunal Regional Eleitoral do Paraná (TRE-PR) precisa catalogar documentos (fotos, PDFs, textos) armazenados no Google Drive e exportá-los como `metadata.csv` para ingestão no sistema Archivematica. A ferramenta roda como script vinculado a uma planilha Google Sheets e expõe uma sidebar HTML com interface completa.

---

## Estado atual (última sessão)

### O que está funcionando
- **Sidebar completa** com accordion de configurações, log em tempo real e barra de progresso
- **Listagem folder-by-folder** via CacheService (não bloqueia, processa uma pasta por chamada)
- **Processamento de IA por passos** — uma linha por chamada, com feedback visual a cada arquivo
- **Múltiplos provedores de IA**: Gemini, OpenAI, OpenRouter, Ollama
- **Detecção de multimodalidade** com aviso quando modelo não suporta imagens
- **Suporte a imagens, PDFs e texto** em todos os provedores que suportam
- **Exportação metadata.csv** no padrão Archivematica (`filename` primeiro, paths com `objects/`)
- **Log detalhado**: mostra `🔍 Analisando: arquivo.jpg...` antes da IA e `📌 Título / 📅 Evento / 🏷️ Tags` após

### O que ainda não está resolvido
- **Deploy automático via GitHub Actions**: as credenciais OAuth nunca funcionaram corretamente. O workflow `.github/workflows/deploy.yml` existe, mas o deploy para o Apps Script falha com `unauthorized_client`. A causa provável é que a Apps Script API exige OAuth de usuário (não service account) e o refresh token gerado via OAuth Playground não está sendo aceito. **Alternativa**: fazer deploy manual colando o código direto no Apps Script até resolver.
- `src/Gemini.js` ainda existe no repositório mas **não é incluído no deploy** (`deploy.js` não o lista). Pode ser removido na próxima sessão.

---

## Arquitetura dos arquivos

```
extratormetadados/
├── src/
│   ├── appsscript.json    — manifest: timezone SP, Drive API v2, V8
│   ├── Main.js            — onOpen(), showSidebar(), settings, bridge functions
│   ├── Spreadsheet.js     — REQUIRED_HEADERS, COL map, ensureHeaders()
│   ├── Listing.js         — initListing(), listingStep(), cancelListing()
│   ├── Process.js         — initProcessing(), processingStep(), buildPrompt(), extractListFromResponse()
│   ├── ApiClient.js       — callAI(), callGemini/OpenAI/OpenRouter/Ollama(), isMultimodal(), getFileContent(), extractPdfText()
│   ├── Export.js          — exportCsvForArchivematica()
│   ├── Interface.html     — sidebar completa (HTML/CSS/JS)
│   └── Gemini.js          — OBSOLETO, não incluído no deploy, pode ser removido
├── deploy.js              — script Node.js que usa googleapis para fazer push ao Apps Script
├── package.json / package-lock.json
└── .github/workflows/deploy.yml — workflow de deploy automático (com problema de credenciais)
```

---

## Estrutura da planilha (colunas, 0-based)

| Índice | Header | Descrição |
|--------|--------|-----------|
| 0 | repositório | "SIM" para processar com IA |
| 1 | dc.source | URL do arquivo no Drive |
| 2 | dc.title | Título gerado pela IA |
| 3 | dc.creator | Dono do arquivo |
| 4 | dc.subject | Evento (gerado pela IA) |
| 5 | dc.subject | Tags (gerado pela IA) |
| 6 | dc.subject | (reservado) |
| 7 | dc.description | Descrição detalhada gerada pela IA |
| 8 | dc.publisher | (preenchimento manual) |
| 9 | dc.contributor | Provider:modelo usado (ex: `gemini:gemini-2.0-flash`) |
| 10 | dc.date | (preenchimento manual) |
| 11 | dc.format | MIME type completo (ex: `image/jpeg`) |
| 12 | dc.identifier | File ID do Google Drive |
| 13 | filename | Caminho relativo à pasta raiz (ex: `Eventos/2024/foto.jpg`) |
| 14 | dc.language | (preenchimento manual) |
| 15 | dc.relation | (preenchimento manual) |
| 16 | dc.coverage | (preenchimento manual) |
| 17 | dc.rights | (preenchimento manual) |
| 18 | dcterms:provenance | Agente de digitalização (empresa/pessoa) ou "Nato-digital" — preenchimento manual |
| 19 | dc.identifier | Número de processo/protocolo jurídico-administrativo — extraído pela IA quando detectado |

O `COL` map em `Spreadsheet.js` é a fonte da verdade para todos os índices.

### Padrão Archivematica (SIP)

Estrutura obrigatória do Submission Information Package:
```
SIP/
├── objects/          ← arquivos a preservar (paths refletidos no filename do CSV)
├── metadata/
│   └── metadata.csv  ← gerado pelo Exportar CSV
└── logs/             ← preenchido pelo Archivematica durante ingestão
```

O `metadata.csv` suporta 15 elementos Dublin Core básicos (`dc.`) e Dublin Core Terms (`dcterms:`). Elementos repetidos (ex: `dc.subject` × 3, `dc.identifier` × 2) são válidos e tratados como valores múltiplos. Campos não-DC são aceitos com `MDTYPE="OTHER"`.

**Decisão de campos:**
- `dcterms:provenance` — cadeia de custódia/digitalizador; semanticamente correto para "quem digitalizou" (Dublin Core Terms)
- Segundo `dc.identifier` — número de processo/protocolo; Dublin Core permite múltiplos identificadores por recurso

---

## Fluxo de uso

1. Abrir a planilha vinculada ao script
2. Menu **Extrator de Metadados → Abrir painel**
3. Colar o link de qualquer planilha/arquivo que esteja na pasta a ser escaneada
4. Clicar **"Listar documentos"** — popula a planilha folder-by-folder com progresso no log
5. Marcar "SIM" na coluna A nas linhas a serem descritas pela IA
6. Configurar o provedor de IA no accordion (salvar configurações)
7. Clicar **"Descrever com IA"** — processa linha a linha exibindo título/evento/tags no log
8. Clicar **"Exportar CSV (Archivematica)"** — gera `metadata.csv` na mesma pasta da planilha

---

## Provedores de IA configurados

| Provider | Campo `model` sugerido | Multimodal (imagens) |
|----------|------------------------|----------------------|
| Gemini | `gemini-2.0-flash` | ✅ todos |
| OpenAI | `gpt-4o` | ✅ gpt-4o, gpt-4o-mini, gpt-4-turbo |
| OpenRouter | `google/gemini-flash-1.5` | depende do modelo |
| Ollama | `llava` | ✅ llava, bakllava, moondream |

As API keys são salvas em `PropertiesService.getUserProperties()` (por usuário, não por script).

---

## Formato do metadata.csv (Archivematica)

- Primeira coluna obrigatoriamente `filename`
- Caminhos no formato `objects/pasta/subpasta/arquivo.ext`
- O script converte automaticamente os caminhos relativos adicionando o prefixo `objects/`
- O arquivo é salvo na mesma pasta do Google Drive onde está a planilha ativa

---

## Deploy manual (enquanto o automático não funciona)

1. Abrir o projeto em [script.google.com](https://script.google.com)
2. Criar/atualizar os arquivos manualmente com o conteúdo de cada `src/*.js` e `src/Interface.html`
3. Salvar e recarregar a planilha

**Script ID do projeto:** `1dB9_r9R2N3UZAjrYW5UAlKd5I8zl-9hO5H0d3FwFEif-81Urv83WUkQV`

---

## Próximas melhorias sugeridas

- [ ] Resolver deploy automático via GitHub Actions (investigar alternativa com token pessoal do GitHub + clasp login via OIDC, ou usar `google-github-actions/auth` com Workload Identity)
- [ ] Remover `src/Gemini.js` (obsoleto)
- [ ] Adicionar campo `dc.date` preenchido automaticamente com a data de criação do arquivo (`file.getDateCreated()`)
- [ ] Suporte a paginação na listagem para evitar timeout em pastas com muitos arquivos
- [ ] Permitir reprocessar linhas já processadas (botão "Forçar reprocessamento")
- [ ] Validação do formato do CSV antes de exportar (verificar se há linhas sem `filename`)
- [ ] Campo de filtro por tipo de arquivo na listagem (ex: listar apenas imagens)
- [ ] Exportar apenas as linhas selecionadas (coluna A = "SIM") no CSV

---

## Branch de desenvolvimento

`claude/cool-wozniak-3iO70` — todos os commits foram feitos neste branch. Ainda não foi feito merge para `main`.
