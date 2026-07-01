# Proposal: Shiori Tauri/React para PDF, EPUB, Yomitan e Anki

## Visao

Criar um aplicativo desktop em Tauri + React para leitura de PDF e EPUB, com experiencia parecida com SumatraPDF para navegacao e organizacao, mas focado em estudo de japones:

- Abrir PDF e EPUB em abas.
- Salvar automaticamente onde o usuario parou.
- Criar favoritos, marcacoes e notas por trecho.
- Selecionar texto japones e abrir um popup tipo Yomitan com definicoes, exemplos, frequencia, tags, leitura e pitch quando disponivel.
- Gerar cards para Anki com os campos usados no template Lapis/Yomitan enviado.
- Manter tudo local, rapido e previsivel em Windows.

O projeto pode seguir a estrutura do `PrimePrint`: Tauri v2, React, TypeScript, Vite, `src/` para frontend, `src-tauri/` para backend Rust e documentacao em portugues.

## Objetivos do MVP

1. Ler arquivos locais:
   - PDF com pagina, zoom, busca textual e sumario quando o documento tiver outline.
   - EPUB com sumario, navegacao por capitulos e progresso.

2. Persistir estado automaticamente:
   - Ultima pagina/localizacao.
   - Zoom e modo de visualizacao por documento.
   - Arquivos recentes.
   - Abas abertas.

3. Permitir estudo durante a leitura:
   - Favoritar pagina/localizacao.
   - Marcar texto selecionado.
   - Adicionar nota curta a uma marcacao.
   - Abrir popup de dicionario ao selecionar ou clicar em palavra japonesa.

4. Integrar com Anki:
   - Detectar AnkiConnect em `http://127.0.0.1:8765`.
   - Criar nota com `addNote`.
   - Preencher campos compativeis com o template Lapis/Yomitan:
     `Expression`, `ExpressionFurigana`, `ExpressionReading`, `ExpressionAudio`,
     `Sentence`, `SentenceFurigana`, `SentenceAudio`, `SelectionText`,
     `MainDefinition`, `Glossary`, `PitchPosition`, `PitchCategories`,
     `FreqSort`, `Frequency`, `Picture`, `DefinitionPicture`, `Tags`,
     `IsSentenceCard`, `IsWordAndSentenceCard`, `IsClickCard`, `IsAudioCard`,
     `Hint`.

5. Importar dicionarios:
   - Importar `.zip` de dicionarios Yomitan.
   - Suportar Jitendex como primeiro alvo.
   - Indexar entradas localmente para lookup rapido.

## Fora do MVP

- DRM de EPUB/PDF.
- Sincronizacao em nuvem.
- OCR completo para PDF escaneado.
- Criacao automatica perfeita de furigana para qualquer frase.
- Parser completo equivalente ao Yomitan desde o primeiro release.
- Mobile.
- IA para traducao ou explicacao no primeiro corte.

Esses pontos podem entrar depois que o fluxo principal de leitura + lookup + Anki estiver estavel.

## Stack proposta

### Frontend

- React + TypeScript + Vite.
- `@tauri-apps/api` para comandos Tauri.
- `lucide-react` para icones, seguindo o exemplo do `PrimePrint`.
- `pdfjs-dist` para renderizacao de PDF.
- `epubjs` para renderizacao de EPUB.
- CSS simples por modulo/tela no inicio, evitando design system prematuro.

### Backend Tauri/Rust

- Tauri v2.
- `serde` e `serde_json` para DTOs.
- `rusqlite` com SQLite local para documentos, marcacoes, dicionarios e fila de Anki.
- `zip` para importar dicionarios Yomitan.
- `reqwest` ou plugin HTTP Tauri para falar com AnkiConnect.
- Storage em `%APPDATA%\Shiori` no Windows.

### Banco local

Usar SQLite como fonte de verdade local. O frontend nao deve manipular o banco diretamente; ele chama comandos Tauri. Isso mantem validacao, migracoes, paths e integracao com Anki em uma fronteira clara.

## Arquitetura

