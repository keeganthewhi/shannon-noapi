/**
 * `shannon setup` for local mode — auto-detects agent CLI and credentials.
 *
 * Checks for Claude Code, Codex, and Gemini CLIs on the host,
 * reads their credential files, and writes .env automatically.
 * No user interaction needed — an AI agent can run this unattended.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface DetectedAgent {
  name: 'claude' | 'codex' | 'gemini';
  version: string;
  hasAuth: boolean;
  envLines: string[];
}

function tryExec(cmd: string, args: string[]): string | null {
  try {
    // Use shell with combined command to avoid the DEP0190 deprecation (args + shell: true)
    const fullCmd = [cmd, ...args].join(' ');
    return execFileSync(process.platform === 'win32' ? 'cmd' : 'sh',
      process.platform === 'win32' ? ['/c', fullCmd] : ['-c', fullCmd],
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function detectClaude(): DetectedAgent | null {
  const version = tryExec('claude', ['--version']);
  if (!version) return null;

  const home = os.homedir();
  const credsPath = path.join(home, '.claude', '.credentials.json');
  const envLines: string[] = ['SHANNON_AGENT_CLI=claude', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000'];
  let hasAuth = false;

  // Prefer mounted credentials over a snapshot in .env — Claude Code refreshes
  // OAuth tokens frequently and a snapshot goes stale within hours. The worker
  // container reads the live .credentials.json through the ~/.claude bind mount
  // (with a writable HOME redirect so session-env can be created).
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      if (creds?.claudeAiOauth?.accessToken) {
        hasAuth = true;
      }
    } catch {
      // Can't read credentials
    }
  }

  // Fall back to API key only if no OAuth credentials file exists
  if (!hasAuth && process.env.ANTHROPIC_API_KEY) {
    envLines.unshift(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
    hasAuth = true;
  }

  return { name: 'claude', version, hasAuth, envLines };
}

function detectCodex(): DetectedAgent | null {
  const version = tryExec('codex', ['--version']);
  if (!version) return null;

  const home = os.homedir();
  const authPath = path.join(home, '.codex', 'auth.json');
  const envLines: string[] = ['SHANNON_AGENT_CLI=codex', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000'];
  let hasAuth = false;

  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      if (auth?.tokens?.access_token || auth?.OPENAI_API_KEY) {
        hasAuth = true;
      }
    } catch {
      // Can't read credentials
    }
  }

  // Check for API key in environment
  if (!hasAuth && process.env.OPENAI_API_KEY) {
    envLines.unshift(`OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`);
    hasAuth = true;
  }

  return { name: 'codex', version, hasAuth, envLines };
}

function detectGemini(): DetectedAgent | null {
  const version = tryExec('gemini', ['--version']);
  if (!version) return null;

  const home = os.homedir();
  const settingsPath = path.join(home, '.gemini', 'settings.json');
  const oauthPath = path.join(home, '.gemini', 'oauth_creds.json');
  const envLines: string[] = ['SHANNON_AGENT_CLI=gemini', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000'];
  let hasAuth = false;

  // Check for OAuth credentials or settings
  if (fs.existsSync(oauthPath) || fs.existsSync(settingsPath)) {
    hasAuth = true;
  }

  // Check for API key in environment
  if (!hasAuth && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    envLines.unshift(`GEMINI_API_KEY=${key}`);
    hasAuth = true;
  }

  return { name: 'gemini', version, hasAuth, envLines };
}

/**
 * Detect which agent CLI is calling us by checking environment variables
 * that each agent sets when running subprocesses.
 */
function detectCallingAgent(): 'claude' | 'codex' | 'gemini' | null {
  // Claude Code sets these
  if (process.env.CLAUDE_CODE_ENTRY_POINT || process.env.CLAUDE_CONVERSATION_ID) return 'claude';
  // Codex sets these
  if (process.env.CODEX_SESSION_ID || process.env.OPENAI_CODEX) return 'codex';
  // Gemini sets these
  if (process.env.GEMINI_SESSION_ID || process.env.GOOGLE_GEMINI_CLI) return 'gemini';
  return null;
}

