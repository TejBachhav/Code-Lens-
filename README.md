# CodeLens — Offline API Documentation Generator

[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Offline](https://img.shields.io/badge/network-zero%20calls-brightgreen.svg)](#security)

> **Automatically scan your codebase and generate API documentation, architecture docs, and runnable test suites — entirely offline.**

CodeLens is a VS Code extension that performs deterministic AST analysis on your API endpoints, enriches them with data-flow analysis, and optionally uses a locally-running LLM to generate human-readable documentation and test cases. **No data ever leaves your machine.**

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Endpoint Discovery** | Automatically finds all API endpoints across Python, TypeScript, JavaScript, and XML |
| 📄 **OpenAPI 3.1** | Generates a complete OpenAPI specification in YAML |
| 📝 **Markdown Docs** | Rich endpoint documentation with request/response schemas |
| 🧪 **Test Generation** | Runnable pytest and Jest test suites with realistic assertions |
| 🌳 **TreeView** | Browse discovered endpoints in the VS Code sidebar |
| 🔒 **Fully Offline** | Zero network calls — all processing runs locally |
| 🤖 **Local LLM** | Optional Tier 3 enrichment via Ollama (never sends raw source code) |

## 🏗️ Supported Frameworks

| Language | Frameworks | Parser |
|----------|-----------|--------|
| Python | FastAPI, Flask | web-tree-sitter (WASM) |
| TypeScript | Express, NestJS | ts-morph |
| JavaScript | Express | web-tree-sitter (WASM) |
| XML | Spring MVC, web.xml, WSDL | fast-xml-parser |

---

## 🚀 Quick Start

### 1. Install the Extension

Install from the VS Code marketplace, or build from source:

```bash
git clone <repository>
cd codelens
npm install
npm run build
```

Then press `F5` in VS Code to launch the Extension Development Host.

### 2. Scan Your Workspace

- Open a project containing API endpoints
- Press `Ctrl+Shift+L S` (or `Cmd+Shift+L S` on Mac)
- Or use the Command Palette: **CodeLens: Scan Workspace**

### 3. View Results

- Open the **CodeLens** panel in the Activity Bar to browse endpoints
- Run **CodeLens: Generate Documentation** (`Ctrl+Shift+L D`) to generate docs
- Run **CodeLens: Generate Tests** (`Ctrl+Shift+L T`) to generate test suites

### 4. (Optional) Enable LLM Enrichment

For richer documentation with summaries, descriptions, and curl examples:

```bash
# Install Ollama (https://ollama.ai)
ollama pull deepseek-coder-v2:16b
```

The extension will automatically detect Ollama at `localhost:11434`.

---

## 📁 Output Structure

All generated files are placed in the `.codelens/` directory:

```
.codelens/
├── pipeline.json          # Raw scan data (useful for debugging)
├── openapi.yaml           # OpenAPI 3.1 specification
├── README.md              # Overview with endpoint index
├── endpoints/
│   ├── GET_users.md
│   ├── POST_users.md
│   └── GET_users_{id}.md
├── schemas/
│   ├── UserResponse.md
│   └── CreateUserDto.md
└── pytest/                # (or jest/ for TypeScript projects)
    ├── conftest.py
    └── test_app.py
```

---

## ⚙️ Configuration

All settings are available under **Settings → Extensions → CodeLens**:

| Setting | Default | Description |
|---------|---------|-------------|
| `codelens.ollama.url` | `http://localhost:11434` | Ollama server URL |
| `codelens.ollama.model` | `deepseek-coder-v2:16b` | LLM model for Tier 3 |
| `codelens.output.directory` | `.codelens` | Output directory name |
| `codelens.scan.excludePatterns` | `[**/node_modules/**,...]` | Glob patterns to exclude |
| `codelens.tier3.enabled` | `true` | Enable LLM enrichment |
| `codelens.tier3.concurrency` | `2` | Max concurrent Ollama requests |
| `codelens.tier3.temperature` | `0.1` | LLM temperature |
| `codelens.scan.languages` | `[python, typescript, javascript, xml]` | Languages to scan |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+L S` | Scan Workspace |
| `Ctrl+Shift+L D` | Generate Documentation |
| `Ctrl+Shift+L T` | Generate Tests |
| `Ctrl+Shift+L E` | Show Endpoints |

---

## 🔒 Security

CodeLens is designed with data security as a first principle:

- **Zero network calls** — the extension never phones home, sends telemetry, or makes any outbound requests
- **No raw source code to LLM** — Tier 3 only sends structured JSON metadata to the local Ollama instance, never actual source code
- **Local-only LLM** — Ollama runs on `localhost` with no external API calls
- **Deterministic fallback** — if Ollama is unavailable, Tiers 1+2 still produce complete, useful output

---

## 🏛️ Architecture

The pipeline has three tiers of analysis:

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │ Commands  │  │ TreeView  │  │   Status Bar         │  │
│  └─────┬────┘  └───────────┘  └──────────────────────┘  │
│        │                                                 │
│        ▼         IPC (JSON messages)                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Child Process (Worker)                │   │
│  │  ┌───────┐  ┌────────┐  ┌────────┐  ┌────────┐  │   │
│  │  │Tier 1 │→ │Tier 2  │→ │Tier 3  │→ │Output  │  │   │
│  │  │AST    │  │DataFlow│  │LLM     │  │Gen     │  │   │
│  │  └───────┘  └────────┘  └────────┘  └────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

- **Tier 1** (Deterministic): Pure AST parsing extracts endpoint definitions
- **Tier 2** (Deterministic): Inter-procedural data-flow analysis resolves types and detects side effects
- **Tier 3** (Optional): Local LLM generates summaries, descriptions, and test cases from structured JSON

---

## 🛠️ Development

### Prerequisites

- Node.js 18+
- npm 9+
- VS Code 1.85+

### Building

```bash
npm install
npm run build        # Production build
npm run dev          # Watch mode for development
```

### Testing

```bash
npm test             # Run unit tests
npm run test:integration  # Run integration tests
```

### Packaging

```bash
npm run package      # Create .vsix package
```

---

## 📜 License

MIT
