function LISTING(folderId) {
  let rootFolder;
  try {
    if (folderId) {
      rootFolder = DriveApp.getFolderById(folderId);
    } else {
      rootFolder = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents().next();
    }
  } catch (e) {
    throw new Error("Não foi possível acessar a pasta. Verifique as permissões: " + e.message);
  }

  const sheet = SpreadsheetApp.getActiveSheet();
  ensureHeaders(sheet);

  const lastRow = sheet.getLastRow();
  const existingIds = new Set();

  if (lastRow > 1) {
    sheet.getRange(2, COL.identifier + 1, lastRow - 1, 1).getValues()
      .forEach(row => existingIds.add(row[0]));
  }

  const processedFileIds = new Set();
  let lastProcessedFileId = PropertiesService.getScriptProperties().getProperty("lastFileId");
  let checkpointReached = !lastProcessedFileId;
  let folderCount = 0;
  let documentCount = 0;

  function listFiles(folder, path) {
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const subfolder = subfolders.next();
      const subfolderPath = path + "/" + subfolder.getName();
      folderCount++;

      const files = subfolder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        const fileId = file.getId();

        if (processedFileIds.has(fileId) || existingIds.has(fileId)) continue;

        if (!checkpointReached) {
          if (fileId === lastProcessedFileId) checkpointReached = true;
          continue;
        }

        const newRow = new Array(REQUIRED_HEADERS.length).fill("");
        newRow[COL.source]      = file.getUrl();
        newRow[COL.creator]     = file.getOwner() ? file.getOwner().getName() : "Desconhecido";
        newRow[COL.format]      = file.getMimeType().split("/")[1];
        newRow[COL.identifier]  = fileId;
        newRow[COL.filename]    = subfolderPath + "/" + file.getName();

        sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
        processedFileIds.add(fileId);
        PropertiesService.getScriptProperties().setProperty("lastFileId", fileId);
        SpreadsheetApp.flush();
        documentCount++;
        Utilities.sleep(500);
      }

      listFiles(subfolder, subfolderPath);
    }
  }

  listFiles(rootFolder, "");

  Logger.log("Pastas: " + folderCount + ", Documentos: " + documentCount);
  return documentCount + " documento(s) listado(s) em " + folderCount + " pasta(s).";
}

function resetCheckpoint() {
  PropertiesService.getScriptProperties().deleteProperty("lastFileId");
  Logger.log("Checkpoint reiniciado.");
}
