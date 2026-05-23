# Extrator de Metadados Dublin Core — TRE-PR

Ferramenta inteligente e automatizada baseada em **Google Apps Script** e **Google Gemini** para extração de metadados padrão **Dublin Core** a partir de documentos do Google Drive, otimizada para fins de preservação digital de longo prazo e integração com o sistema **Archivematica** no Tribunal Regional Eleitoral do Paraná.

---

## 🚀 Funcionalidades Principais

* **Mapeamento Recursivo**: Varredura automática e inteligente de pastas e subpastas no Google Drive.
* **Projeção de Dados em Tempo Real**: Painel interativo de duas colunas contendo a visualização viva das linhas da planilha, com badges de status de processamento da IA.
* **Busca e Filtro Rápido**: Filtro textual instantâneo de arquivos na tela por nome.
* **Ações em Massa e Toggles**: Marcar ou desmarcar arquivos em lote como `SIM` ou `NÃO` para inclusão no repositório direto do painel.
* **Processamento Focado**: Capacidade de selecionar checkboxes específicos na tela e rodar a IA estritamente nos arquivos marcados.
* **OCR na Nuvem Inteligente**: Fallback automático para Drive Cloud OCR em PDFs digitalizados (scans) maiores que 8MB até 20MB, evitando estouros de memória RAM (limite de 50MB do Apps Script).
* **Auto-Migração de Modelos**: Upgrade transparente e automático de modelos legados do Gemini (`1.5-flash`, `2.0-flash`) para o atual estável **`gemini-2.5-flash`** para evitar erros 404.
* **Exportação Archivematica**: Geração automatizada de planilha de metadados em CSV no formato padrão esperado pelo sistema Archivematica.

---

## 🛠️ Como Implementar no seu Ambiente

Existem três formas principais de implementar este sistema na sua organização Google Workspace ou conta pessoal do Google:

### Método A: Usando uma Planilha "Modelo" (Mais rápido para usuários finais)

Se você já possui o extrator funcionando em uma planilha e deseja que outras pessoas o utilizem:
1. Abra a planilha original onde o extrator está instalado.
2. Clique em **Compartilhar** no canto superior direito e configure o acesso como *"Qualquer pessoa na organização com o link pode ler"*.
3. O usuário de destino abre a planilha original e vai em **Arquivo ➔ Fazer uma cópia**.
4. A cópia conterá a planilha estruturada e todo o código vinculado no Apps Script.
5. **Primeiro Acesso**: O usuário clica em `Extrator de Metadados ➔ Abrir painel` no menu superior da planilha, passa pela autorização padrão de segurança do Google, insere sua própria API Key nas configurações do painel e começa a usar!

---

### Método B: Implantação Manual pelo Desenvolvedor (Usando CLASP)

Se você deseja clonar o código deste repositório e implantá-lo do zero em um novo projeto do Google Apps Script:

#### 1. Pré-requisitos
* Ter o [Node.js](https://nodejs.org/) instalado na máquina.
* Ter uma API Key do Google Gemini (obtenha gratuitamente no [Google AI Studio](https://aistudio.google.com/)).

#### 2. Configurando o Repositório e Autenticando
1. Abra o terminal na pasta raiz do repositório clonado.
2. Instale as dependências de desenvolvedor:
   ```bash
   npm install
   ```
3. Autentique o Clasp na sua conta do Google:
   ```bash
   npx clasp login
   ```

#### 3. Criando ou Vinculando o Projeto no Google Drive
Você pode vincular o código a uma Planilha do Google existente ou criar um projeto novo independente.

* **Opção A: Criar um projeto vinculado a uma Planilha nova** (Recomendado):
  ```bash
  npx clasp create --title "Extrator de Metadados" --type sheets
  ```
  *(Isso criará uma nova planilha com script vinculado no seu Drive e gerará o arquivo `.clasp.json` localmente).*

* **Opção B: Vincular a uma planilha existente**:
  Abra as permissões da planilha desejada, copie o ID do script Apps Script vinculado a ela e configure seu `.clasp.json`:
  ```json
  {
    "scriptId": "SEU_SCRIPT_ID_AQUI",
    "rootDir": "./src"
  }
  ```

#### 4. Enviando o Código
Compile e envie os arquivos locais para a nuvem do Google:
```bash
npx clasp push -f
```

---

### Método C: Implantando como Web App Autônomo (Zero Instalação)

Graças ao suporte a Web App nativo contido no projeto (`doGet(e)` no arquivo `Main.js`), você pode disponibilizar um link de navegador direto para que seus colegas usem o painel sem sequer tocar em planilhas originais!

1. No Editor de Scripts do seu projeto (Extensions ➔ Apps Script), clique em **Implantar ➔ Nova implantação** (Deploy ➔ New deployment).
2. Clique na engrenagem ao lado de "Selecionar tipo" e marque **Aplicativo da Web** (Web App).
3. Ajuste as configurações:
   * **Executar como**: **"Usuário que está acessando o aplicativo da web"** (User accessing the web app). *(Isso é muito importante, pois garante que o script acesse apenas o Google Drive e permissões de quem está usando a tela no momento).*
   * **Quem tem acesso**: **"Qualquer pessoa com conta do Google"** (ou *"Qualquer pessoa na sua organização Workspace"*).
4. Clique em **Implantar** e **copie a URL gerada**.
5. Distribua este link! Quando os usuários o abrirem:
   * Eles colarão o link da pasta do Google Drive desejada.
   * O sistema buscará ou criará automaticamente a planilha `metadata` dentro daquela pasta do usuário e listará e processará tudo na aba do navegador.

---

## ⚙️ Configuração Obrigatória no Google Apps Script

Como o sistema realiza **OCR em nuvem para arquivos PDF pesados** (de forma a não estourar a memória RAM do servidor), o **Serviço Drive API** precisa estar ativado no projeto do Apps Script de destino.

1. No Editor de Scripts, no menu lateral esquerdo, localize a seção **Serviços** (Services) com o sinal de `+`.
2. Clique no `+` para adicionar um serviço.
3. Escolha **Drive API** na lista.
4. Mantenha o identificador como `Drive` e clique em **Adicionar**.
5. Certifique-se de que no arquivo `src/appsscript.json` a seção de dependências habilitadas contenha a API habilitada.

---

## 📂 Como Utilizar

1. **Acessar o Painel**: Abra a URL do Web App ou abra o menu da planilha e clique em `Abrir painel`.
2. **Definir Pasta**: Cole o link da pasta do Google Drive contendo os documentos a mapear.
3. **Mapear Documentos**: Clique em **Listar Documentos**. O sistema lerá todas as subpastas e criará a planilha `metadata` no diretório alvo com os links e mime-types.
4. **Configurar IA**: Abra o acordeão "Configurações", cole sua API Key e certifique-se de que o modelo padrão `gemini-2.5-flash` esteja ativo. Salve as configurações.
5. **Selecionar e Descrever**:
   * Use a tabela interativa do lado direito para selecionar os arquivos específicos que deseja processar através das caixas de seleção.
   * (Opcional): Selecione linhas e use `Marcar como SIM` / `Marcar como NÃO` para organizar seu repositório.
   * Clique em **Descrever com IA**. O painel mostrará o progresso do Stepper em tempo real e reajustará as estatísticas e badges da tabela.
6. **Exportar**: Clique em **Exportar CSV (Archivematica)** para gerar o arquivo `.csv` final pronto para ingestão!
