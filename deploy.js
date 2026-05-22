const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SCRIPT_ID = "1dB9_r9R2N3UZAjrYW5UAlKd5I8zl-9hO5H0d3FwFEif-81Urv83WUkQV";

async function deploy() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  const script = google.script({ version: "v1", auth: oauth2Client });

  const files = [
    {
      name: "Listing",
      type: "SERVER_JS",
      source: fs.readFileSync(path.join(__dirname, "src/Listing.js"), "utf8"),
    },
    {
      name: "Gemini",
      type: "SERVER_JS",
      source: fs.readFileSync(path.join(__dirname, "src/Gemini.js"), "utf8"),
    },
    {
      name: "appsscript",
      type: "JSON",
      source: fs.readFileSync(path.join(__dirname, "src/appsscript.json"), "utf8"),
    },
  ];

  await script.projects.updateContent({
    scriptId: SCRIPT_ID,
    requestBody: { files },
  });

  console.log("Deploy concluído com sucesso!");
}

deploy().catch((err) => {
  console.error("Erro no deploy:", err.message);
  process.exit(1);
});
