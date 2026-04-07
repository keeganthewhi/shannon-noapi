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

  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      const token = creds?.claudeAiOauth?.accessToken;
      if (token) {
        envLines.unshift(`CLAUDE_CODE_OAUTH_TOKEN=${token}`);
        hasAuth = true;
      }
    } catch {
      // Can't read credentials
    }
  }

  // Check for API key in environment
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

  // 3. Pick the best agent (prefer authenticated, then claude > codex > gemini)
  const authenticated = agents.filter((a) => a.hasAuth);
  const selected = authenticated.length > 0 ? authenticated[0]! : agents[0]!;

  if (!selected.hasAuth) {
    console.warn(`WARNING: ${selected.name} is installed but not authenticated.`);
    console.warn(`Run '${selected.name}' once to log in, then run './shannon setup' again.\n`);
  }

  // 4. Write .env
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
