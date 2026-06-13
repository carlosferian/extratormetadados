function initProcessing(forceReprocess = false, selectedRowNums = null) {
  const sheet = getActiveMetadataSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return { done: true, message: '✅ Nada a processar.', total: 0, processedCount: 0 };
  }

  // Se selectedRowNums vier em formato string (JSON), faz o parse
  if (typeof selectedRowNums === 'string') {
    try {
      selectedRowNums = JSON.parse(selectedRowNums);
    } catch (_) {}
  }

  const data = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();
  const rows = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    // Se selectedRowNums estiver definido, processa Apenas as linhas contidas no array
    if (selectedRowNums && selectedRowNums.indexOf(rowNum) === -1) continue;

    const repository = (row[COL.repository] || '').toString().trim().toUpperCase();
    const identifier = (row[COL.identifier] || '').toString().trim();
    const title = (row[COL.title] || '').toString().trim();
    const subject1 = (row[COL.subject1] || '').toString().trim();
    const subject2 = (row[COL.subject2] || '').toString().trim();
    const description = (row[COL.description] || '').toString().trim();
    const date = (row[COL.date] || '').toString().trim();

    // Se o usuário selecionou as linhas explicitamente na interface, nós as processamos
    // sem exigir 'SIM' (pois a seleção explícita já demonstra intenção),
    // mas se não houver seleção explícita, exigimos repository === 'SIM'.
    if (!selectedRowNums && repository !== 'SIM') continue;
    if (!identifier) continue;

    const needsProcessing = forceReprocess || !title || !subject1 || !subject2 || !description || !date;
    if (!needsProcessing) continue;

    if (!forceReprocess && (title.startsWith('Arquivo ignorado') || title.startsWith('Modelo não suporta') || title.startsWith('Erro'))) continue;

    const filename = (row[COL.filename] || '').toString().trim().split('/').pop() || ('Linha ' + rowNum);
    rows.push({ rowNum, filename });
  }

  const N = rows.length;
  const state = {
    rows,
    totalRows: N,
    processedCount: 0,
    skippedCount: 0,
    forceReprocess: forceReprocess
  };

  CacheService.getUserCache().put('processingState', JSON.stringify(state), 21600);

  return {
    done: N === 0,
    message: N === 0 ? '✅ Nada a processar.' : '🤖 ' + N + ' linha(s) para processar.',
    analyzingNext: N > 0 ? rows[0].filename : null,
    total: N,
    processedCount: 0
  };
}

