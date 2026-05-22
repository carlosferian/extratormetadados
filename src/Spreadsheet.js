const REQUIRED_HEADERS = [
  "repositório", "dc.source", "dc.title", "dc.creator",
  "dc.subject", "dc.subject", "dc.subject",
  "dc.description", "dc.publisher", "dc.contributor",
  "dc.date", "dc.format", "dc.identifier", "filename",
  "dc.language", "dc.relation", "dc.coverage", "dc.rights"
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
  rights:     17
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
