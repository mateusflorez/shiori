# AGENTS.md

Este arquivo orienta agentes de codigo ao trabalhar no repositorio Shiori.
Use-o como fonte rapida de contexto tecnico, comandos validos, padroes locais e
limites do que ja esta implementado.

## Visao Geral

Shiori e um app desktop local-first para leitura de PDF e EPUB, criado com
Tauri v2, React, TypeScript, Vite e Rust. O foco do produto e leitura para
estudo de japones, com roadmap para lookup tipo Yomitan e criacao de cards no
Anki, mas o estado atual implementa principalmente:

- biblioteca de documentos recentes;
- abertura de PDF e EPUB locais por dialogo Tauri;
- renderizacao de PDF com `pdfjs-dist`;
- renderizacao de EPUB com `epubjs`;
- sidebar com recentes e sumario;
- zoom, navegacao e progresso;
- persistencia local de documentos e posicao de leitura em SQLite;
- thumbnails de documentos em cache no `localStorage`;
- icones gerados a partir de `shiori-logo.svg`.

Nao trate o `proposal.md` como implementacao concluida. Ele e o roadmap do
produto e inclui varias fases ainda pendentes: favoritos, highlights, notas,
dicionarios Yomitan/Jitendex, popup de dicionario, AnkiConnect, busca, abas,
atalhos e tema claro/escuro.

## Quick Start

### Pre-requisitos

- Windows como alvo principal atual.
- Node.js e npm. O projeto usa `package-lock.json`, portanto prefira npm.
- Rust stable para `x86_64-pc-windows-msvc`.
- Visual Studio Build Tools/MSVC.
- WebView2 instalado.

### Setup inicial

```powershell
npm install
npm run build
cd src-tauri
cargo test
```

### Rodar em desenvolvimento

```powershell
# Frontend Vite isolado em http://localhost:1420
npm run dev

# App desktop Tauri em modo dev
npm run tauri -- dev
```

O Vite esta configurado com `strictPort: true` na porta `1420`. Se essa porta
estiver ocupada, libere a porta antes de rodar o app Tauri.

## Comandos Essenciais

```powershell
# Instalar dependencias JS
npm install

# Typecheck + build Vite
npm run build

# Preview do build frontend
npm run preview

# Rodar CLI Tauri
npm run tauri -- dev
npm run tauri -- build

# Gerar instalador Windows NSIS
npm run build:windows-installer

# Conferir ambiente Tauri
npx tauri info

# Regenerar icones a partir da logo raiz
npx tauri icon shiori-logo.svg
```

Dentro de `src-tauri`:

```powershell
cargo fmt
cargo check
cargo test
```

Validacao atual observada:

- `npm run build` passa.
- `cargo test` passa com 4 testes Rust.
- O build Vite emite aviso esperado de chunk grande por causa de PDF/EPUB.

Nao ha scripts de lint, Prettier, Vitest, Jest, Playwright ou CI configurados
no estado atual.

## Arquitetura

### Fronteiras

O frontend nao acessa SQLite diretamente. Toda persistencia local deve passar
por comandos Tauri em Rust e wrappers em `src/services/tauri.ts`.

Fluxo principal:

1. `src/main.tsx` monta React.
2. `src/App.tsx` renderiza `ShioriShell`.
3. `ShioriShell` coordena estado global de leitura, documentos recentes,
   documento ativo, zoom, sidebar, TOC, progresso e autosave.
4. `HomeScreen`, `Toolbar`, `Sidebar`, `PdfViewer` e `EpubViewer` recebem
   estado por props e reportam eventos de volta para `ShioriShell`.
5. `src/services/tauri.ts` chama comandos Rust via `invoke`.
6. `src-tauri/src/lib.rs` registra os comandos Tauri e inicializa `AppState`.
7. `src-tauri/src/db.rs` abre/cria SQLite e aplica migracoes.
8. `src-tauri/src/documents.rs` valida paths, detecta PDF/EPUB, calcula hashes,
   salva documentos e salva/carrega posicoes.

### Comandos Tauri existentes

Registrados em `src-tauri/src/lib.rs`:

- `open_document_record(filePath)`
- `list_recent_documents(limit)`
- `save_reading_position(input)`
- `get_reading_position(documentId)`
- `read_document_bytes(filePath)`

Wrappers correspondentes ficam em `src/services/tauri.ts`. Se adicionar um
comando Rust, sempre adicione tambem o wrapper TS e os tipos em `src/types.ts`.

### Persistencia

O banco fica em:

```text
%APPDATA%\Shiori\shiori.sqlite3
```

Fallback fora de Windows/APPDATA:

```text
Shiori/shiori.sqlite3
```

