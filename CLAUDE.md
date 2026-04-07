# Shannon — AI Security Scanner

You are helping a user run Shannon, an automated security scanner for web applications. Shannon analyzes source code and optionally tests a live website to find vulnerabilities.

## Quick Reference

```bash
pnpm install && pnpm build   # one time
./shannon setup               # auto-detects agent + credentials
./shannon start -r /path/to/repo [-u https://app.com]
./shannon logs <workspace>    # monitor
./shannon stop                # stop
```

## Setup Flow

When a user asks you to scan a project with Shannon, follow these steps:

### Step 1: Check Prerequisites

```bash
docker info          # Docker must be running
node --version       # Need 18+
pnpm --version       # Need 10.16+ (install: npm i -g pnpm)
```

### Step 2: Build and Setup

```bash
cd <shannon-repo-directory>
pnpm install
pnpm build
./shannon setup      # auto-detects Claude/Codex/Gemini, writes .env
```

`./shannon setup` automatically:
- Detects which agent CLIs are installed (Claude Code, Codex, Gemini)
- Reads their credential files
- Picks the best authenticated agent
- Writes `.env` with the correct configuration

### Step 3: Ask the User What to Scan

Ask these questions:
1. **What repo to scan?** — Get the path to the source code
2. **Is there a live URL?** — If yes, use it. If no, Shannon runs in code-only mode
3. **Does the app need login?** — If yes, create a `config.yaml` with auth details

### Step 4: Run the Scan

```bash
# With live URL
./shannon start -u <url> -r <repo-path>

# Code only (no live URL)
./shannon start -r <repo-path>

# Local app (running on host machine)
./shannon start -u http://host.docker.internal:<port> -r <repo-path>
```

First run builds the Docker image automatically (~5-10 minutes).

### Step 5: Monitor and Deliver Results

```bash
./shannon logs <workspace>
# Or: cat workspaces/<workspace>/workflow.log
```

When done, the report is at:
```
workspaces/<workspace>/deliverables/comprehensive_security_assessment_report.md
```

Read it and summarize the findings for the user.

## Authentication Config (Optional)

If the target app requires login, create a config file:

```yaml
authentication:
  login_type: form
  login_url: "https://app.com/login"
  credentials:
    username: "test@example.com"
    password: "testpassword"
  login_flow:
    - "Type $username into the email field"
    - "Type $password into the password field"
    - "Click the Sign In button"
```

Run with: `./shannon start -u <url> -r <repo> -c config.yaml`

## Agent CLI Selection

Shannon supports three coding agent CLIs inside Docker:

| Value | CLI | Auth |
|-------|-----|------|
| `claude` (default) | Claude Code | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| `codex` | OpenAI Codex | `OPENAI_API_KEY` or Codex browser auth |
| `gemini` | Google Gemini | `GEMINI_API_KEY` or Gemini browser auth |

Set via `SHANNON_AGENT_CLI=<value>` in `.env`.

Host CLI credentials (`~/.claude/`, `~/.codex/`, `~/.gemini/`) are automatically mounted into the Docker container.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Docker not running | Start Docker Desktop |
| pnpm not found | `npm install -g pnpm` |
| Build fails | `pnpm install && pnpm build` |
| "Temporal not ready" | Wait 30 seconds, retry |
| Local app unreachable | Use `http://host.docker.internal:<port>` |
| Scan stuck | Check `./shannon logs <workspace>` |
| Start over | `./shannon stop --clean` |
| Resume interrupted scan | Same start command with same `-w` name |

## Architecture (For Development)

See [DEVELOPMENT.md](./DEVELOPMENT.md) for full architecture docs, code conventions, and contribution guide.

### Key Paths
- `apps/cli/` — CLI package (Docker orchestration)
- `apps/worker/` — Worker package (Temporal + pipeline logic)
- `apps/worker/src/ai/cli-adapter.ts` — Agent CLI factory (claude/codex/gemini)
- `apps/worker/src/ai/claude-code-cli.ts` — Claude Code adapter
- `apps/worker/src/ai/codex-cli.ts` — Codex adapter
- `apps/worker/src/ai/gemini-cli.ts` — Gemini adapter
- `apps/worker/prompts/` — Agent prompt templates
- `apps/worker/configs/` — Example scan configs
