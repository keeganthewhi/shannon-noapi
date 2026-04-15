<div align="center">

# Shannon — No API Keys Required

### The Original Shannon AI Security Scanner, Adapted for CLI Subscriptions

<br />

**Claude Code** | **OpenAI Codex** | **Google Gemini**

**CLI** | **VS Code** | **JetBrains** | **Desktop App** | **Web**

<br />

Tell your AI agent: *"Scan my project for security vulnerabilities"* — and Shannon does the rest.

<br />

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/keeganthewhi/shannon-noapi?style=social)](https://github.com/keeganthewhi/shannon-noapi)

---

</div>

## What Is This?

This is the **original [Shannon](https://github.com/KeygraphHQ/shannon)** by [Keygraph](https://keygraph.io) — the AI-powered penetration testing framework — adapted to work with **any coding agent CLI subscription** instead of requiring API keys.

The upstream Shannon requires direct API access (Anthropic API key, OpenAI API key, etc.), which costs per-token. This fork replaces the API-key authentication layer with CLI-based authentication, so if you already have a **Claude Max/Pro**, **ChatGPT Plus/Pro**, or **Google Gemini** subscription, you can run Shannon at **$0 extra cost** — the same AI models, the same 5-phase security pipeline, just billed through your existing subscription instead of a separate API budget.

### What changed from the original

| | Original Shannon | This Fork |
|---|---|---|
| **Repo** | [KeygraphHQ/shannon](https://github.com/KeygraphHQ/shannon) | [keeganthewhi/shannon-noapi](https://github.com/keeganthewhi/shannon-noapi) |
| **Auth** | API keys (`ANTHROPIC_API_KEY`, etc.) | CLI subscriptions (`claude` / `codex` / `gemini` logged in on host) |
| **Cost** | Per-token API charges | $0 extra with existing subscription |
| **AI Backend** | Direct Anthropic/OpenAI/Google API calls | Agent CLI subprocesses (same models, same quality) |
| **Pipeline** | Identical 5-phase pentest pipeline | Identical 5-phase pentest pipeline |
| **Output** | Same report format | Same report format |
| **Docker** | Same worker image | Same worker image + container hardening |

Everything else — the 5-phase pipeline, the multi-agent architecture, the Temporal orchestration, the Playwright-based exploitation, the report format — is **identical to upstream Shannon**. The fork tracks upstream and merges regularly.

### How it works

Shannon's pipeline uses AI agents for each phase. The original calls the AI vendor's HTTP API directly. This fork instead spawns the vendor's CLI tool (`claude`, `codex`, or `gemini`) as a subprocess inside the Docker worker container. The CLI tool handles authentication through its own credential files (`~/.claude/.credentials.json`, `~/.codex/auth.json`, `~/.gemini/oauth_creds.json`) which are bind-mounted read-only from the host. No API keys are ever written to disk or passed as environment variables.

| Feature | Details |
|---------|---------|
| **Agents** | Claude Code, OpenAI Codex, Google Gemini |
| **Targets** | Any web app — live URL, localhost, or code-only |
| **Cost** | $0 extra with Claude Max/Pro, ChatGPT Plus, or Gemini |
| **Output** | Full security report with proof-of-concept exploits |
| **Runtime** | ~1–6 hours per full scan (depends on target size) |

## How It Works

```
You: "Scan my project at /projects/myapp for security bugs"

Your AI Agent:
  1. Configures Shannon automatically
  2. Builds Docker container
  3. Runs 5-phase security pipeline:

     Phase 1: Code Analysis ──── reads your source code
     Phase 2: Recon ──────────── maps attack surface
     Phase 3: Vuln Analysis ──── 5 parallel agents hunt bugs
     Phase 4: Exploitation ───── proves each vulnerability
     Phase 5: Report ─────────── writes the security report

  4. Delivers report with findings + proof
```

## Quick Start

**Requires:** [Docker Desktop](https://docs.docker.com/get-docker/) (running), [Node.js 18+](https://nodejs.org/), [pnpm](https://pnpm.io/) (`npm i -g pnpm`), and at least one agent CLI logged in on your host — `claude` / `codex` / `gemini`.

```bash
git clone https://github.com/keeganthewhi/shannon-noapi.git
cd shannon-noapi
pnpm install && pnpm build
./shannon setup
./shannon start -r /path/to/your/repo
```

That's it. `setup` auto-detects your agent (Claude/Codex/Gemini) and credentials. `start` builds Docker, launches the scan.

---

## Detailed Setup

### 1. Download

```bash
git clone https://github.com/keeganthewhi/shannon-noapi.git
cd shannon-noapi
```

### 2. Open Your AI Agent

Works with **any interface** — CLI, VS Code extension, JetBrains plugin, desktop app, or web:

| Agent | CLI | VS Code | JetBrains | Desktop | Web |
|-------|-----|---------|-----------|---------|-----|
| **Claude Code** | `claude` | Claude Code extension | JetBrains plugin | Claude Desktop | claude.ai/code |
| **OpenAI Codex** | `codex` | Codex extension | - | - | chatgpt.com |
| **Google Gemini** | `gemini` | Gemini Code Assist | - | - | gemini.google.com |

Open the `shannon-noapi` folder in your tool. The agent reads `CLAUDE.md` / `AGENTS.md` and knows what to do.

### 3. Tell It What to Scan

> "Set up Shannon and scan my project at /path/to/myapp. The website is at https://myapp.com"

Or for code-only (no live URL):

> "Set up Shannon and scan the code at /path/to/myapp"

Your agent will:
- Install dependencies (`pnpm install && pnpm build`)
- Detect your credentials automatically
- Configure `.env` for you
- Start Docker and launch the scan
- Monitor progress and deliver the report

**That's it.** No manual config needed.

---

## Manual Setup (If You Prefer)

<details>
<summary>Click to expand manual instructions</summary>

### Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (running)
- [Node.js 18+](https://nodejs.org/)
- pnpm: `npm install -g pnpm`

### Install

```bash
pnpm install
pnpm build
```

### Configure

The easy path — auto-detect everything you already have:

```bash
./shannon setup
```

This scans your PATH for `claude` / `codex` / `gemini`, checks `~/.claude/`, `~/.codex/`, `~/.gemini/` for live credentials, and writes `.env` for you. No editing required. The worker reads the live OAuth token on every run, so refreshes on the host automatically propagate.

If you want to bypass agent CLIs and use an API key or custom provider, edit `.env` manually instead:

```bash
cp .env.example .env
```

| You Have | Set In .env |
|----------|-------------|
| Claude Code logged in on host | *(nothing — `./shannon setup` handles it)* |
| Codex logged in on host | *(nothing — `./shannon setup` handles it)* |
| Gemini logged in on host | *(nothing — `./shannon setup` handles it)* |
| Anthropic API key | `ANTHROPIC_API_KEY=<key>` |
| OpenAI API key | `OPENAI_API_KEY=<key>` + `ROUTER_DEFAULT=openai,gpt-5.2` |
| OpenRouter API key | `OPENROUTER_API_KEY=<key>` + `ROUTER_DEFAULT=...` |

### Run

```bash
# Scan with live website
./shannon start -u https://myapp.com -r /path/to/code

# Scan code only (no website needed)
./shannon start -r /path/to/code

# Local app
./shannon start -u http://host.docker.internal:3000 -r /path/to/code

# Named workspace (resumable)
./shannon start -u https://myapp.com -r /path/to/code -w my-audit

# Monitor
./shannon logs <workspace>

# Stop
./shannon stop
```

### Results

```
workspaces/<workspace>/deliverables/
  comprehensive_security_assessment_report.md   <-- the report
  pre_recon_deliverable.md
  *_analysis_deliverable.md
  *_exploitation_evidence.md
```

</details>

---

## Supported Agents

| Agent | Auth Method | How It Works |
|-------|------------|--------------|
| **Claude Code** | Claude Max/Pro subscription | OAuth token auto-detected from `~/.claude/` |
| **OpenAI Codex** | ChatGPT Plus/Pro | Browser auth auto-detected from `~/.codex/` |
| **Google Gemini** | Google account | Browser auth auto-detected from `~/.gemini/` |

All three agent CLIs are pre-installed in Shannon's Docker image. Host credentials are mounted read-only — tokens refresh on the host and propagate automatically.

### Picking a specific model

Shannon drives each agent CLI through its own default model. Override with env vars:

| Agent | Env var | Example |
|---|---|---|
| **Codex** | `CODEX_MODEL` | `CODEX_MODEL=gpt-5.2 ./shannon start -r /path/to/repo` |
| **Gemini** | `GEMINI_MODEL` | `GEMINI_MODEL=gemini-2.5-pro ./shannon start -r /path/to/repo` |
| **Claude Code** | (not supported — Claude Code CLI uses its bundled model tiers) | — |

## Supported Targets

| Target | Command |
|--------|---------|
| **Live website** | `./shannon start -u https://example.com -r /path/to/code` |
| **Local app** | `./shannon start -u http://host.docker.internal:3000 -r /path/to/code` |
| **Code only** | `./shannon start -r /path/to/code` |

## What Shannon Finds

| Category | Examples |
|----------|---------|
| **Injection** | SQL injection, command injection, template injection |
| **XSS** | Reflected, stored, DOM-based cross-site scripting |
| **Authentication** | Login bypass, session fixation, weak tokens |
| **Authorization** | IDOR, privilege escalation, missing access controls |
| **SSRF** | Server-side request forgery, open redirects |

Every finding includes a **working proof-of-concept exploit**. No guessing.

## Authentication Config

If your app needs login to test:

```yaml
# config.yaml
authentication:
  login_type: form
  login_url: "https://myapp.com/login"
  credentials:
    username: "test@example.com"
    password: "testpass"
  login_flow:
    - "Type $username into the email field"
    - "Type $password into the password field"
    - "Click Sign In"
```

```bash
./shannon start -u https://myapp.com -r /path/to/code -c config.yaml
```

## Scan Profiles

Shannon automatically adjusts the number of vulnerability agents based on your project size:

| Profile | Source Files | Vuln Types | Parallel Agents |
|---------|-------------|-----------|-----------------|
| `minimal` | < 50 | injection, auth | 4 |
| `standard` | 50–300 | injection, xss, auth, authz | 8 |
| `comprehensive` | 300+ | all 5 | 10 |

**Auto-detected by default.** Override with `--profile`:

```bash
./shannon start -r /path/to/code --profile minimal       # fast, 2 vuln types
./shannon start -r /path/to/code --profile comprehensive  # full, all 5 types
```

Or set in config YAML:

```yaml
pipeline:
  scan_profile: standard
```

## Re-running Exploitation

Already ran a scan and want to re-test just the exploitation phase? Use `--skip-to exploit` with an existing workspace:

```bash
./shannon start -r /path/to/code -u https://myapp.com -w my-audit --skip-to exploit
```

This skips pre-recon, recon, and vuln analysis (reusing their deliverables) and only re-runs the exploit agents + report. Saves $15–30 per re-run.

## Report Metrics

Every report includes an appendix with per-agent metrics:

```
## Appendix: Scan Metrics

| Agent        | Duration | Cost (USD) | Input Tokens | Output Tokens | ...
|--------------|----------|------------|--------------|---------------|
| pre-recon    | 27m 32s  | $4.26      | 17,872       | 23,529        |
| recon        | 16m 19s  | $2.57      | 18           | 25,478        |
| ...          | ...      | ...        | ...          | ...           |
| **Total**    | **2h 34m** | **$24.57** | **29,020** | **275,051**   |

- Scan Profile: comprehensive (auto-detected, 856 source files)
- Model: claude-opus-4-6, claude-sonnet-4-6
```

## All Commands

```bash
./shannon start -r <repo> [-u <url>] [-w <name>] [-c <config>] [options]
./shannon logs <workspace>
./shannon status
./shannon workspaces
./shannon stop [--clean]
./shannon build [--no-cache]
```

### Start Options

| Option | Description |
|--------|-------------|
| `-u, --url <url>` | Target URL (omit for code-only mode) |
| `-r, --repo <path>` | Repository path (required) |
| `-c, --config <path>` | Configuration file (YAML) |
| `-o, --output <path>` | Copy deliverables to this directory |
| `-w, --workspace <name>` | Named workspace (auto-resumes if exists) |
| `--profile <tier>` | Scan profile: `minimal`, `standard`, `comprehensive`, `auto` |
| `--skip-to <phase>` | Skip to a later phase (currently: `exploit`) |
| `--pipeline-testing` | Use minimal prompts for fast testing |
| `--router` | Route requests through claude-code-router |

## Warnings

- **Only scan apps you own** or have written permission to test
- **Don't scan production** — Shannon actively exploits vulnerabilities
- **Review findings yourself** — AI can make mistakes

## Credits

This fork is based on [Shannon](https://github.com/KeygraphHQ/shannon) by [Keygraph](https://keygraph.io). The original Shannon is the pioneering AI-powered penetration testing framework. This fork adapts it for CLI-subscription-based authentication — all credit for the core pipeline, multi-agent architecture, Temporal orchestration, and exploitation methodology belongs to the Keygraph team.

## License

[AGPL-3.0](LICENSE)
