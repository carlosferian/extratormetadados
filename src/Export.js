function exportCsvForArchivematica() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    throw new Error("Sem dados para exportar. Execute a listagem primeiro.");
  }

  // Archivematica requires filename as the first column
  const csvHeaders = [
    "filename", "dc.title", "dc.creator",
    "dc.subject", "dc.subject", "dc.subject",
    "dc.description", "dc.publisher", "dc.contributor",
    "dc.date", "dc.format", "dc.identifier", "dc.source",
    "dc.language", "dc.relation", "dc.coverage", "dc.rights"
  ];

  const rows = [csvHeaders];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rawFilename = (row[COL.filename] || "").toString().trim();
    if (!rawFilename) continue;

    // Archivematica rule: paths must start with "objects/"
    let filename = rawFilename.replace(/^\/+/, "");
    if (!filename.startsWith("objects/")) {
      filename = "objects/" + filename;
    }

    rows.push([
      filename,
      row[COL.title],
      row[COL.creator],
      row[COL.subject1],
      row[COL.subject2],
      row[COL.subject3],
      row[COL.description],
      row[COL.publisher],
      row[COL.contributor],
      row[COL.date],
      row[COL.format],
      row[COL.identifier],
      row[COL.source],
      row[COL.language],
      row[COL.relation],
      row[COL.coverage],
      row[COL.rights]
    ]);
  }

  const csvContent = rows.map(row =>
    row.map(cell => {
      const v = (cell !== null && cell !== undefined) ? cell.toString() : "";
      return (v.includes(",") || v.includes('"') || v.includes("\n"))
        ? '"' + v.replace(/"/g, '""') + '"'
        : v;
    }).join(",")
  ).join("\n");

  const folder = DriveApp.getFileById(
    SpreadsheetApp.getActiveSpreadsheet().getId()
  ).getParents().next();

  // Replace existing metadata.csv if present
  const existing = folder.getFilesByName("metadata.csv");
  while (existing.hasNext()) existing.next().setTrashed(true);

  const csvFile = folder.createFile("metadata.csv", csvContent, MimeType.CSV);

  return csvFile.getUrl();
}
