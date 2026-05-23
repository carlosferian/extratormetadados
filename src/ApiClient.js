function isMultimodal(provider, model) {
  if (!model) return false;
  const m = model.toLowerCase();
  if (provider === 'gemini') return true;
  if (provider === 'openai') {
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision-preview'].some(k => m.includes(k));
  }
  if (provider === 'openrouter') {
    return ['vision', 'claude-3', 'gpt-4o', 'gemini', 'llava', 'llama-3.2-vision', 'pixtral'].some(k => m.includes(k));
  }
  if (provider === 'ollama') {
    return ['llava', 'bakllava', 'moondream', 'cogvlm', 'vision'].some(k => m.includes(k));
  }
  return false;
}

function getFileContent(file, mimeType) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  const textTypes = [
    'text/plain', 'text/html', 'text/csv', 'text/xml',
    'application/json', 'application/xml'
  ];

  let fileSize = 0;
  try {
    fileSize = file.getSize();
  } catch (e) {
    try {
      fileSize = file.getBlob().getBytes().length;
    } catch (_) {}
  }

  // Se a imagem for maior que 10MB, processamos sem conteúdo binário (type: none) para evitar estouro de payload, 
  // permitindo que a IA deduza metadados a partir do nome rico do arquivo.
  if (imageTypes.includes(mimeType)) {
    if (fileSize > 10 * 1024 * 1024) {
      return { type: 'none' };
    }
    try {
      const blob = file.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      return { type: 'image', mimeType, base64 };
    } catch (e) {
      return { type: 'none' };
    }
  }

  if (mimeType === 'application/pdf') {
    // Se o PDF for muito grande (maior que 20MB, que é o limite do Drive OCR), processamos por nome de arquivo
    if (fileSize > 20 * 1024 * 1024) {
      return { type: 'none' };
    }
    
    // Entre 8MB e 20MB, convertemos para texto (OCR) de forma segura
    if (fileSize > 8 * 1024 * 1024) {
      const pdfText = extractPdfText(file);
      if (pdfText) {
        return { type: 'text', content: pdfText };
      }
      return { type: 'none' };
    }
    
    try {
      const blob = file.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      return { type: 'pdf', mimeType, base64 };
    } catch (e) {
      // Fallback seguro de OCR se der estouro de memória no getBytes()
      const pdfText = extractPdfText(file);
      if (pdfText) {
        return { type: 'text', content: pdfText };
      }
      return { type: 'none' };
    }
  }

  if (mimeType === 'application/vnd.google-apps.document') {
    if (fileSize > 20 * 1024 * 1024) return { type: 'none' };
    try {
      const text = file.getAs('text/plain').getDataAsString().substring(0, 15000);
      return { type: 'text', content: text };
    } catch (e) {
      return { type: 'none' };
    }
  }

  if (textTypes.some(t => mimeType === t) || mimeType.startsWith('text/')) {
    if (fileSize > 20 * 1024 * 1024) return { type: 'none' };
    try {
      const text = file.getBlob().getDataAsString().substring(0, 15000);
      return { type: 'text', content: text };
    } catch (e) {
      return { type: 'none' };
    }
  }

  return { type: 'none' };
}

function extractPdfText(file) {
  try {
    const resource = {
      title: '_tmp_pdf_' + file.getId(),
      mimeType: 'application/vnd.google-apps.document'
    };
    const copied = Drive.Files.copy(resource, file.getId(), { convert: true });
    const docId = copied.id;
    try {
      const docFile = DriveApp.getFileById(docId);
      const text = docFile.getAs('text/plain').getDataAsString().substring(0, 15000);
      DriveApp.getFileById(docId).setTrashed(true);
      return text;
    } catch (e) {
      try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {}
      return null;
    }
  } catch (e) {
    return null;
  }
}

function callAI(settings, prompt, fileId, mimeType) {
  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return 'SKIP_LINE';
  }

  // Removido o filtro rígido de tamanho que descartava o arquivo. 
  // Arquivos muito grandes ou não legíveis passarão para getFileContent e retornarão tipo 'none',
  // permitindo que a IA crie metadados perfeitos usando as informações ricas contidas no nome do arquivo!

  const provider = settings.provider || 'gemini';

  if (provider === 'gemini') return callGemini(settings, prompt, file, mimeType);
  if (provider === 'openai') return callOpenAI(settings, prompt, file, mimeType);
  if (provider === 'openrouter') return callOpenRouter(settings, prompt, file, mimeType);
  if (provider === 'ollama') return callOllama(settings, prompt, file, mimeType);

  return 'SKIP_LINE';
}

