function initListing(folderId, fileTypeFilter) {
  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('Não foi possível acessar a pasta. Verifique as permissões: ' + e.message);
  }

  // Buscar uma planilha do Google chamada "metadata" nesta pasta
  const files = rootFolder.getFilesByName('metadata');
  let metadataFile = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      metadataFile = f;
      break;
    }
  }

  let ss;
  if (metadataFile) {
    ss = SpreadsheetApp.openById(metadataFile.getId());
  } else {
    // Criar nova planilha
    ss = SpreadsheetApp.create('metadata');
    // Mover para a pasta alvo
    DriveApp.getFileById(ss.getId()).moveTo(rootFolder);
  }

  // Salvar as referências no PropertiesService do usuário
  const props = PropertiesService.getUserProperties();
  props.setProperties({
    'activeSpreadsheetId': ss.getId(),
    'activeFolderId': folderId
  });

  const sheet = ss.getActiveSheet();
  ensureHeaders(sheet);

  const state = {
    folderQueue: [{ id: folderId, path: '' }],
    processedCount: 0,
    folderCount: 0,
    fileTypeFilter: fileTypeFilter || 'all'
  };

  CacheService.getUserCache().put('listingState', JSON.stringify(state), 21600);

  return {
    done: false,
    message: '📂 Iniciando na pasta: ' + rootFolder.getName(),
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
      message: '✅ Concluído: ' + state.processedCount + ' doc(s) em ' + state.folderCount + ' pasta(s)' + checkDuplicateFilenames(),
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

  const sheet = getActiveMetadataSheet();
  const lastRow = sheet.getLastRow();
  const existingIds = new Set();
  if (lastRow > 1) {
    sheet.getRange(2, COL.identifier + 1, lastRow - 1, 1).getValues()
      .forEach(row => { if (row[0]) existingIds.add(row[0].toString()); });
  }

  let added = 0;
  const activeSpreadsheetId = PropertiesService.getUserProperties().getProperty('activeSpreadsheetId');

  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileId = file.getId();

    if (fileId === activeSpreadsheetId) continue;
    if (existingIds.has(fileId)) continue;

    const mimeType = file.getMimeType();
    if (!fileMatchesTypeFilter(mimeType, state.fileTypeFilter)) continue;

    let owner;
    try { owner = file.getOwner(); } catch (_) { owner = null; }

    const newRow = new Array(REQUIRED_HEADERS.length).fill('');
    newRow[COL.source] = file.getUrl();
    newRow[COL.creator] = owner ? owner.getName() : 'Desconhecido';
    newRow[COL.format] = mimeType;
    newRow[COL.identifier] = fileId;
    newRow[COL.filename] = folderPath ? folderPath + '/' + file.getName() : file.getName();
    // Data de criação no Drive (não necessariamente a data do documento original),
    // usada como valor inicial de dc.date para habilitar o fluxo de reprocessamento em Process.js
    newRow[COL.date] = Utilities.formatDate(file.getDateCreated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
    existingIds.add(fileId);
    added++;
    state.processedCount++;
  }
  SpreadsheetApp.flush();

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

// Decide se um arquivo deve ser adicionado à planilha de acordo com o filtro de tipo
// selecionado na listagem. Pastas são sempre percorridas, independente do filtro.
function fileMatchesTypeFilter(mimeType, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'images') return mimeType.startsWith('image/');
  if (filter === 'pdf') return mimeType === 'application/pdf';
  if (filter === 'documents') {
    const docTypes = [
      'text/plain', 'text/html', 'text/csv', 'text/xml',
      'application/json', 'application/xml',
      'application/vnd.google-apps.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/rtf'
    ];
    return docTypes.indexOf(mimeType) !== -1 || mimeType.startsWith('text/');
  }
  return true;
}

// Verifica se há valores repetidos na coluna filename, que quebrariam o metadata.csv
// (Archivematica exige um filename único por linha)
function checkDuplicateFilenames() {
  try {
    const sheet = getActiveMetadataSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return '';

    const values = sheet.getRange(2, COL.filename + 1, lastRow - 1, 1).getValues();
    const counts = new Map();
    values.forEach(row => {
      const fname = (row[0] || '').toString().trim();
      if (!fname) return;
      counts.set(fname, (counts.get(fname) || 0) + 1);
    });

    let duplicateNames = 0;
    counts.forEach(c => { if (c > 1) duplicateNames++; });

    return duplicateNames > 0 ? ' ⚠ ' + duplicateNames + ' nome(s) de arquivo duplicado(s) detectado(s).' : '';
  } catch (e) {
    return '';
  }
}