export function autoSetup(): void {
  console.log('Shannon Setup — Auto-detecting agent CLI and credentials...\n');

  // 1. Detect all available agent CLIs
  const agents: DetectedAgent[] = [];

  const claude = detectClaude();
  if (claude) agents.push(claude);

  const codex = detectCodex();
  if (codex) agents.push(codex);

  const gemini = detectGemini();
  if (gemini) agents.push(gemini);

  if (agents.length === 0) {
    console.error('ERROR: No agent CLI found. Install one of:');
    console.error('  Claude Code:  npm i -g @anthropic-ai/claude-code');
    console.error('  Codex:        npm i -g @openai/codex');
    console.error('  Gemini:       npm i -g @google/gemini-cli');
    process.exit(1);
  }

  // 2. Show what was found
  console.log('Detected agents:');
  for (const agent of agents) {
    const authStatus = agent.hasAuth ? 'authenticated' : 'NO AUTH';
    console.log(`  ${agent.name} (${agent.version}) — ${authStatus}`);
  }
  console.log('');

  // 3. Pick the best agent
  // Priority: env var override > calling agent detection > first authenticated
  const authenticated = agents.filter((a) => a.hasAuth);
  let selected: DetectedAgent;

  // Allow explicit override via env var
  const override = process.env.SHANNON_AGENT_CLI?.toLowerCase();
  const overrideMatch = override ? authenticated.find((a) => a.name === override) || agents.find((a) => a.name === override) : null;

  if (overrideMatch) {
    selected = overrideMatch;
    console.log(`Using agent from SHANNON_AGENT_CLI: ${selected.name}`);
  } else if (authenticated.length === 1) {
    // Only one authenticated — obvious choice
    selected = authenticated[0]!;
  } else if (authenticated.length > 1) {
    // Multiple authenticated — detect which agent is calling us
    const callingAgent = detectCallingAgent();
    const callerMatch = callingAgent ? authenticated.find((a) => a.name === callingAgent) : null;
    if (callerMatch) {
      selected = callerMatch;
      console.log(`Detected calling agent: ${selected.name}`);
    } else {
      // Can't auto-detect — list options and let user pick
      console.log('Multiple authenticated agents found. Pick one:');
      for (let i = 0; i < authenticated.length; i++) {
        console.log(`  ${i + 1}. ${authenticated[i]!.name}`);
      }
      console.log(`\nTo choose, re-run with: SHANNON_AGENT_CLI=<name> ./shannon setup`);
      console.log(`Defaulting to: ${authenticated[0]!.name}\n`);
      selected = authenticated[0]!;
    }
  } else {
    selected = agents[0]!;
  }

  // 4. Refuse to write an unauthenticated .env — that creates a confusing state
  // where `./shannon setup` succeeds but `./shannon start` fails mid-preflight.
  // Tell the user exactly how to log in instead.
  if (!selected.hasAuth) {
    console.error(`\nERROR: ${selected.name} is installed but not authenticated.`);
    console.error('');
    const loginInstructions: Record<string, string[]> = {
      claude: [
        "  1. Run 'claude' once in a terminal",
        '  2. Follow the browser sign-in prompt for Claude Max/Pro',
        '  3. Re-run ./shannon setup',
      ],
      codex: [
        "  1. Run 'codex' once in a terminal",
        '  2. Follow the browser sign-in prompt for ChatGPT Plus/Pro',
        '  3. Re-run ./shannon setup',
      ],
      gemini: [
        "  1. Run 'gemini' once in a terminal",
        '  2. Follow the browser sign-in prompt with your Google account',
        '  3. Re-run ./shannon setup',
      ],
    };
    for (const line of loginInstructions[selected.name] ?? []) {
      console.error(line);
    }
    console.error('');
    process.exit(1);
  }

  // 5. Write .env
  const envContent = selected.envLines.join('\n') + '\n';
  const envPath = path.resolve('.env');

  if (fs.existsSync(envPath)) {
    console.log(`Overwriting existing .env with ${selected.name} configuration.`);
  }

  fs.writeFileSync(envPath, envContent);
  console.log(`Written ${envPath}:`);
  for (const line of selected.envLines) {
    // Mask secrets
    if (line.includes('TOKEN=') || line.includes('KEY=')) {
      const [key] = line.split('=');
      console.log(`  ${key}=****`);
    } else {
      console.log(`  ${line}`);
    }
  }

  console.log(`\nSetup complete. Selected agent: ${selected.name}`);
  console.log('Run: ./shannon start -r /path/to/your/repo [-u https://your-app.com]');
}