`db.rs` cria a pasta, abre SQLite com `rusqlite`, ativa `PRAGMA foreign_keys =
ON` e `PRAGMA journal_mode = WAL`, cria `schema_migrations` e aplica
`001_initial.sql`.

Quando criar novas migracoes, nao basta adicionar o arquivo SQL. Tambem e
necessario chamar `apply_migration` em `initialize_database` com a nova versao.

### Schema atual

`src-tauri/migrations/001_initial.sql` cria:

- `documents`
- `reading_positions`
- `bookmarks`
- `highlights`
- `dictionary_sources`
- `dictionary_terms`
- `lookup_history`
- `anki_profiles`

Somente `documents` e `reading_positions` tem comandos implementados hoje. As
outras tabelas antecipam fases futuras do roadmap.

### Identidade de documentos

`documents.rs` cria o `document_id` como SHA-256 de:

```text
kind + "\0" + canonical_path
```

Tambem calcula `file_hash` por SHA-256 do conteudo. O app aceita apenas
extensoes `pdf` e `epub`. O caminho e normalizado com `canonicalize`.

### Frontend state

`ShioriShell` e o orquestrador:

- carrega recentes com `listRecentDocuments(50)`;
- abre arquivos via `@tauri-apps/plugin-dialog`;
- registra arquivo no backend com `openDocumentRecord`;
- le bytes via `readDocumentBytes`;
- carrega posicao salva com `getReadingPosition`;
- salva posicao com debounce;
- guarda `zoom` no registro de posicao;
- limita zoom entre `0.4` e `3`;
- usa tokens incrementais para distinguir navegacoes repetidas para a mesma
  pagina/href.

Autosave:

- mudancas de pagina/progresso/zoom: debounce de 550ms;
- scroll de PDF: debounce de 700ms;
- erros de autosave sao logados no console, nao exibidos na UI.

## Leitores

### PDF

`src/components/PdfViewer.tsx` usa `pdfjs-dist`:

- configura `GlobalWorkerOptions.workerSrc`;
- carrega PDF a partir de `Uint8Array`;
- calcula o tamanho base de todas as paginas;
- renderiza canvas e text layer para permitir selecao real;
- normaliza outline do PDF em `PdfOutlineItem`;
- renderiza paginas proximas da pagina atual, mantendo placeholders para as
  demais;
- detecta pagina visivel pelo scroll no container pai;
- usa `scrollIntoView` para navegacao programatica.

Ao mexer no PDF, preserve a text layer; ela e importante para selecao e para o
roadmap de highlights/dicionario.

### EPUB

`src/components/EpubViewer.tsx` usa `epubjs`:

- abre `Uint8Array` como binario;
- coleta itens lineares do spine;
- renderiza cada secao em um iframe com `srcDoc`;
- injeta CSS proprio via `iframeShioriCss`;
- forca leitura horizontal LTR no MVP;
- intercepta `wheel` dentro do iframe e repassa para o scroll root;
- calcula progresso global a partir do scroll;
- gera TOC a partir de `book.loaded.navigation`.

Contexto importante: embora o tipo de backend seja `epub_cfi`, o locator salvo
hoje nao e um EPUB CFI real. Ele usa o prefixo customizado:

```text
shiori-scroll:<encoded href>:<section progress>
```

Se uma fase futura migrar para CFI real, trate isso como migracao de dados e de
contrato, nao como simples rename.

## UI e Estilo

Todo o CSS esta em `src/App.css`. O prefixo visual padrao e `shiori-*`.

Padroes atuais:

- componentes React funcionais;
- tipos de props no topo do arquivo do componente;
- helpers locais antes do componente principal;
- icones de UI via `lucide-react`;
- logo da marca via `shiori-logo.svg`;
- textos de UI em portugues sem acentos no codigo existente;
- estados vazios explicitos;
- botoes com `aria-label` quando o texto visivel nao descreve a acao;
- layout desktop, denso e utilitario, sem landing page.

Evite criar novo design system agora. Siga os padroes de `Toolbar`, `Sidebar`,
`HomeScreen` e `ShioriShell`.

## Estrutura do Projeto