```text
shiori/
├── public/
├── src/
│   ├── App.tsx
│   ├── App.css
│   ├── main.tsx
│   ├── components/
│   │   ├── ShioriShell.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Toolbar.tsx
│   │   ├── DictionaryPopup.tsx
│   │   ├── AnkiCardPreview.tsx
│   │   └── HighlightLayer.tsx
│   ├── viewers/
│   │   ├── PdfViewer.tsx
│   │   └── EpubViewer.tsx
│   ├── services/
│   │   ├── tauri.ts
│   │   ├── selection.ts
│   │   └── japanese.ts
│   └── styles/
│       └── lapis-card.css
├── src-tauri/
│   ├── capabilities/
│   ├── migrations/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── db.rs
│   │   ├── documents.rs
│   │   ├── annotations.rs
│   │   ├── dictionaries.rs
│   │   ├── anki.rs
│   │   └── settings.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── anki-templates/
│   ├── front.html
│   ├── back.html
│   └── styling.css
├── package.json
└── README.md
```

## Modelo de dados inicial

```sql
documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL, -- pdf | epub
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

reading_positions (
  document_id TEXT PRIMARY KEY,
  locator_type TEXT NOT NULL, -- pdf_page | epub_cfi
  locator TEXT NOT NULL,
  page_index INTEGER,
  scroll_x REAL DEFAULT 0,
  scroll_y REAL DEFAULT 0,
  zoom REAL DEFAULT 1,
  progress REAL DEFAULT 0,
  updated_at TEXT NOT NULL
);

bookmarks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  locator_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  label TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

highlights (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  locator_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  context_before TEXT,
  context_after TEXT,
  range_json TEXT NOT NULL,
  color TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

dictionary_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL, -- yomitan
  revision TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  imported_at TEXT NOT NULL
);

dictionary_terms (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  expression TEXT NOT NULL,
  reading TEXT,
  sequence INTEGER,
  score INTEGER DEFAULT 0,
  term_json TEXT NOT NULL
);

lookup_history (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  expression TEXT NOT NULL,
  reading TEXT,
  sentence TEXT,
  selected_text TEXT,
  anki_note_id INTEGER,
  created_at TEXT NOT NULL
);

anki_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deck_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  field_mapping_json TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Para busca rapida, criar indice normal em `(expression, reading)` e depois avaliar FTS5 para glossarios e busca ampla.

## Estrategia de leitura

### PDF

Usar `pdfjs-dist` no frontend:

- Renderizar pagina em canvas.
- Ativar text layer para selecao real.
- Guardar posicao como `page_index`, `scroll_y`, `zoom` e `progress`.
- Guardar highlights como:
  - pagina,
  - texto selecionado,
  - retangulos relativos ao viewport da pagina,
  - contexto antes/depois para recuperacao se o layout mudar.

Trade-off: highlights em PDF nunca sao tao estaveis quanto EPUB. Por isso o MVP deve salvar texto + retangulos + pagina, e nao depender de coordenadas absolutas como unica fonte.

### EPUB

Usar `epubjs`:

- Renderizar capitulos.
- Usar EPUB CFI para localizacao e highlights.
- Persistir `cfi`, `href`, progresso e frase selecionada.

EPUB deve ser o formato mais confiavel para marcacoes textuais, porque CFI sobrevive melhor a zoom e redimensionamento.

## Experiencia de interface

Layout principal:

- Barra superior com abas de documentos, abrir arquivo, busca, zoom e modo claro/escuro.
- Sidebar esquerda com:
  - sumario,
  - favoritos,
  - marcacoes,
  - historico recente.
- Area central de leitura sem cards decorativos, com pagina/conteudo como foco.
- Popup flutuante de dicionario proximo ao texto selecionado.
- Drawer direito opcional para revisar definicao e montar card Anki.

Atalhos iniciais:

- `Ctrl+O`: abrir arquivo.
- `Ctrl+F`: buscar no documento.
- `Ctrl+B`: favoritar localizacao atual.
- `H`: destacar selecao atual.
- `A`: abrir criacao de card Anki para a ultima busca.
- `Esc`: fechar popup/drawer.
- Setas/PageUp/PageDown: navegar.

## Lookup tipo Yomitan

Fluxo:

1. Usuario seleciona texto ou clica em palavra japonesa.
2. Frontend extrai:
   - termo alvo,
   - frase atual,
   - texto selecionado,
   - localizacao no documento.
3. Backend recebe `lookup_term`.
4. Backend normaliza termo:
   - katakana/hiragana quando necessario,
   - pontuacao,
   - formas comuns.
5. Backend tenta:
   - match exato,
   - longest-prefix match,
   - deinflection simples para verbos/adjetivos.
6. Popup exibe:
   - expressao,
   - leitura,
   - tags,
   - frequencia,
   - definicoes por dicionario,
   - exemplos,
   - pitch quando a entrada trouxer essa informacao.

O primeiro corte nao precisa reproduzir 100% do Yomitan. O alvo e ser bom o bastante para Jitendex/JMdict e gerar cards uteis. Depois podemos melhorar deinflection, pitch, audio e ranking.

## Importacao de dicionarios

Entrada:

- Arquivo `.zip` de dicionario Yomitan.

Processo:

1. Descompactar em pasta temporaria.
2. Ler `index.json`.
3. Importar `term_bank_*.json`, `term_meta_bank_*.json`, `kanji_bank_*.json` quando existirem.
4. Salvar o JSON bruto por entrada para nao perder formatacao rica.
5. Criar campos normalizados para busca:
   - `expression`,
   - `reading`,
   - `score`,
   - `sequence`,
   - `source_id`.
6. Registrar fonte em `dictionary_sources`.

Renderizacao:

- Inicialmente renderizar glossarios como HTML seguro gerado pelo app.
- Tratar structured content do Yomitan gradualmente.
- Nao executar scripts vindos de dicionarios.

## Integracao com Anki

### Caminho principal

Usar AnkiConnect:

- Endpoint local: `POST http://127.0.0.1:8765`.
- Primeiro testar `version`.
- Criar decks/modelos se o usuario pedir.
- Enviar cards com `addNote`.