function callGemini(settings, prompt, file, mimeType, retries) {
  if (retries === undefined) retries = 3;
  const apiKey = settings.geminiApiKey;
  let model = settings.geminiModel || 'gemini-2.5-flash';
  // Intercept and auto-upgrade legacy models to gemini-2.5-flash
  if (model.indexOf('gemini-1.5-flash') !== -1 || model.indexOf('gemini-2.0-flash') !== -1) {
    model = 'gemini-2.5-flash';
  }
  const url = 'https://generativelanguage.googleapis.com/v1/models/' + model + ':generateContent?key=' + apiKey;

  const content = getFileContent(file, mimeType);
  const parts = [];

  if (content.type === 'image' || content.type === 'pdf') {
    parts.push({
      inlineData: {
        mimeType: content.mimeType,
        data: content.base64
      }
    });
    parts.push({ text: prompt });
  } else if (content.type === 'text') {
    parts.push({ text: prompt + '\n\nConteúdo do arquivo:\n' + content.content });
  } else {
    parts.push({ text: prompt });
  }

  const payload = { contents: [{ parts }] };

  for (let attempt = 0; attempt < retries; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200) {
      const json = JSON.parse(body);
      return json.candidates[0].content.parts[0].text;
    }

    if (code === 400) {
      let errMsg = "Erro 400 (Bad Request) na API Gemini";
      try {
        const json = JSON.parse(body);
        if (json.error && json.error.message) {
          errMsg += ": " + json.error.message;
        }
      } catch (e) {}
      throw new Error(errMsg);
    }

    if (code === 500 && attempt < retries - 1) {
      Utilities.sleep(5000);
      continue;
    }

    let errMsg = "Erro " + code + " na API Gemini";
    try {
      const json = JSON.parse(body);
      if (json.error && json.error.message) {
        errMsg += ": " + json.error.message;
      }
    } catch (e) {}
    throw new Error(errMsg);
  }

  throw new Error("Falha na chamada da API Gemini após várias tentativas.");
}

function callOpenAI(settings, prompt, file, mimeType) {
  const apiKey = settings.openaiApiKey;
  const model = settings.model || settings.openaiModel || 'gpt-4o';
  const url = 'https://api.openai.com/v1/chat/completions';

  const content = getFileContent(file, mimeType);
  let messages;

  if (content.type === 'image') {
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:' + content.mimeType + ';base64,' + content.base64 } }
      ]
    }];
  } else if (content.type === 'pdf') {
    const pdfText = extractPdfText(file);
    const textContent = pdfText ? prompt + '\n\nConteúdo do PDF:\n' + pdfText : prompt;
    messages = [{ role: 'user', content: textContent }];
  } else if (content.type === 'text') {
    messages = [{ role: 'user', content: prompt + '\n\nConteúdo do arquivo:\n' + content.content }];
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  const payload = { model, messages, max_tokens: 1500, temperature: 0 };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code === 200) {
    const json = JSON.parse(body);
    return json.choices[0].message.content;
  }

  let errMsg = "Erro " + code + " na OpenAI";
  try {
    const json = JSON.parse(body);
    if (json.error && json.error.message) {
      errMsg += ": " + json.error.message;
    }
  } catch (e) {}
  throw new Error(errMsg);
}

function callOpenRouter(settings, prompt, file, mimeType) {
  const apiKey = settings.openrouterApiKey;
  const model = settings.model || settings.openrouterModel || 'google/gemini-flash-1.5';
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const content = getFileContent(file, mimeType);
  let messages;

  if (content.type === 'image') {
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:' + content.mimeType + ';base64,' + content.base64 } }
      ]
    }];
  } else if (content.type === 'pdf') {
    const pdfText = extractPdfText(file);
    const textContent = pdfText ? prompt + '\n\nConteúdo do PDF:\n' + pdfText : prompt;
    messages = [{ role: 'user', content: textContent }];
  } else if (content.type === 'text') {
    messages = [{ role: 'user', content: prompt + '\n\nConteúdo do arquivo:\n' + content.content }];
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  const payload = { model, messages, max_tokens: 1500, temperature: 0 };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'HTTP-Referer': 'https://script.google.com',
      'X-Title': 'Extrator TRE-PR'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code === 200) {
    const json = JSON.parse(body);
    return json.choices[0].message.content;
  }

  let errMsg = "Erro " + code + " no OpenRouter";
  try {
    const json = JSON.parse(body);
    if (json.error && json.error.message) {
      errMsg += ": " + json.error.message;
    }
  } catch (e) {}
  throw new Error(errMsg);
}

function callOllama(settings, prompt, file, mimeType) {
  const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
  const model = settings.model || settings.ollamaModel || 'llava';
  const url = ollamaUrl + '/api/generate';

  const content = getFileContent(file, mimeType);
  const payload = { model, prompt, stream: false };

  if (content.type === 'image') {
    payload.images = [content.base64];
  } else if (content.type === 'text') {
    payload.prompt = prompt + '\n\nConteúdo do arquivo:\n' + content.content;
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code === 200) {
    const json = JSON.parse(body);
    return json.response || 'SKIP_LINE';
  }

  throw new Error("Erro " + code + " no Ollama: " + body);
}