function processingStep(settingsJson) {
  const settings = JSON.parse(settingsJson);
  const cache = CacheService.getUserCache();
  const raw = cache.get('processingState');

  if (!raw) {
    return { done: true, message: '✅ Processamento concluído.', processedCount: 0, skippedCount: 0, total: 0 };
  }

  const state = JSON.parse(raw);

  if (!state.rows || state.rows.length === 0) {
    cache.remove('processingState');
    return {
      done: true,
      message: '✅ Concluído: ' + state.processedCount + ' processado(s), ' + state.skippedCount + ' ignorado(s).',
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  const item = state.rows.shift();
  const rowNumber = item.rowNum;
  const sheet = getActiveMetadataSheet();
  const rowData = sheet.getRange(rowNumber, 1, 1, REQUIRED_HEADERS.length).getValues()[0];

  const fileId = (rowData[COL.identifier] || '').toString().trim();
  const fileName = (rowData[COL.filename] || '').toString().trim();
  const shortName = item.filename;
  const analyzingNext = state.rows.length > 0 ? state.rows[0].filename : null;

  let file;
  let mimeType;

  try {
    file = DriveApp.getFileById(fileId);
    mimeType = file.getMimeType();
  } catch (e) {
    state.skippedCount++;
    cache.put('processingState', JSON.stringify(state), 21600);
    return {
      done: false,
      messages: [{ text: '⚠ Arquivo não encontrado: ' + shortName, type: 'warning' }],
      analyzingNext,
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  const provider = settings.provider || 'gemini';
  const model = settings.model ||
    settings.geminiModel ||
    settings.openaiModel ||
    settings.openrouterModel ||
    settings.ollamaModel || '';
  const isImage = mimeType && mimeType.startsWith('image/');

  if (isImage && !isMultimodal(provider, model)) {
    sheet.getRange(rowNumber, COL.title + 1).setValue('Modelo não suporta imagens: ' + model);
    SpreadsheetApp.flush();
    state.skippedCount++;
    cache.put('processingState', JSON.stringify(state), 21600);
    return {
      done: false,
      messages: [{ text: '⚠ Modelo não suporta imagens: ' + shortName, type: 'warning' }],
      analyzingNext,
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  const prompt = buildPrompt(fileName, mimeType);
  let response;

  try {
    response = callAI(settings, prompt, fileId, mimeType);
  } catch (e) {
    state.skippedCount++;
    cache.put('processingState', JSON.stringify(state), 21600);
    return {
      done: false,
      messages: [{ text: '❌ Erro em ' + shortName + ': ' + e.message, type: 'error' }],
      analyzingNext,
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  if (response === 'SKIP_LINE') {
    state.skippedCount++;
    cache.put('processingState', JSON.stringify(state), 21600);
    return {
      done: false,
      messages: [{ text: '⏭ Ignorado (arquivo muito grande ou inválido): ' + shortName, type: 'warning' }],
      analyzingNext,
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  const list = extractListFromResponse(response);
  const forceReprocess = !!state.forceReprocess;

  if (list[0]) {
    const range = sheet.getRange(rowNumber, 1, 1, REQUIRED_HEADERS.length);
    const currentValues = range.getValues()[0];

    if (list[0] && (forceReprocess || !currentValues[COL.title]))       currentValues[COL.title]       = list[0];
    if (list[1] && (forceReprocess || !currentValues[COL.subject1]))    currentValues[COL.subject1]    = list[1];
    if (list[2] && (forceReprocess || !currentValues[COL.subject2]))    currentValues[COL.subject2]    = list[2];
    if (list[3] && (forceReprocess || !currentValues[COL.description])) currentValues[COL.description] = list[3];

    currentValues[COL.contributor] = provider + ':' + model;

    const processNum = list[4] && list[4] !== 'N/A' ? list[4] : '';
    if (processNum && (forceReprocess || !currentValues[COL.processId])) {
      currentValues[COL.processId] = processNum;
    }

    range.setValues([currentValues]);
    SpreadsheetApp.flush();
    state.processedCount++;
  } else {
    state.skippedCount++;
  }

  cache.put('processingState', JSON.stringify(state), 21600);

  const processNum = list[4] && list[4] !== 'N/A' ? list[4] : '';
  const msgs = list[0]
    ? [
        { text: '✓ ' + shortName, type: 'success' },
        list[0] ? { text: '  📌 ' + list[0], type: 'normal' } : null,
        list[1] ? { text: '  📅 ' + list[1], type: 'normal' } : null,
        list[2] ? { text: '  🏷️ ' + list[2], type: 'normal' } : null,
        processNum ? { text: '  📎 Processo: ' + processNum, type: 'info' } : null
      ].filter(Boolean)
    : [{ text: '⚠ Resposta inválida da IA: ' + shortName + formatResponseSnippet(response), type: 'warning' }];

  return {
    done: false,
    messages: msgs,
    analyzingNext,
    processedCount: state.processedCount,
    skippedCount: state.skippedCount,
    total: state.totalRows
  };
}

function buildPrompt(fileName, mimeType) {
  const isImage = mimeType && mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const context = 'Você é um arquivista do TRE-PR (Tribunal Regional Eleitoral do Paraná). Analise o arquivo e gere metadados Dublin Core para fins de preservação digital no sistema Archivematica.';

  let instruction;
  if (isImage) {
    instruction = 'Analise a imagem e identifique seu conteúdo visual, contexto eleitoral ou institucional, datas e informações relevantes.';
  } else if (isPdf) {
    instruction = 'Analise o documento PDF, faça a leitura atenta do texto para encontrar datas citadas, cabeçalhos ou rodapés, e identifique seu tipo documental, contexto eleitoral ou institucional e informações relevantes.';
  } else {
    instruction = 'Analise o conteúdo textual do arquivo para encontrar datas citadas e identifique seu tipo documental, contexto eleitoral ou institucional e informações relevantes.';
  }

  const format = [
    'Responda APENAS com uma lista no formato:',
    '[Título; Evento/Assunto; Palavras-chave; Descrição; Número de processo ou protocolo]',
    '',
    'Regras:',
    '- Se o documento for um processo administrativo, judicial ou eleitoral e contiver número de processo, autuação ou protocolo, extraia-o exatamente no 5º campo (ex: 0001234-56.2024.6.16.0000).',
    '- Se não houver número de processo ou protocolo identificável, coloque "N/A" no 5º campo.',
    '',
    'Exemplo com processo:',
    '[Ata de Audiência TRE-PR; Audiência Processual 2024; eleições, audiência, processo; Documento que registra audiência do processo eleitoral.; 0001234-56.2024.6.16.0000]',
    '',
    'Exemplo sem processo:',
    '[Cerimônia de Posse 2024; Posse de Magistrados; posse, magistrado, TRE-PR; Foto da cerimônia de posse de novos magistrados no TRE-PR.; N/A]'
  ].join('\n');

  return context + '\n\n' + instruction + '\n\nNome do arquivo: ' + fileName + '\n\n' + format;
}

function extractListFromResponse(response) {
  if (!response) return [];

  // Prefer text inside [...], fall back to full response
  const bracketMatch = response.match(/\[([^\]]+)\]/s);
  const candidates = bracketMatch ? [bracketMatch[1], response] : [response];

  // Try separators in preference order: semicolon → pipe → newline
  const separators = [';', '|', /\r?\n+/];

  for (const text of candidates) {
    for (const sep of separators) {
      const parts = text.split(sep).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        while (parts.length < 5) parts.push('');
        return parts.slice(0, 5);
      }
    }
  }

  return [];
}

// Gera um trecho curto e seguro (HTML-escapado) da resposta crua da IA para exibir no log
// quando extractListFromResponse() falha, ajudando a diagnosticar o que a IA retornou.
function formatResponseSnippet(response, maxLen) {
  if (!response) return '';
  maxLen = maxLen || 120;

  let cleaned = response.toString().replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length > maxLen) cleaned = cleaned.substring(0, maxLen) + '...';

  cleaned = cleaned.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return ' — Resposta: "' + cleaned + '"';
}

function cancelProcessing() {
  CacheService.getUserCache().remove('processingState');
  return 'Processamento cancelado.';
}
