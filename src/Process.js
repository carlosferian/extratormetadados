function initProcessing() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return { done: true, message: '✅ Nada a processar.', total: 0, processedCount: 0 };
  }

  const data = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();
  const rows = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const repository = (row[COL.repository] || '').toString().trim().toUpperCase();
    const identifier = (row[COL.identifier] || '').toString().trim();
    const title = (row[COL.title] || '').toString().trim();
    const subject1 = (row[COL.subject1] || '').toString().trim();
    const subject2 = (row[COL.subject2] || '').toString().trim();
    const description = (row[COL.description] || '').toString().trim();

    if (repository !== 'SIM') continue;
    if (!identifier) continue;

    const needsProcessing = !title || !subject1 || !subject2 || !description;
    if (!needsProcessing) continue;

    if (title.startsWith('Arquivo ignorado') || title.startsWith('Modelo não suporta')) continue;

    rows.push(i + 2);
  }

  const N = rows.length;
  const state = {
    rows,
    totalRows: N,
    processedCount: 0,
    skippedCount: 0
  };

  CacheService.getUserCache().put('processingState', JSON.stringify(state), 21600);

  return {
    done: N === 0,
    message: N === 0 ? '✅ Nada a processar.' : '🤖 ' + N + ' linha(s) para processar.',
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

  const rowNumber = state.rows.shift();
  const sheet = SpreadsheetApp.getActiveSheet();
  const rowData = sheet.getRange(rowNumber, 1, 1, REQUIRED_HEADERS.length).getValues()[0];

  const fileId = (rowData[COL.identifier] || '').toString().trim();
  const fileName = (rowData[COL.filename] || '').toString().trim();

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
      message: '⚠ Arquivo não encontrado: ' + fileName,
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  const provider = settings.provider || 'gemini';
  const model = settings.model || settings.geminiModel || settings.openaiModel || settings.openrouterModel || settings.ollamaModel || '';
  const isImage = mimeType && mimeType.startsWith('image/');

  if (isImage && !isMultimodal(provider, model)) {
    sheet.getRange(rowNumber, COL.title + 1).setValue('Modelo não suporta imagens: ' + model);
    SpreadsheetApp.flush();
    state.skippedCount++;
    cache.put('processingState', JSON.stringify(state), 21600);
    return {
      done: false,
      warning: true,
      message: '⚠ Modelo não suporta imagens: ' + fileName,
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
      message: '⚠ Erro ao chamar IA para: ' + fileName + ' — ' + e.message,
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
      message: '⚠ Ignorado (sem resposta): ' + fileName,
      processedCount: state.processedCount,
      skippedCount: state.skippedCount,
      total: state.totalRows
    };
  }

  const list = extractListFromResponse(response);

  if (list.length === 4) {
    const range = sheet.getRange(rowNumber, 1, 1, REQUIRED_HEADERS.length);
    const currentValues = range.getValues()[0];

    if (!currentValues[COL.title]) currentValues[COL.title] = list[0].trim();
    if (!currentValues[COL.subject1]) currentValues[COL.subject1] = list[1].trim();
    if (!currentValues[COL.subject2]) currentValues[COL.subject2] = list[2].trim();
    if (!currentValues[COL.description]) currentValues[COL.description] = list[3].trim();
    currentValues[COL.contributor] = provider + ':' + model;

    range.setValues([currentValues]);
    SpreadsheetApp.flush();
    state.processedCount++;
  } else {
    state.skippedCount++;
  }

  cache.put('processingState', JSON.stringify(state), 21600);

  return {
    done: false,
    message: list.length === 4
      ? '🤖 Processado: ' + fileName
      : '⚠ Resposta inválida: ' + fileName,
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
    instruction = 'Analise a imagem e identifique seu conteúdo visual, contexto eleitoral ou institucional e informações relevantes.';
  } else if (isPdf) {
    instruction = 'Analise o documento PDF e identifique seu conteúdo, tipo documental, contexto eleitoral ou institucional e informações relevantes.';
  } else {
    instruction = 'Analise o conteúdo textual do arquivo e identifique seu tipo documental, contexto eleitoral ou institucional e informações relevantes.';
  }

  const format = 'Responda APENAS com uma lista no formato: [Título; Evento/Assunto; Palavras-chave; Descrição]\n\nExemplo: [Ata de reunião do TRE-PR; Eleições 2024; eleições, ata, reunião; Documento que registra as deliberações da reunião ordinária do Tribunal Regional Eleitoral do Paraná referente ao pleito de 2024.]';

  return context + '\n\n' + instruction + '\n\nNome do arquivo: ' + fileName + '\n\n' + format;
}

function extractListFromResponse(response) {
  if (!response) return [];
  const match = response.match(/\[([^\]]+)\]/);
  if (!match) return [];
  const parts = match[1].split(';');
  if (parts.length !== 4) return [];
  return parts;
}

function cancelProcessing() {
  CacheService.getUserCache().remove('processingState');
  return 'Processamento cancelado.';
}