```text
reader/
|-- AGENTS.md                    # Guia para agentes
|-- index.html                   # Shell HTML do Vite
|-- package.json                 # Scripts e dependencias JS
|-- package-lock.json            # Lockfile npm
|-- proposal.md                  # Roadmap/proposta, nao implementacao completa
|-- shiori-logo.svg              # Fonte da logo
|-- src/
|   |-- App.tsx                  # Renderiza ShioriShell
|   |-- App.css                  # CSS global do app
|   |-- main.tsx                 # Entry React
|   |-- types.ts                 # DTOs e tipos compartilhados no frontend
|   |-- components/
|   |   |-- ShioriShell.tsx      # Orquestrador de estado e fluxos
|   |   |-- HomeScreen.tsx       # Biblioteca e thumbnails
|   |   |-- Toolbar.tsx          # Navegacao e zoom
|   |   |-- Sidebar.tsx          # Recentes, sumario e favoritos placeholder
|   |   |-- PdfViewer.tsx        # Renderizacao PDF
|   |   `-- EpubViewer.tsx       # Renderizacao EPUB
|   |-- services/
|   |   `-- tauri.ts             # Wrappers de comandos Tauri
|   `-- utils/
|       `-- format.ts            # formatDate e clamp
|-- src-tauri/
|   |-- Cargo.toml               # Crate Rust/Tauri
|   |-- tauri.conf.json          # Produto, janela, bundle e icones
|   |-- capabilities/default.json# Permissoes Tauri
|   |-- migrations/
|   |   `-- 001_initial.sql      # Schema SQLite inicial
|   |-- icons/                   # Icones gerados por npx tauri icon
|   `-- src/
|       |-- main.rs              # Chama shiori_lib::run()
|       |-- lib.rs               # Builder Tauri e comandos
|       |-- db.rs                # SQLite e migracoes
|       `-- documents.rs         # Documento/posicao/leitura de bytes
|-- dist/                        # Gerado por npm run build
`-- node_modules/                # Dependencias locais
```

`src-tauri/gen`, `src-tauri/target`, `dist`, `node_modules` e arquivos SQLite
sao ignorados pelo `.gitignore` e devem ser tratados como artefatos gerados.

## Dependencias Principais

Frontend:

- React 19
- TypeScript 5.8
- Vite 7
- `@tauri-apps/api`
- `@tauri-apps/plugin-dialog`
- `pdfjs-dist`
- `epubjs`
- `lucide-react`

Backend:

- Tauri 2
- `tauri-plugin-dialog`
- `rusqlite` com feature `bundled`
- `serde` e `serde_json`
- `sha2`
- `chrono`
- `time = 0.3.47`

## Seguranca e Privacidade

Principios do produto:

- dados locais por padrao;
- nao enviar documentos para servicos externos;
- permitir apenas arquivos escolhidos pelo usuario no fluxo normal;
- validar paths no backend;
- nao executar scripts vindos de EPUB, dicionarios ou templates.

Estado atual:

- a permissao Tauri exposta e `core:default` e `dialog:default`;
- a leitura de bytes passa por comando Rust e valida extensao `pdf`/`epub`;
- EPUB renderiza em iframe com `sandbox="allow-same-origin"`;
- CSP esta `null` em `tauri.conf.json`, entao seja cuidadoso ao adicionar HTML
  dinamico ou conteudo remoto.

Para features de dicionario/Anki/templates, sanitize HTML antes de renderizar e
nao permita scripts externos.

## Padroes de Codigo

### TypeScript/React

- Use `strict: true`.
- Nao adicione `any` sem necessidade clara.
- Prefira tipos exportados em `src/types.ts` para contratos compartilhados.
- Mantenha componentes com props explicitas.
- Use `useCallback`, `useMemo` e refs quando o componente ja segue esse padrao.
- Use `Uint8Array` para bytes vindos do backend.
- Evite estado duplicado quando `ShioriShell` ja centraliza o fluxo.

### Rust

- DTOs expostos ao frontend usam `#[serde(rename_all = "camelCase")]`.
- Erros retornam `Result<T, String>` com mensagens user-facing em portugues.
- Valide inputs no backend mesmo que o frontend tambem valide.
- Use queries parametrizadas com `rusqlite::params`.
- Crie testes unitarios em modulos Rust para persistencia e validacao.

### Nomes

- Marca/produto: `Shiori`.
- Prefixo CSS e cache: `shiori-*`, `shiori:*`.
- Crate Rust: `shiori`.
- Lib Rust: `shiori_lib`.
- Banco: `shiori.sqlite3`.
- Componentes de leitura: `PdfViewer`, `EpubViewer`.

## Como Adicionar Features

### Novo comando backend

1. Adicione ou atualize o modulo em `src-tauri/src/`.
2. Se houver persistencia nova, adicione migracao SQL e registre a nova versao
   em `db.rs`.
3. Crie a funcao `#[tauri::command]` em `lib.rs`.
4. Registre a funcao em `tauri::generate_handler!`.
5. Adicione wrapper em `src/services/tauri.ts`.
6. Adicione/ajuste tipos em `src/types.ts`.
7. Cubra a regra principal com `cargo test`.

### Nova UI

1. Coloque componente em `src/components/`.
2. Mantenha estado de workflow em `ShioriShell` quando a feature afetar leitor,
   documento ativo, sidebar ou autosave.