### Perfil de card

Criar um perfil padrao:

- Deck: configuravel, exemplo `Japanese::Shiori`.
- Model: configuravel, exemplo `Lapis Shiori`.
- Tags: `shiori yomitan`.
- Campos seguindo os nomes do template enviado.

### Geracao de campos

Mapeamento inicial:

```text
Expression           <- termo escolhido
ExpressionReading    <- leitura da entrada
ExpressionFurigana   <- expressao com furigana, quando disponivel
ExpressionAudio      <- audio da palavra, quando disponivel
Sentence             <- frase capturada no documento
SentenceFurigana     <- frase com furigana, se o app conseguir gerar/importar
SentenceAudio        <- audio da frase, futuro
SelectionText        <- texto selecionado no documento
MainDefinition       <- definicao principal escolhida
Glossary             <- HTML das definicoes
PitchPosition        <- pitch extraido de dicionario/meta, quando houver
PitchCategories      <- categorias de pitch, quando houver
Frequency            <- dados de frequencia
FreqSort             <- numero principal de frequencia
Picture              <- imagem anexada pelo usuario, futuro
DefinitionPicture    <- imagem do dicionario, quando houver
Tags                 <- tags de origem + tags manuais
IsSentenceCard       <- flag configuravel
IsWordAndSentenceCard<- flag configuravel
IsClickCard          <- flag configuravel
IsAudioCard          <- flag configuravel
Hint                 <- nota curta opcional
```

### Preview

O app deve ter um preview do front/back antes de enviar:

- Reusar `anki-templates/front.html`, `back.html` e `styling.css`.
- Renderizar em iframe sandbox.
- Substituir placeholders `{{Campo}}` com os valores atuais.
- Exibir erros quando campo obrigatorio estiver vazio.

## Seguranca e privacidade

