/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const properties = PropertiesService.getScriptProperties().getProperties();
const geminiApiKey = properties['GEMINI_API_KEY'];
const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${geminiApiKey}`;
const geminiProVisionEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
const geminiProVisionEndpoint1 = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-exp-0801:generateContent?key=${geminiApiKey}`;


function callGeminiProVision(prompt, image, temperature = 0, retryCount = 3) {
  var imageFile = DriveApp.getFileById(image);
  if (!imageFile) {
    console.log("Arquivo de imagem não encontrado: " + image);
    return null;
  }

  var imageSize = imageFile.getSize();
  console.log(`O arquivo ${imageFile.getName()} tem o tamanho: ${imageSize} bytes.`);
  var maxSize = 10971520;

  if (imageSize > maxSize) {
    console.log(`O arquivo ${imageFile.getName()} excede o limite de 20MB. Tamanho do arquivo: ${imageSize} bytes.`);
    return "SKIP_LINE";
  }

  var imageBlob = imageFile.getBlob();
  const imageData = Utilities.base64Encode(imageBlob.getBytes());

  const payload = {
    "contents": [
      {
        "parts": [
          {
            "text": prompt
          },
          {
            "inlineData": {
              "mimeType": "image/jpg",
              "data": imageData
            }
          }
        ]
      }
    ],
    "generationConfig": {
      "temperature": temperature,
    },
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'muteHttpExceptions': true,
    'payload': JSON.stringify(payload)
  };

  try {
    const response = UrlFetchApp.fetch(geminiProVisionEndpoint, options);

    if (response.getResponseCode() === 500) {
      throw new Error("Erro interno do servidor (500). Tentando novamente...");
    }

    const data = JSON.parse(response.getContentText());
    console.log("Resposta da API:", JSON.stringify(data, null, 2));

    if (data.error && data.error.status === "INVALID_ARGUMENT") {
      console.log("Erro na API: " + data.error.message);
      return "SKIP_LINE";
    }

    if (data && data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts) {
      const content = data["candidates"][0]["content"]["parts"][0]["text"];
      return content;
    } else {
      console.log("A resposta da API não contém candidatos ou partes esperadas.");
      return null;
    }

  } catch (error) {
    console.error(`Erro ao chamar a API Gemini: ${error.message}`);

    if (retryCount > 0) {
      console.log(`Tentando novamente... Restam ${retryCount} tentativas.`);
      Utilities.sleep(5000);
      return callGeminiProVision(prompt, image, temperature, retryCount - 1);
    } else {
      throw new Error(`Falha após várias tentativas: ${error.message}`);
    }
  }
}

function processSpreadsheetWithGemini() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var dataRange = sheet.getDataRange();
  var data = dataRange.getValues();

  const modelName = "gemini-2.0-flash-exp";

  try {
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === "SIM") {

        if (data[i][2] && data[i][2].startsWith("Arquivo ignorado")) {
          console.log(`Linha ${i + 1} pulada: ${data[i][2]}`);
          continue;
        }

        let needsFilling = false;

        if (!data[i][2] || !data[i][5] || !data[i][6] || !data[i][7]) {
          needsFilling = true;
        }

        if (needsFilling) {
          let fileId = data[i][12];
          let fileName = data[i][13];

          if (fileId) {
            console.log(`Processando o arquivo: ${fileName}`);

            let file = DriveApp.getFileById(fileId);
            let mimeType = file.getMimeType();

            if (!mimeType.startsWith("image/")) {
              console.log(`Arquivo ignorado. Tipo de arquivo não é uma imagem: ${mimeType}`);
              sheet.getRange(i + 1, 3).setValue(`Arquivo ignorado: ${mimeType}`);
              continue;
            }

            let prompt = `Analise cuidadosamente o conteúdo da imagem e gere uma resposta completa e precisa para facilitar a recuperação da informação. Considere os seguintes elementos ao criar a resposta:

            1. **Objetos**: Identifique e descreva os objetos presentes na imagem.
            2. **Pessoas**: Se houver pessoas, identifique-as apenas se tiver certeza absoluta de quem são.
            3. **Contexto**: Forneça informações sobre o evento, local, atividade ou situação representada na imagem, utilize o nome do arquivo: ${fileName} para definir o contexto. Considere, ainda que as fotos foram criadas pela Comunicação do Tribunal Regional Eleitoral do Paraná.
            4. **Detalhes Relevantes**: Inclua descrições específicas, como textos visíveis, cores predominantes, datas ou ações que estejam acontecendo.
            5. **Palavras-chave**: Sugira palavras-chave relevantes para facilitar a indexação e a busca da imagem.

            **Importante**:
            - Não mencione os nomes dos campos na resposta, tampouco que alguma informação foi retirada do nome do arquivo.
            - Não utilize palavras que denotem dúvida.
            - A resposta deve ser clara, objetiva e estruturada no seguinte formato:
              [Título; Evento; Palavras-chave; Descrição detalhada].

            **Exemplo de Resposta**:
            Se a imagem mostrar uma cerimônia de posse no TRE-PR:
            [Cerimônia de Posse 2024; Posse de Novos Juízes Eleitorais; Posse, Justiça Eleitoral, TRE-PR; Auditório do TRE-PR com novos juízes sendo empossados, autoridades visíveis no palco e público assistindo à solenidade.].`;

            let response = callGeminiProVision(prompt, fileId, 0);
            console.log(response);
            let list = extractListFromResponse(response);

            if (list.length === 4) {
              let title = list[0];
              let event = list[1];
              let tag = list[2];
              let description = list[3];

              if (!data[i][2]) {
                sheet.getRange(i + 1, 3).setValue(title);
              }
              if (!data[i][5]) {
                sheet.getRange(i + 1, 6).setValue(event);
              }
              if (!data[i][6]) {
                sheet.getRange(i + 1, 7).setValue(tag);
              }
              if (!data[i][7]) {
                sheet.getRange(i + 1, 8).setValue(description);
              }

              sheet.getRange(i + 1, 10).setValue(modelName);
              SpreadsheetApp.flush();
              console.log(`Arquivo processado: ${fileName} salvo com sucesso.`);
              Utilities.sleep(15000);
            } else {
              console.log("Resposta da IA não contém as informações esperadas. Verifique a resposta da IA.");
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Erro ao processar a linha ${i + 1}: ${error.message}`);
    SpreadsheetApp.flush();
    throw new Error(`O processamento foi interrompido devido a um erro: ${error.message}`);
  }

  SpreadsheetApp.flush();
}

function extractListFromResponse(response) {
  let matches = response.match(/\[(.*?)\]/);
  let list = [];

  if (matches && matches[1]) {
    let items = matches[1].split(';').filter(item => item.trim().length > 0);

    if (items.length === 4) {
      for (let item of items) {
        list.push(item.trim());
      }
    } else {
      console.log("A lista extraída não contém 4 elementos. Lista extraída:", items);
    }
  } else {
    console.log("Não foi possível extrair a lista da resposta. Verifique se os dados estão no formato esperado.");
  }

  return list;
}