3. Use classes `shiori-*` em `App.css`.
4. Use `lucide-react` para icones de controle.
5. Inclua estados vazios e erros user-facing em portugues.

### Novas tabelas ou migracoes

1. Crie novo arquivo em `src-tauri/migrations/`.
2. Nao altere migracao ja aplicada sem motivo forte.
3. Chame `apply_migration` com versao incremental em `initialize_database`.
4. Adicione testes que inicializam banco novo e validam a mudanca.

### Icones e marca

`shiori-logo.svg` e a fonte da logo. Para atualizar icones de app:

```powershell
npx tauri icon shiori-logo.svg
```

Isso atualiza `src-tauri/icons/`, incluindo `icon.ico`.

## Testes e Qualidade

Testes existentes:

- `src-tauri/src/db.rs`: inicializacao e migracao inicial.
- `src-tauri/src/documents.rs`: abrir/listar recentes, salvar/carregar posicao,
  ler bytes de documento suportado.

Gates recomendados antes de finalizar mudancas:

```powershell
npm run build
cd src-tauri
cargo fmt
cargo check
cargo test
```

Para mudancas de UI, rode o app com `npm run tauri -- dev` e valide
manualmente pelo menos:

- Home sem documentos;
- abrir PDF;
- abrir EPUB;
- sidebar de recentes;
- sumario quando existir;
- zoom;
- navegacao;
- fechar/reabrir voltando para a posicao salva.

Nao ha suite frontend automatizada ainda. Se uma mudanca mexer em leitura,
estado de documento, autosave ou renderizacao, considere adicionar testes ou
ao menos documentar a validacao manual feita.

## Historico Git

Historico atual observado:

```text
f929ee2 feat: create repo
```

Autor no commit inicial: Mateus Flores, em 2026-06-30. O repositorio ainda nao
tem historico suficiente para inferir hotspots, ownership real, padroes de PR
ou decisoes arquiteturais por evolucao. Use o codigo atual e `proposal.md` como
fontes primarias.

## Contexto Oculto e Gotchas

- `proposal.md` contem fases futuras; nao implemente algo achando que ja existe.
- `bookmarks`, `highlights`, `dictionary_*`, `lookup_history` e `anki_profiles`
  existem no schema, mas ainda nao tem comandos nem UI completos.
- O locator de EPUB e customizado (`shiori-scroll:*`), apesar do enum chamar
  `epub_cfi`.
- `HomeScreen` gera thumbnails lendo bytes completos do documento e usa cache
  `localStorage` com limite de 16 entradas.
- `PdfViewer` depende da text layer para selecao; nao remova ao otimizar canvas.
- O CSS esta concentrado em um arquivo grande. Evite refatorar CSS em massa
  junto com feature pequena.
- `dist/` muda a cada build e nao deve ser editado manualmente.
- O Windows pode manter cache de icone antigo mesmo depois de regenerar
  `icon.ico`; rebuild/restart costuma resolver.
- `tauri.conf.json` usa CSP `null`; qualquer HTML externo futuro precisa de
  cuidado extra.
- O build frontend pode avisar sobre chunks maiores que 500 kB. Isso e esperado
  por enquanto por causa de `pdfjs-dist`, `epubjs` e worker de PDF.
- `src-tauri/gen` e gerado e ignorado. Nao dependa dele como fonte editavel.

## Roadmap Conforme Proposal

Ordem proposta no `proposal.md`:

1. Persistencia local.
2. Shell e PDF.
3. EPUB.
4. Favoritos, highlights e notas.
5. Dicionarios Yomitan/Jitendex e lookup.
6. AnkiConnect e preview de card.
7. Polimento de leitura: abas, busca, temas, atalhos, erros.
8. Testes e empacotamento.

Ao implementar fases futuras, prefira manter o app local-first e com SQLite
gerenciado pelo Rust. Integracoes externas devem ser opt-in.

## Checklist Para Agentes

Antes de editar:

- Leia os arquivos diretamente afetados.
- Verifique se a feature esta implementada ou apenas descrita em `proposal.md`.
- Preserve alteracoes existentes do usuario.

Durante a edicao:

- Mantenha as mudancas pequenas e localizadas.
- Atualize tipos TS e DTOs Rust juntos quando o contrato mudar.
- Atualize migracoes e testes quando persistencia mudar.
- Nao edite `dist/`, `node_modules`, `src-tauri/target` ou `src-tauri/gen`.

Antes de concluir:

- Rode `npm run build` para mudancas frontend/contrato.
- Rode `cargo test` ou pelo menos `cargo check` para mudancas Rust.
- Informe avisos ou limitacoes restantes.
