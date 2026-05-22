const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SCRIPT_ID = "1dB9_r9R2N3UZAjrYW5UAlKd5I8zl-9hO5H0d3FwFEif-81Urv83WUkQV";

async function deploy() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/script.projects"],
  });

  const script = google.script({ version: "v1", auth });

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
