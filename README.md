<div align="center">

# Shannon for CLI

### AI Security Scanner That Works With Any Coding Agent

<br />

**Claude Code** | **OpenAI Codex** | **Google Gemini**

**CLI** | **VS Code** | **JetBrains** | **Desktop App** | **Web**

<br />

Tell your AI agent: *"Scan my project for security vulnerabilities"* — and Shannon does the rest.

<br />

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

---

</div>

## What Is This?

Shannon is an AI-powered security scanner. Point it at your source code (and optionally a live website), and it finds real vulnerabilities with proof-of-concept exploits.

This fork works with **any coding agent CLI** — no API credits needed if you have a subscription.

| Feature | Details |
|---------|---------|
| **Agents** | Claude Code, OpenAI Codex, Google Gemini |
| **Targets** | Any web app — live URL, localhost, or code-only |
| **Cost** | $0 extra with Claude Max/Pro, ChatGPT Plus, or Gemini |
| **Output** | Full security report with proof-of-concept exploits |
| **Runtime** | ~1-1.5 hours per full scan |

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

### 1. Download

```bash
git clone https://github.com/keeganthewhi/shannon-cc.git
cd shannon-cc
```

### 2. Open Your AI Agent

Works with **any interface** — CLI, VS Code extension, JetBrains plugin, desktop app, or web:

| Agent | CLI | VS Code | JetBrains | Desktop | Web |
|-------|-----|---------|-----------|---------|-----|
| **Claude Code** | `claude` | Claude Code extension | JetBrains plugin | Claude Desktop | claude.ai/code |
| **OpenAI Codex** | `codex` | Codex extension | - | - | chatgpt.com |
| **Google Gemini** | `gemini` | Gemini Code Assist | - | - | gemini.google.com |

Open the `shannon-cc` folder in your tool. The agent reads `CLAUDE.md` / `AGENTS.md` and knows what to do.

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

```bash
cp .env.example .env
```

Edit `.env` — pick ONE:

| You Have | Set In .env |
|----------|-------------|
| Claude Max/Pro | `CLAUDE_CODE_OAUTH_TOKEN=<token>` |
| Anthropic API key | `ANTHROPIC_API_KEY=<key>` |
| ChatGPT Plus (Codex) | `SHANNON_AGENT_CLI=codex` |
| Google account (Gemini) | `SHANNON_AGENT_CLI=gemini` |
| OpenAI API key | `OPENAI_API_KEY=<key>` + `--router` flag |

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
open http://localhost:8233

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

All three agent CLIs are pre-installed in Shannon's Docker image. Host credentials are mounted automatically.

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

## All Commands

```bash
./shannon start -r <repo> [-u <url>] [-w <name>] [-c <config>] [--router] [--pipeline-testing]
./shannon logs <workspace>
./shannon status
./shannon workspaces
./shannon stop [--clean]
./shannon build [--no-cache]
```

## Warnings

- **Only scan apps you own** or have written permission to test
- **Don't scan production** — Shannon actively exploits vulnerabilities
- **Review findings yourself** — AI can make mistakes

## Credits

Based on [Shannon](https://github.com/KeygraphHQ/shannon) by [Keygraph](https://keygraph.io).

## License

[AGPL-3.0](LICENSE)
