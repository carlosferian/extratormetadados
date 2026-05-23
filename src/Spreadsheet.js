const REQUIRED_HEADERS = [
  "repositório", "dc.source", "dc.title", "dc.creator",
  "dc.subject", "dc.subject", "dc.subject",
  "dc.description", "dc.publisher", "dc.contributor",
  "dc.date", "dc.format", "dc.identifier", "filename",
  "dc.language", "dc.relation", "dc.coverage", "dc.rights",
  "dcterms:provenance", "dc.identifier"
];

// Column indices (0-based) — single source of truth used by Listing and Export
const COL = {
  repository: 0,
  source:     1,
  title:      2,
  creator:    3,
  subject1:   4,
  subject2:   5,
  subject3:   6,
  description:7,
  publisher:  8,
  contributor:9,
  date:       10,
  format:     11,
  identifier: 12,
  filename:   13,
  language:   14,
  relation:   15,
  coverage:   16,
  rights:     17,
  provenance: 18,  // dcterms:provenance — agente de digitalização ou "Nato-digital"
  processId:  19   // dc.identifier (2º) — número de processo/protocolo jurídico-administrativo
};

function ensureHeaders(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
    return;
  }

  const existing = sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).getValues()[0];
  const needsUpdate = REQUIRED_HEADERS.some((h, i) => existing[i] !== h);

  if (needsUpdate) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
  }
}

function getActiveMetadataSheet() {
  const props = PropertiesService.getUserProperties();
  const ssId = props.getProperty('activeSpreadsheetId');
  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId).getActiveSheet();
    } catch (e) {
      console.log("Planilha de metadados não encontrada pelo ID: " + e.message);
    }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Nenhuma planilha de metadados associada. Por favor, insira a Pasta de Referência e clique em 'Listar documentos' primeiro para inicializar o sistema nesta pasta.");
  }
  return ss.getActiveSheet();
}

function getActiveMetadataSpreadsheet() {
  const props = PropertiesService.getUserProperties();
  const ssId = props.getProperty('activeSpreadsheetId');
  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (e) {
      console.log("Planilha de metadados não encontrada pelo ID: " + e.message);
    }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Nenhuma planilha de metadados associada. Por favor, insira a Pasta de Referência e clique em 'Listar documentos' primeiro para inicializar o sistema nesta pasta.");
  }
  return ss;
}

function getSpreadsheetRows() {
  try {
    const sheet = getActiveMetadataSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();
    const rows = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;
      const repository = (row[COL.repository] || '').toString().trim();
      const identifier = (row[COL.identifier] || '').toString().trim();
      const filename = (row[COL.filename] || '').toString().trim();
      const title = (row[COL.title] || '').toString().trim();
      const date = (row[COL.date] || '').toString().trim();
      const format = (row[COL.format] || '').toString().trim();

      // Determinar status: se tiver título e data e não começar com erro/ignorado, está processado
      let status = 'Pendente';
      if (title && date) {
        if (title.startsWith('Modelo não suporta') || title.startsWith('Arquivo ignorado') || title.startsWith('Erro')) {
          status = 'Ignorado';
        } else {
          status = 'Concluído';
        }
      }

      rows.push({
        rowNum,
        repository,
        identifier,
        filename,
        title,
        date,
        format,
        status
      });
    }
    return rows;
  } catch (e) {
    // Retorna array vazio se não houver planilha ativa ainda
    return [];
  }
}

function updateRowsRepository(rowNums, value) {
  try {
    const sheet = getActiveMetadataSheet();
    const valString = value ? 'SIM' : 'NÃO';
    rowNums.forEach(rowNum => {
      sheet.getRange(rowNum, COL.repository + 1).setValue(valString);
    });
    SpreadsheetApp.flush();
    return 'Linhas atualizadas.';
  } catch (e) {
    throw new Error('Falha ao atualizar linhas: ' + e.message);
  }
}
