# Shannon — AI Security Scanner

You are helping a user run Shannon, an automated security scanner for web applications. Shannon analyzes source code and optionally tests a live website to find vulnerabilities.

## Quick Reference

```bash
# Install and build (one time)
pnpm install && pnpm build

# Scan with live URL
./shannon start -u https://example.com -r /path/to/repo

# Scan code only (no live URL needed)
./shannon start -r /path/to/repo

# With named workspace (can resume later)
./shannon start -u https://example.com -r /path/to/repo -w my-scan

# Monitor
./shannon logs <workspace>

# Stop
./shannon stop
```

## Setup Flow

When a user asks you to scan a project with Shannon, follow these steps:

### Step 1: Check Prerequisites

Verify these are available:
- Docker Desktop is running: `docker info`
- Node.js 18+: `node --version`
- pnpm: `pnpm --version` (install with `npm install -g pnpm` if missing)

### Step 2: Build Shannon (if not already built)

```bash
cd <shannon-repo-directory>
pnpm install
pnpm build
```

### Step 3: Configure Credentials

Check what the user has by reading `.env`. If no `.env` exists, create one.

**Auto-detect the agent CLI being used and configure accordingly:**

| Agent | Detection | Credential Source |
|-------|-----------|-------------------|
| Claude Code | `claude --version` succeeds | Read `~/.claude/.credentials.json` → `claudeAiOauth.accessToken` |
| Codex | `codex --version` succeeds | Read `~/.codex/auth.json` → check if tokens exist |
| Gemini | `gemini --version` succeeds | Read `~/.gemini/settings.json` → check auth method |

**Create `.env` based on what's available:**

For Claude Code (OAuth subscription):
```
CLAUDE_CODE_OAUTH_TOKEN=<token from ~/.claude/.credentials.json>
SHANNON_AGENT_CLI=claude
CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

For Codex (ChatGPT account):
```
OPENAI_API_KEY=<if available, otherwise codex uses its own auth>
SHANNON_AGENT_CLI=codex
CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

For Gemini (Google account):
```
SHANNON_AGENT_CLI=gemini
CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

If the user has an API key instead:
```
ANTHROPIC_API_KEY=<key>
CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

### Step 4: Ask the User What to Scan

Ask these questions:
1. **What repo to scan?** — Get the path to the source code
2. **Is there a live URL?** — If yes, use it. If no, Shannon runs in code-only mode (analyzes source code only, no live exploitation)
3. **Does the app need login?** — If yes, create a `config.yaml` with auth details
4. **Named workspace?** — Optional, for easy resume

### Step 5: Run the Scan

```bash
# With live URL
./shannon start -u <url> -r <repo-path> -w <workspace-name>

# Code only (no live URL)
./shannon start -r <repo-path> -w <workspace-name>

# Local app (running on host machine)
./shannon start -u http://host.docker.internal:<port> -r <repo-path> -w <workspace-name>

# With OpenAI/Gemini via router
./shannon start -u <url> -r <repo-path> --router
```

First run builds the Docker image automatically (~5-10 minutes).

### Step 6: Monitor Progress

```bash
# Tail the workflow log
./shannon logs <workspace>

# Or read the log file directly
cat workspaces/<workspace>/workflow.log

# Check agent status
cat workspaces/<workspace>/session.json
```

### Step 7: Deliver Results

When the scan completes, the report is at:
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
