// Cache key constants
var LS_STATE    = 'listingState';
var LS_ID_COUNT = 'lid_count';
var LS_ID_PFX   = 'lid_';
var LS_TTL      = 21600; // 6 h

// ---------------------------------------------------------------------------
// Chunked-cache helpers for existingIds (up to ~90 KB per chunk)
// ---------------------------------------------------------------------------

function _cacheStoreIds(idsArray) {
  var cache = CacheService.getUserCache();
  var str = idsArray.join('\n');
  if (!str) {
    cache.put(LS_ID_COUNT, '0', LS_TTL);
    return;
  }
  var CHUNK = 90000;
  var chunks = Math.ceil(str.length / CHUNK);
  cache.put(LS_ID_COUNT, String(chunks), LS_TTL);
  for (var i = 0; i < chunks; i++) {
    cache.put(LS_ID_PFX + i, str.slice(i * CHUNK, (i + 1) * CHUNK), LS_TTL);
  }
}

// Falls back to reading the sheet's identifier column if cache has expired.
function _cacheLoadIds(sheet) {
  var cache = CacheService.getUserCache();
  var chunks = parseInt(cache.get(LS_ID_COUNT) || '0');

  if (!chunks) {
    // Cache expired — rebuild from sheet
    if (!sheet) return new Set();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return new Set();
    var ids = new Set();
    sheet.getRange(2, COL.identifier + 1, lastRow - 1, 1).getValues()
      .forEach(function(r) { if (r[0]) ids.add(r[0].toString()); });
    return ids;
  }

  var str = '';
  for (var i = 0; i < chunks; i++) {
    str += cache.get(LS_ID_PFX + i) || '';
  }
  return new Set(str.split('\n').filter(Boolean));
}

function _cacheClearIds() {
  var cache = CacheService.getUserCache();
  var chunks = parseInt(cache.get(LS_ID_COUNT) || '0');
  cache.remove(LS_ID_COUNT);
  for (var i = 0; i < chunks; i++) {
    cache.remove(LS_ID_PFX + i);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function checkListingState() {
  var raw = CacheService.getUserCache().get(LS_STATE);
  if (!raw) return null;
  try {
    var s = JSON.parse(raw);
    return {
      foldersRemaining: s.folderQueue ? s.folderQueue.length : 0,
      processedCount:   s.processedCount || 0,
      newCount:         s.newCount || 0,
      folderCount:      s.folderCount || 0
    };
  } catch (_) { return null; }
}

function resumeListingSession() {
  var cache = CacheService.getUserCache();
  var raw = cache.get(LS_STATE);
  if (!raw) throw new Error('Nenhum estado de listagem para retomar.');
  var s = JSON.parse(raw);
  return {
    done:           !s.folderQueue || s.folderQueue.length === 0,
    message:        '📂 Retomando: ' + (s.folderQueue ? s.folderQueue.length : 0) + ' pasta(s) restante(s). ' + (s.processedCount || 0) + ' arquivo(s) já catalogados.',
    processedCount: s.processedCount || 0,
    newCount:       s.newCount || 0,
    folderCount:    s.folderCount || 0,
    remaining:      s.folderQueue ? s.folderQueue.length : 0
  };
}

function initListing(folderId) {
  var rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('Não foi possível acessar a pasta. Verifique as permissões: ' + e.message);
  }

  // Find or create the metadata spreadsheet
  var files = rootFolder.getFilesByName('metadata');
  var metadataFile = null;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) { metadataFile = f; break; }
  }

  var ss;
  if (metadataFile) {
    ss = SpreadsheetApp.openById(metadataFile.getId());
  } else {
    ss = SpreadsheetApp.create('metadata');
    DriveApp.getFileById(ss.getId()).moveTo(rootFolder);
  }

  var props = PropertiesService.getUserProperties();
  props.setProperties({
    'activeSpreadsheetId': ss.getId(),
    'activeFolderId': folderId
  });

  var sheet = ss.getActiveSheet();
  ensureHeaders(sheet);

  // Read all existing IDs once — avoids repeated sheet reads during listing
  var lastRow = sheet.getLastRow();
  var existingIdsArray = [];
  if (lastRow > 1) {
    sheet.getRange(2, COL.identifier + 1, lastRow - 1, 1).getValues()
      .forEach(function(row) { if (row[0]) existingIdsArray.push(row[0].toString()); });
  }
  var alreadyListed = existingIdsArray.length;

  // Store IDs in chunked cache for use by each listing step
  _cacheStoreIds(existingIdsArray);

  var state = {
    folderQueue:    [{ id: folderId, path: '' }],
    processedCount: alreadyListed,
    newCount:       0,
    folderCount:    0
  };
  CacheService.getUserCache().put(LS_STATE, JSON.stringify(state), LS_TTL);

  return {
    done:           false,
    message:        alreadyListed > 0
      ? '📂 ' + alreadyListed + ' arquivo(s) já catalogados. Buscando novos em: ' + rootFolder.getName()
      : '📂 Iniciando na pasta: ' + rootFolder.getName(),
    processedCount: alreadyListed,
    newCount:       0,
    folderCount:    0
  };
}