- Todo dado fica local por padrao.
- Nao enviar documentos para servicos externos.
- Nao executar HTML/script vindo de EPUB, PDF, dicionario ou template sem sanitizacao.
- Permitir apenas paths escolhidos pelo usuario via dialogo.
- O backend deve validar paths e nao aceitar leitura arbitraria por string vinda do frontend.
- Logs nao devem conter grandes trechos dos livros por padrao.

## Fases de implementacao

### Fase 0: Scaffold do projeto

Objetivo: criar base Tauri/React seguindo `PrimePrint`.

Tarefas:

- Criar app Tauri v2 + React + TypeScript + Vite.
- Configurar scripts:
  - `npm run dev`
  - `npm run build`
  - `npm run tauri dev`
  - `npm run build:windows-installer`
- Configurar `src-tauri/tauri.conf.json` com nome do produto.
- Criar README inicial.
- Criar pastas `anki-templates/` com front/back/styling enviados pelo usuario.

Aceite:

- `npm run build` passa.
- `npm run tauri dev` abre janela vazia com shell inicial.

### Fase 1: Persistencia local

Objetivo: preparar SQLite e comandos de documentos.

Tarefas:

- Implementar `db.rs` com inicializacao e migracoes.
- Criar comandos:
  - `open_document_record`
  - `list_recent_documents`
  - `save_reading_position`
  - `get_reading_position`
- Salvar DB em `%APPDATA%\Shiori\shiori.sqlite3`.

Aceite:

- Abrir um arquivo cria/atualiza registro em `documents`.
- Posicao salva e recuperada apos reiniciar o app.

### Fase 2: Shiori shell e PDF

Objetivo: ler PDF com experiencia base de Sumatra.

Tarefas:

- Criar `ShioriShell`, `Toolbar`, `Sidebar`.
- Implementar `PdfViewer` com `pdfjs-dist`.
- Adicionar zoom, pagina anterior/proxima, input de pagina.
- Ler outline do PDF quando disponivel.
- Debounce de autosave de pagina/scroll/zoom.

Aceite:

- PDF abre por dialogo.
- Usuario fecha e reabre o app voltando para a pagina anterior.
- Sumario aparece quando o PDF oferece outline.

### Fase 3: EPUB

Objetivo: ler EPUB com sumario e progresso.

Tarefas:

- Implementar `EpubViewer` com `epubjs`.
- Navegar por capitulos.
- Salvar/restaurar CFI.
- Exibir TOC na sidebar.

Aceite:

- EPUB abre por dialogo.
- Reabre na mesma localizacao.
- TOC navega entre capitulos.

### Fase 4: Favoritos, highlights e notas

Objetivo: marcar material de estudo.

Tarefas:

- Implementar `bookmarks` por localizacao atual.
- Implementar highlights para EPUB via CFI.
- Implementar highlights para PDF via pagina + retangulos + texto.
- Criar painel de marcacoes na sidebar.
- Permitir editar nota curta.

Aceite:

- Marcacoes sobrevivem ao restart.
- Clicar em uma marcacao navega ate o trecho.
- PDF e EPUB tem pelo menos uma estrategia funcional de highlight.

### Fase 5: Dicionarios e lookup

Objetivo: importar Yomitan/Jitendex e exibir popup.

Tarefas:

- Criar importador `.zip` Yomitan.
- Persistir `dictionary_sources` e `dictionary_terms`.
- Implementar `lookup_term`.
- Implementar longest-prefix match.
- Implementar deinflection inicial.
- Criar `DictionaryPopup`.

Aceite:

- Importar Jitendex.
- Selecionar/clicar em palavra japonesa abre popup com definicoes.
- Popup mostra leitura, tags, frequencia e exemplos quando existirem.

### Fase 6: AnkiConnect e card preview

Objetivo: gerar cards diretamente do Shiori.

Tarefas:

- Criar `anki.rs` com comandos:
  - `anki_check_connection`
  - `anki_list_decks`
  - `anki_list_models`
  - `anki_add_note`
- Criar perfil de campos em `anki_profiles`.
- Implementar `AnkiCardPreview`.
- Renderizar templates enviados em iframe.
- Enviar card com `addNote`.
- Salvar `anki_note_id` no historico.

