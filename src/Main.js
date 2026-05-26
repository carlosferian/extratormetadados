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

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Interface')
    .setTitle('Extrator de Metadados')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  const userProps = PropertiesService.getUserProperties();
  const props = userProps.getProperties();
  
  let geminiModel = props.geminiModel || 'gemini-2.5-flash';
  // Auto-upgrade legacy/deprecated Gemini models to gemini-2.5-flash
  if (geminiModel.indexOf('gemini-1.5-flash') !== -1 || geminiModel.indexOf('gemini-2.0-flash') !== -1) {
    geminiModel = 'gemini-2.5-flash';
    try {
      userProps.setProperty('geminiModel', 'gemini-2.5-flash');
    } catch (e) {
      // Ignore errors during persistent upgrade, but return correct value
    }
  }

  return {
    provider:         props.provider         || 'gemini',
    geminiApiKey:     props.geminiApiKey      || '',
    geminiModel:      geminiModel,
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
  let geminiModel = settings.geminiModel || 'gemini-2.5-flash';
  if (geminiModel.indexOf('gemini-1.5-flash') !== -1 || geminiModel.indexOf('gemini-2.0-flash') !== -1) {
    geminiModel = 'gemini-2.5-flash';
  }

  props.setProperties({
    provider:         settings.provider         || 'gemini',
    geminiApiKey:     settings.geminiApiKey      || '',
    geminiModel:      geminiModel,
    openaiApiKey:     settings.openaiApiKey      || '',
    openaiModel:      settings.openaiModel       || 'gpt-4o',
    openrouterApiKey: settings.openrouterApiKey  || '',
    openrouterModel:  settings.openrouterModel   || 'google/gemini-flash-1.5',
    ollamaUrl:        settings.ollamaUrl         || 'http://localhost:11434',
    ollamaModel:      settings.ollamaModel       || 'llava'
  });
  return 'Configurações salvas.';
}

function getCurrentFolderUrl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Como o painel está aberto em aba cheia (Web App), não há uma planilha ativa no navegador para detectar a pasta. Por favor, cole o link ou ID da pasta do Google Drive diretamente no campo de texto.");
  }
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  if (parents.hasNext()) {
    return parents.next().getUrl();
  }
  throw new Error("Esta planilha não está em nenhuma pasta.");
}

function getFolderIdFromInput(input) {
  if (!input) throw new Error('Caminho inválido. Forneça o link ou ID da pasta do Google Drive.');
  
  // Procura pelo ID da pasta em URLs típicos do Google Drive
  const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  
  // Se for um ID bruto (sem barras), retorna o próprio valor sanitizado
  if (!input.includes('/')) return input.trim();
  
  throw new Error('Formato de pasta inválido. Use o link completo da pasta ou seu ID.');
}

function hasImages() {
  const sheet = getActiveMetadataSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { hasImages: false, count: 0 };

  const formats = sheet.getRange(2, COL.format + 1, lastRow - 1, 1).getValues();
  let count = 0;
  formats.forEach(row => {
    if ((row[0] || '').toString().startsWith('image/')) count++;
  });
  return { hasImages: count > 0, count };
}

function startListingSession(folderUrlOrId) {
  const folderId = getFolderIdFromInput(folderUrlOrId);
  return initListing(folderId);
}

function startProcessingSession(forceReprocess = false, selectedRowNums = null) {
  return initProcessing(forceReprocess, selectedRowNums);
}

