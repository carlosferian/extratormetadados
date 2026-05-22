function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Extrator de Metadados')
    .addItem('Abrir painel', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Interface')
    .setTitle('Extrator de Metadados')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getCurrentSpreadsheetUrl() {
  return SpreadsheetApp.getActiveSpreadsheet().getUrl();
}

function getFolderIdFromUrl(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('URL inválida. Use o link de uma planilha do Google.');
  const fileId = match[1];
  try {
    const parents = DriveApp.getFileById(fileId).getParents();
    if (!parents.hasNext()) throw new Error('O arquivo não está em nenhuma pasta.');
    return parents.next().getId();
  } catch (e) {
    throw new Error('Não foi possível acessar o arquivo. Verifique as permissões: ' + e.message);
  }
}

function getSettings() {
  const props = PropertiesService.getUserProperties().getProperties();
  return {
    provider:         props.provider         || 'gemini',
    geminiApiKey:     props.geminiApiKey      || '',
    geminiModel:      props.geminiModel       || 'gemini-2.0-flash',
    openaiApiKey:     props.openaiApiKey      || '',
    openaiModel:      props.openaiModel       || 'gpt-4o',
    openrouterApiKey: props.openrouterApiKey  || '',
    openrouterModel:  props.openrouterModel   || 'google/gemini-flash-1.5',
    ollamaUrl:        props.ollamaUrl         || 'http://localhost:11434',
    ollamaModel:      props.ollamaModel       || 'llava'
  };
}

function saveSettings(settings) {
  const props = PropertiesService.getUserProperties();
  props.setProperties({
    provider:         settings.provider         || 'gemini',
    geminiApiKey:     settings.geminiApiKey      || '',
    geminiModel:      settings.geminiModel       || 'gemini-2.0-flash',
    openaiApiKey:     settings.openaiApiKey      || '',
    openaiModel:      settings.openaiModel       || 'gpt-4o',
    openrouterApiKey: settings.openrouterApiKey  || '',
    openrouterModel:  settings.openrouterModel   || 'google/gemini-flash-1.5',
    ollamaUrl:        settings.ollamaUrl         || 'http://localhost:11434',
    ollamaModel:      settings.ollamaModel       || 'llava'
  });
  return 'Configurações salvas.';
}

function hasImages() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { hasImages: false, count: 0 };

  const formats = sheet.getRange(2, COL.format + 1, lastRow - 1, 1).getValues();
  let count = 0;
  formats.forEach(row => {
    if ((row[0] || '').toString().startsWith('image/')) count++;
  });
  return { hasImages: count > 0, count };
}

function startListingSession(spreadsheetUrl) {
  const folderId = getFolderIdFromUrl(spreadsheetUrl);
  return initListing(folderId);
}

function startProcessingSession() {
  return initProcessing();
}
