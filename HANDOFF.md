# Handoff — Extrator de Metadados TRE-PR

> **Para o próximo Claude:** leia este arquivo inteiro antes de tocar em qualquer código. Ele substitui a leitura dos arquivos-fonte na maioria dos casos.

---

## 1. O que é o sistema

Google Apps Script vinculado a uma planilha Google Sheets. Escaneie pastas do Google Drive, gere metadados Dublin Core via IA e exporte `metadata.csv` no padrão Archivematica (TRE-PR).

**Script ID:** `1dB9_r9R2N3UZAjrYW5UAlKd5I8zl-9hO5H0d3FwFEif-81Urv83WUkQV`

**Branch ativo:** `claude/jolly-hopper-FUwf4` (trabalho mais recente; não houve merge para main ainda)

**Branch anterior:** `claude/cool-wozniak-3iO70` (base do PR #1)

---

## 2. Arquitetura de arquivos (`src/`)

| Arquivo | Responsabilidade resumida |
|---|---|
| `Main.js` | `onOpen`, `showSidebar`, `doGet`, settings (get/save), bridge functions para o sidebar |
| `Spreadsheet.js` | `REQUIRED_HEADERS`, `COL` map, `ensureHeaders`, `getActiveMetadataSheet`, `getSpreadsheetRows`, `updateRowsRepository` |
| `Listing.js` | Listagem recursiva folder-by-folder com cache chunked de IDs |
| `Process.js` | Processamento IA linha a linha com cache de fila |
| `ApiClient.js` | Roteador multi-provedor (Gemini/OpenAI/OpenRouter/Ollama), OCR, conteúdo de arquivo |
| `Export.js` | Geração do `metadata.csv` para Archivematica |
| `Interface.html` | Sidebar completa — HTML/CSS/JS, sem dependências externas além da fonte Inter |
| `appsscript.json` | Manifest: Drive API v2, timezone SP, runtime V8 |
| `Gemini.js` | **OBSOLETO** — 57 bytes, pode ser deletado |

---

## 3. Planilha de metadados — colunas (0-based)

```
COL = {
  repository:  0,   // "SIM" para processar com IA
  source:      1,   // URL do arquivo no Drive
  title:       2,   // dc.title — gerado pela IA
  creator:     3,   // dc.creator — dono do arquivo
  subject1:    4,   // dc.subject — Evento (IA)
  subject2:    5,   // dc.subject — Tags (IA)
  subject3:    6,   // dc.subject — reservado
  description: 7,   // dc.description — gerado pela IA
  publisher:   8,   // dc.publisher — manual
  contributor: 9,   // dc.contributor — "provider:modelo"
  date:        10,  // dc.date — manual
  format:      11,  // dc.format — MIME type
  identifier:  12,  // dc.identifier — File ID do Drive
  filename:    13,  // filename — path relativo à raiz
  language:    14,  // dc.language — manual
  relation:    15,  // dc.relation — manual
  coverage:    16,  // dc.coverage — manual
  rights:      17,  // dc.rights — manual
  provenance:  18,  // dcterms:provenance — digitalizador ou "Nato-digital"
  processId:   19   // dc.identifier (2º) — número processo/protocolo
}
```

---

## 4. Fluxo de dados

```
startListingSession(url)           → getFolderIdFromInput → initListing(folderId)
  initListing: abre/cria planilha "metadata" na pasta; lê todos os IDs existentes
               da coluna 12 (identifier) em uma única query; salva em cache chunked
               (lid_0, lid_1…); estado da fila em 'listingState'
  listingStep (loop): carrega IDs do cache → lista arquivos da pasta → escreve
               batch (um setValues por pasta) → atualiza cache de IDs

startProcessingSession(force, rows) → initProcessing: monta fila de rowNums no cache
  processingStep(settingsJson):      um arquivo por chamada
    → getFileContent (ApiClient)     → callAI → extractListFromResponse
    → setValues na linha da planilha → retorna result.done = false até zerar fila

exportCsvForArchivematica():         lê planilha, filtra SIM, escreve metadata.csv
                                     na mesma pasta da planilha, retorna URL
```

---

## 5. Cache keys e ciclo de vida

| Chave | Conteúdo | TTL |
|---|---|---|
| `listingState` | `{folderQueue, processedCount, newCount, folderCount}` | 6 h |
| `lid_count` | número de chunks de IDs | 6 h |
| `lid_0`, `lid_1`… | IDs existentes em chunks de 90 KB (separador `\n`) | 6 h |
| `processingState` | `{rows, totalRows, processedCount, skippedCount, forceReprocess}` | 6 h |

**PropertiesService.getUserProperties:**
- `activeSpreadsheetId` — ID da planilha metadata ativa
- `activeFolderId` — ID da pasta raiz
- `provider`, `geminiApiKey`, `geminiModel`, `openaiApiKey`, `openaiModel`, `openrouterApiKey`, `openrouterModel`, `ollamaUrl`, `ollamaModel`

---

## 6. Funções públicas expostas ao sidebar (`google.script.run`)

Definidas em `Main.js` (bridge) ou diretamente nos módulos (GAS compartilha escopo global):

```
getSettings()                      → objeto com todas as configurações de IA
saveSettings(settings)             → salva em UserProperties; retorna string
getCurrentFolderUrl()              → URL da pasta da planilha ativa
getFolderIdFromInput(input)        → extrai ID de URL ou string raw
hasImages()                        → {hasImages, count} — conta imagens na planilha
startListingSession(urlOrId)       → initListing; retorna primeiro resultado
listingStep()                      → processa uma pasta; retorna {done,message,processedCount,newCount,folderCount,remaining}
cancelListing()                    → limpa 'listingState' e chunks lid_*
checkListingState()                → null ou {foldersRemaining,processedCount,newCount,folderCount}
resumeListingSession()             → retoma fila existente; mesmo formato de listingStep
startProcessingSession(force,rows) → initProcessing; retorna {done,message,total,processedCount,analyzingNext}
processingStep(settingsJson)       → processa uma linha; retorna {done,messages[],analyzingNext,processedCount,skippedCount,total}
cancelProcessing()                 → limpa 'processingState'
exportCsvForArchivematica()        → retorna URL do arquivo CSV gerado
getSpreadsheetRows()               → array de {rowNum,repository,identifier,filename,title,date,format,status}
updateRowsRepository(rowNums,val)  → escreve "SIM"/"NÃO" nas linhas indicadas
```

---

## 7. Interface.html — estrutura e lógica JS

**Layout:** duas colunas (left-panel 340px + right-panel flex) colapsam para coluna única em < 820px.

**Estado global JS:**
```javascript
appState = 'idle' | 'listing' | 'processing'
tableRowsData = []   // cache local das linhas para filtragem sem ir ao servidor
startTime = null     // para cálculo de tempo restante
```

**Fluxo de controle:**
- `setBusy(action)` → desabilita os 3 botões de ação; habilita/estiliza cancelar com texto específico
- `setIdle()` → reabilita botões; desabilita cancelar (sempre visível, nunca `display:none`)
- `cancelAction()` → muda `appState='idle'` **imediatamente** (para o loop de callbacks); depois chama o backend para limpar cache
- `checkListingResume()` → chamado no `DOMContentLoaded`; exibe banner amarelo se `checkListingState()` retornar estado pendente

**Loops assíncronos:**
- `nextListingStep()` → chama `listingStep()` recursivamente enquanto `appState === 'listing'` e `!result.done`
- `nextProcessingStep(settings, total)` → chama `processingStep()` recursivamente enquanto `appState === 'processing'` e `!result.done`

**Tabela interativa:** renderizada localmente a partir de `tableRowsData`; `filterTable()` refiltra sem chamada ao servidor; `bulkToggleRepository()` chama `updateRowsRepository(rowNums, val)` e depois `refreshTableData()`.

---

## 8. ApiClient.js — lógica de conteúdo e multimodalidade

```
getFileContent(fileId, mimeType):
  imagem:   blob.getBytes() → base64 (se < 8 MB) ou OCR via Drive API (8-20 MB) ou {type:'none'} (> 20 MB)
  PDF:      exportLinks para texto → extractPdfText via Drive OCR (Cloud Vision) → texto plano
  texto/doc: exportLinks para 'text/plain' → string (max 50 KB)
  outros:   {type: 'none'}

isMultimodal(provider, model): retorna true se o modelo suporta imagens
  gemini: sempre true
  openai: lista de prefixos (gpt-4o, gpt-4-turbo, gpt-4-vision)
  openrouter: lista de padrões (vision, claude-3, gpt-4o, gemini)
  ollama: lista (llava, bakllava, moondream)

callAI(settings, prompt, fileId, mimeType):
  → callGemini / callOpenAI / callOpenRouter / callOllama
  → retorna string com resposta ou 'SKIP_LINE'

callGemini: retry automático com backoff em 429/503
```

---

## 9. Process.js — prompt e parse

**Prompt gerado por `buildPrompt(fileName, mimeType)`:**
Contexto de arquivista TRE-PR; instrução específica por tipo (imagem/PDF/texto); formato de resposta obrigatório:
```
[Título; Evento/Assunto; Palavras-chave; Descrição; Número de processo ou N/A]
```

**`extractListFromResponse(response)`:** tenta separar por `;`, depois `|`, depois newline. Retorna array de 5 strings. Falha silenciosa → array vazio → linha marcada como skipped.

**`initProcessing` respeita:**
- Se `selectedRowNums` fornecido → processa apenas essas linhas (independente de "SIM")
- Se não → apenas linhas com `repository === 'SIM'`
- Se não `forceReprocess` → pula linhas que já têm `title + subject1 + subject2 + description + date`
- Nunca reprocessa linhas com `title` iniciando em "Arquivo ignorado", "Modelo não suporta", "Erro" (salvo forceReprocess)

---

## 10. Export.js

Lê planilha ativa; filtra linhas com `repository === 'SIM'`; adiciona prefixo `objects/` ao `filename`; escapa aspas; escreve `metadata.csv` na pasta da planilha via `DriveApp.createFile`; retorna URL do arquivo.

Colunas exportadas na ordem: `filename` primeiro, depois os 19 headers Dublin Core.

---

## 11. Deploy

**Automático via GitHub Actions** (`.github/workflows/deploy.yml`): push em qualquer branch `claude/**` → clasp 2.5.0 → push para Apps Script usando secret `CLASPRC_JSON`.

**Manual:** copiar conteúdo de cada `src/*.js` e `src/Interface.html` diretamente no editor em script.google.com.

---

## 12. O que foi feito na sessão de 2026-05-26

### Problema 1 — Cancelar a qualquer momento
**Antes:** botão Cancelar ficava oculto (`display:none`) e só aparecia durante operações.  
**Depois:** botão sempre visível; cinza+desabilitado quando ocioso; vermelho+habilitado durante operações com texto dinâmico ("Parar Listagem" / "Parar IA"). `cancelAction()` muda `appState='idle'` imediatamente para parar o loop de callbacks antes mesmo da resposta do servidor.

### Problema 2 — Retomar listagem interrompida
**Novo:** `checkListingState()` verifica o cache ao abrir o painel; se houver estado pendente, exibe banner amarelo com contagens e botões "↩ Retomar" / "Ignorar". `resumeListingSession()` continua de onde parou. Se a pasta já tem metadata preenchida, a mensagem de init mostra "X arquivo(s) já catalogados. Buscando novos em: [pasta]".

### Problema 3 — Escala para 3000+ itens
**Antes:** `listingStep()` re-lia a coluna `identifier` inteira a cada passo + um `setValues()` por arquivo.  
**Depois:**
- IDs lidos **uma vez** em `initListing()` e armazenados em cache chunked (`lid_0`, `lid_1`…, max 90 KB por chunk, separados por `\n`)
- Funções auxiliares: `_cacheStoreIds(arr)`, `_cacheLoadIds(sheet)` (com fallback para planilha se cache expirar), `_cacheClearIds()`
- `listingStep()` coleta todos os arquivos novos da pasta em `newRows[]`, então faz **um único `setValues()`** para a pasta inteira → ~30× mais rápido
- `cancelListing()` agora também limpa os chunks `lid_*`

### Arquivos alterados
- `src/Listing.js` — reescrito quase por completo
- `src/Interface.html` — reescrito quase por completo
- `src/Main.js` — linha em branco removida (sem mudança funcional)

**PR:** https://github.com/carlosferian/extratormetadados/pull/1 (base: `claude/cool-wozniak-3iO70`)

---

## 13. Pendências e próximas melhorias

### Técnicas obrigatórias
- [ ] **Deletar `src/Gemini.js`** — obsoleto, 57 bytes, nunca incluído no deploy
- [ ] **Fazer merge** do PR #1 para o branch base quando validado

### Funcionais sugeridas
- [ ] `dc.date` preenchido automaticamente com `file.getDateCreated()` na listagem
- [ ] Paginação na listagem de arquivos por pasta (Drive API tem limite de iteração, pode pausar em pastas com >1000 arquivos em uma única chamada)
- [ ] Exportar apenas linhas selecionadas (não só as marcadas SIM)
- [ ] Validação antes de exportar: alertar se há linhas SIM sem `filename`
- [ ] Campo de filtro por tipo de arquivo na listagem (só imagens, só PDFs etc.)
- [ ] `updateRowsRepository` usa um `setValue` por linha em loop — mudar para batch com `setValues` único (igual ao que foi feito para a listagem)

### CI/CD
- [ ] Secret `CLASPRC_JSON` expira se o refresh token for revogado — re-autenticar com `clasp login` local e atualizar o secret no GitHub se o deploy automático parar de funcionar
