function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Extrator de Metadados")
    .addItem("Abrir painel", "showSidebar")
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Interface")
    .setTitle("Extrator de Metadados")
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getCurrentSpreadsheetUrl() {
  return SpreadsheetApp.getActiveSpreadsheet().getUrl();
}

function getFolderIdFromUrl(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("URL inválida. Use o link de uma planilha do Google.");
  const fileId = match[1];
  try {
    const parents = DriveApp.getFileById(fileId).getParents();
    if (!parents.hasNext()) throw new Error("O arquivo não está em nenhuma pasta.");
    return parents.next().getId();
  } catch (e) {
    throw new Error("Não foi possível acessar o arquivo. Verifique as permissões: " + e.message);
  }
}

function runListing(spreadsheetUrl) {
  const folderId = getFolderIdFromUrl(spreadsheetUrl);
  return LISTING(folderId);
}

function runDescription() {
  processSpreadsheetWithGemini();
  return "Descrição com IA concluída.";
}
