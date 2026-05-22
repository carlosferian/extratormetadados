function LISTING() {
  let rootFolder;
  try {
    rootFolder = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents().next();
  } catch (e) {
    Logger.log("Erro ao acessar a pasta raiz: " + e.message);
    throw new Error("Não foi possível acessar a pasta raiz. Verifique se o script tem permissão.");
  }

  let result = [];
  let folderCount = 0;
  let documentCount = 0;
  let processedFileIds = new Set();

  result.push([
    "repositório", "dc.source", "dc.title", "dc.creator", "dc.subject", "dc.subject", "dc.subject",
    "dc.description", "dc.publisher", "dc.contributor", "dc.date", "dc.format",
    "dc.identifier", "filename", "dc.language", "dc.relation", "dc.coverage", "dc.rights"
  ]);

  let sheet = SpreadsheetApp.getActiveSheet();
  let lastRow = sheet.getLastRow();
  let existingIds = new Set();

  if (lastRow > 1) {
    let idsInSheet = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
    idsInSheet.forEach(row => existingIds.add(row[0]));
  }

  let lastProcessedFileId = PropertiesService.getScriptProperties().getProperty('lastFileId');
  let checkpointReached = !lastProcessedFileId;

  function listFiles(folder, path) {
    try {
      let subfolders = folder.getFolders();
      while (subfolders.hasNext()) {
        let subfolder = subfolders.next();
        let subfolderPath = path + "/" + subfolder.getName();
        folderCount++;

        let files = subfolder.getFiles();
        while (files.hasNext()) {
          let file = files.next();
          let fileId = file.getId();

          if (processedFileIds.has(fileId) || existingIds.has(fileId)) {
            continue;
          }

          if (!checkpointReached) {
            if (fileId === lastProcessedFileId) {
              checkpointReached = true;
            }
            continue;
          }

          let fileName = subfolderPath + "/" + file.getName();
          documentCount++;
          let creator = file.getOwner() ? file.getOwner().getName() : "Desconhecido";
          let fileFormat = file.getMimeType().split('/')[1];
          let fileUrl = file.getUrl();

          result.push([
            "", fileUrl, "", creator, "", "", "", "", "", "", "", fileFormat,
            fileId, fileName, "", "", "", ""
          ]);

          processedFileIds.add(fileId);
          PropertiesService.getScriptProperties().setProperty('lastFileId', fileId);

          sheet.getRange(sheet.getLastRow() + 1, 1, 1, result[0].length).setValues(result.splice(1, 1));
          SpreadsheetApp.flush();
          Utilities.sleep(1000);
        }

        listFiles(subfolder, subfolderPath);
      }
    } catch (e) {
      Logger.log("Erro ao processar arquivos ou pastas: " + e.message);
      throw new Error("Erro durante a listagem. Consulte os logs para mais detalhes.");
    }
  }

  try {
    listFiles(rootFolder, "");
    Logger.log("Número de pastas listadas: " + folderCount);
    Logger.log("Número de documentos listados: " + documentCount);
    Logger.log("Listagem concluída com sucesso.");
    throw new Error("Processamento concluído com sucesso.");
  } catch (e) {
    Logger.log("Erro geral: " + e.message);
    throw e;
  }
}

function resetCheckpoint() {
  PropertiesService.getScriptProperties().deleteProperty('lastFileId');
  Logger.log("Checkpoint reiniciado.");
}