function listingStep() {
  var cache = CacheService.getUserCache();
  var raw = cache.get(LS_STATE);

  if (!raw) {
    return { done: true, message: '✅ Nenhum estado encontrado. Execute iniciar listagem primeiro.', processedCount: 0, folderCount: 0 };
  }

  var state = JSON.parse(raw);
  var queue = state.folderQueue;

  if (!queue || queue.length === 0) {
    cache.remove(LS_STATE);
    _cacheClearIds();
    return {
      done:           true,
      message:        '✅ Concluído: ' + (state.newCount || 0) + ' novo(s) arquivo(s) em ' + state.folderCount + ' pasta(s). Total: ' + state.processedCount,
      processedCount: state.processedCount,
      newCount:       state.newCount || 0,
      folderCount:    state.folderCount
    };
  }

  var current = queue.shift();
  var folderId  = current.id;
  var folderPath = current.path;

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    state.folderQueue = queue;
    try { cache.put(LS_STATE, JSON.stringify(state), LS_TTL); } catch (_) {}
    return {
      done: false, message: '⚠ Pasta inacessível: ' + folderId,
      processedCount: state.processedCount, newCount: state.newCount || 0,
      folderCount: state.folderCount, remaining: queue.length
    };
  }

  var folderName = folder.getName();
  state.folderCount++;

  // Queue sub-folders (depth-first)
  var subfolders = folder.getFolders();
  var newSubfolders = [];
  while (subfolders.hasNext()) {
    var sub = subfolders.next();
    var subPath = folderPath ? folderPath + '/' + sub.getName() : sub.getName();
    newSubfolders.push({ id: sub.getId(), path: subPath });
  }
  state.folderQueue = newSubfolders.concat(queue);

  var sheet = getActiveMetadataSheet();
  var activeSpreadsheetId = PropertiesService.getUserProperties().getProperty('activeSpreadsheetId');

  // Load existing IDs from cache (falls back to sheet if cache expired)
  var existingIds = _cacheLoadIds(sheet);

  // Collect all new files in this folder as rows
  var newRows = [];
  var newIds  = [];
  var fileIter = folder.getFiles();
  while (fileIter.hasNext()) {
    var file   = fileIter.next();
    var fileId = file.getId();

    if (fileId === activeSpreadsheetId) continue;
    if (existingIds.has(fileId)) continue;

    var owner;
    try { owner = file.getOwner(); } catch (_) { owner = null; }

    var newRow = new Array(REQUIRED_HEADERS.length).fill('');
    newRow[COL.source]    = file.getUrl();
    newRow[COL.creator]   = owner ? owner.getName() : 'Desconhecido';
    newRow[COL.format]    = file.getMimeType();
    newRow[COL.identifier]= fileId;
    newRow[COL.filename]  = folderPath ? folderPath + '/' + file.getName() : file.getName();

    newRows.push(newRow);
    newIds.push(fileId);
    existingIds.add(fileId);
  }

  // Batch write — one setValues() call per folder instead of one per file
  if (newRows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, REQUIRED_HEADERS.length).setValues(newRows);
    SpreadsheetApp.flush();

    // Persist updated ID set back to cache
    _cacheStoreIds([...existingIds]);
  }

  state.newCount       = (state.newCount || 0) + newRows.length;
  state.processedCount = (state.processedCount || 0) + newRows.length;

  try {
    cache.put(LS_STATE, JSON.stringify(state), LS_TTL);
  } catch (e) {
    // State too large (very deep folder tree) — truncate queue
    state.folderQueue = [];
    try { cache.put(LS_STATE, JSON.stringify(state), LS_TTL); } catch (_) {}
  }

  return {
    done:           false,
    message:        '📁 ' + folderName + ': +' + newRows.length + ' novo(s) | Total: ' + state.processedCount,
    processedCount: state.processedCount,
    newCount:       state.newCount,
    folderCount:    state.folderCount,
    remaining:      state.folderQueue.length
  };
}

function cancelListing() {
  CacheService.getUserCache().remove(LS_STATE);
  _cacheClearIds();
  return 'Listagem cancelada.';
}

function resetCheckpoint() {
  PropertiesService.getScriptProperties().deleteProperty('lastFileId');
}
