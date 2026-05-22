function initListing(folderId) {
  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('Não foi possível acessar a pasta. Verifique as permissões: ' + e.message);
  }

  const sheet = SpreadsheetApp.getActiveSheet();
  ensureHeaders(sheet);

  const state = {
    folderQueue: [{ id: folderId, path: '' }],
    processedCount: 0,
    folderCount: 0
  };

  CacheService.getUserCache().put('listingState', JSON.stringify(state), 21600);

  return {
    done: false,
    message: '📂 Iniciando: ' + rootFolder.getName(),
    processedCount: 0,
    folderCount: 0
  };
}

function listingStep() {
  const cache = CacheService.getUserCache();
  const raw = cache.get('listingState');

  if (!raw) {
    return {
      done: true,
      message: '✅ Nenhum estado encontrado. Execute iniciar listagem primeiro.',
      processedCount: 0,
      folderCount: 0
    };
  }

  const state = JSON.parse(raw);
  const queue = state.folderQueue;

  if (!queue || queue.length === 0) {
    cache.remove('listingState');
    return {
      done: true,
      message: '✅ Concluído: ' + state.processedCount + ' doc(s) em ' + state.folderCount + ' pasta(s)',
      processedCount: state.processedCount,
      folderCount: state.folderCount
    };
  }

  const current = queue.shift();
  const folderId = current.id;
  const folderPath = current.path;

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    state.folderQueue = queue;
    try { cache.put('listingState', JSON.stringify(state), 21600); } catch (_) {}
    return {
      done: false,
      message: '⚠ Pasta inacessível: ' + folderId,
      processedCount: state.processedCount,
      folderCount: state.folderCount,
      remaining: queue.length
    };
  }

  const folderName = folder.getName();
  state.folderCount++;

  const subfolders = folder.getFolders();
  const newSubfolders = [];
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    const subPath = folderPath ? folderPath + '/' + subfolder.getName() : subfolder.getName();
    newSubfolders.push({ id: subfolder.getId(), path: subPath });
  }
  state.folderQueue = newSubfolders.concat(queue);

  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const existingIds = new Set();
  if (lastRow > 1) {
    sheet.getRange(2, COL.identifier + 1, lastRow - 1, 1).getValues()
      .forEach(row => { if (row[0]) existingIds.add(row[0].toString()); });
  }

  let added = 0;

  if (folderPath !== '') {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();

      if (existingIds.has(fileId)) continue;

      let owner;
      try { owner = file.getOwner(); } catch (_) { owner = null; }

      const newRow = new Array(REQUIRED_HEADERS.length).fill('');
      newRow[COL.source] = file.getUrl();
      newRow[COL.creator] = owner ? owner.getName() : 'Desconhecido';
      newRow[COL.format] = file.getMimeType();
      newRow[COL.identifier] = fileId;
      newRow[COL.filename] = folderPath + '/' + file.getName();

      sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
      existingIds.add(fileId);
      added++;
      state.processedCount++;
    }
    SpreadsheetApp.flush();
  }

  try {
    cache.put('listingState', JSON.stringify(state), 21600);
  } catch (e) {
    state.folderQueue = [];
    try { cache.put('listingState', JSON.stringify(state), 21600); } catch (_) {}
  }

  return {
    done: false,
    message: '📁 ' + folderName + ': ' + added + ' arquivo(s) | Total: ' + state.processedCount,
    processedCount: state.processedCount,
    folderCount: state.folderCount,
    remaining: state.folderQueue.length
  };
}

function cancelListing() {
  CacheService.getUserCache().remove('listingState');
  return 'Listagem cancelada.';
}

function resetCheckpoint() {
  PropertiesService.getScriptProperties().deleteProperty('lastFileId');
}