Aceite:

- App detecta AnkiConnect.
- Usuario escolhe deck/modelo.
- Card gerado aparece no Anki com campos preenchidos.
- Preview front/back mostra o resultado antes do envio.

### Fase 7: Polimento de leitura

Objetivo: deixar o app agradavel para uso diario.

Tarefas:

- Abas persistentes.
- Busca no documento.
- Tema claro/escuro.
- Atalhos.
- Estados vazios e mensagens em portugues.
- Tratamento de erro para arquivo movido/removido.

Aceite:

- App pode ser usado por varias sessoes sem perder estado.
- Erros comuns sao explicados de forma clara.

### Fase 8: Testes e empacotamento

Objetivo: preparar instalador e reduzir regressao.

Tarefas:

- Testes Rust para DB, importacao de dicionario e payload AnkiConnect.
- Testes frontend para componentes principais.
- Validacao manual com:
  - PDF com outline,
  - PDF sem outline,
  - EPUB,
  - Jitendex,
  - Anki aberto,
  - Anki fechado.
- Build Windows NSIS.

Aceite:

- `npm run build` passa.
- `cargo fmt`, `cargo check` e `cargo test` passam em `src-tauri`.
- Instalador abre o app em uma maquina Windows limpa.

## Comandos de validacao esperados

```bash
npm install
npm run build
npm run tauri dev
```

Dentro de `src-tauri`:

```bash
cargo fmt
cargo check
cargo test
```

## Riscos principais

1. Highlights em PDF
   - Risco: coordenadas mudam com zoom/renderizacao.
   - Mitigacao: salvar pagina + texto + contexto + retangulos relativos.

2. Dicionario Yomitan
   - Risco: structured content varia por dicionario.
   - Mitigacao: guardar JSON bruto e melhorar renderer por dicionario conforme necessidade.

3. Deinflection japonesa
   - Risco: primeira versao pode perder formas conjugadas.
   - Mitigacao: comecar simples e adicionar regras a partir dos erros reais.

4. AnkiConnect indisponivel
   - Risco: Anki fechado ou add-on nao instalado.
   - Mitigacao: detectar conexao, mostrar instrucoes e manter fila local para enviar depois.

5. Performance com dicionarios grandes
   - Risco: importacao e lookup lentos.
   - Mitigacao: transacoes SQLite, indices, importacao em background e progresso visivel.

6. Seguranca de HTML externo
   - Risco: EPUB/dicionario/template contem HTML inesperado.
   - Mitigacao: sanitizar, iframe sandbox e nunca executar scripts externos.

## Decisoes recomendadas

- Comecar com SQLite gerenciado pelo Rust, nao LocalStorage.
- Implementar PDF antes de EPUB porque o comportamento visual esperado vem do Sumatra.
- Implementar Jitendex como primeiro dicionario validado.
- Usar AnkiConnect como primeira integracao, nao gerar `.apkg` no MVP.
- Manter o app local-first; qualquer integracao externa deve ser opt-in.
- Trazer os templates Lapis para `anki-templates/` como arquivos editaveis pelo usuario.

## Perguntas abertas antes da implementacao

1. O app precisa ser somente Windows no inicio, como o `PrimePrint`, ou deve manter Linux/macOS como alvo tecnico?
2. O modelo de card no Anki ja existe no seu Anki ou o app deve criar o model automaticamente?
3. O primeiro foco de leitura e PDF, EPUB ou ambos no MVP?
4. Os dicionarios iniciais serao Jitendex/JMdict ou voce quer importar tambem pitch/frequency no primeiro corte?
5. Voce quer usar o template Lapis exatamente como enviado ou criar uma variante propria do Shiori?

## Referencias tecnicas

- Tauri v2: https://v2.tauri.app/
- PDF.js: https://mozilla.github.io/pdf.js/
- epub.js: https://github.com/futurepress/epub.js/
- Yomitan: https://github.com/yomidevs/yomitan/
- AnkiConnect: https://ankiweb.net/shared/info/2055492159
