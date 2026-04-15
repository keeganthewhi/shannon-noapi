// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { fs, path } from 'zx';
import type { ActivityLogger } from '../types/activity-logger.js';
import { PentestError } from './error-handling.js';

// Pure function: Assemble final report from specialist deliverables.
// Dynamically scans for *_exploitation_evidence.md files so it adapts to any scan profile.
export async function assembleFinalReport(sourceDir: string, logger: ActivityLogger): Promise<string> {
  const deliverablesDir = path.join(sourceDir, '.shannon', 'deliverables');

  let evidenceFiles: string[] = [];
  try {
    if (await fs.pathExists(deliverablesDir)) {
      const allFiles: string[] = await fs.readdir(deliverablesDir);
      evidenceFiles = allFiles.filter((f: string) => f.endsWith('_exploitation_evidence.md')).sort();
    }
  } catch (error) {
    const err = error as Error;
    logger.warn(`Could not list deliverables directory: ${err.message}`);
  }

  const sections: string[] = [];

  for (const fileName of evidenceFiles) {
    const filePath = path.join(deliverablesDir, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      sections.push(content);
      logger.info(`Added ${fileName}`);
    } catch (error) {
      const err = error as Error;
      logger.warn(`Could not read ${fileName}: ${err.message}`);
    }
  }

  if (evidenceFiles.length === 0) {
    logger.warn('No exploitation evidence files found');
  }

  const finalContent = sections.join('\n\n');
  const finalReportPath = path.join(deliverablesDir, 'comprehensive_security_assessment_report.md');

  try {
    // Ensure deliverables directory exists
    await fs.ensureDir(deliverablesDir);
    await fs.writeFile(finalReportPath, finalContent);
    logger.info(`Final report assembled at ${finalReportPath}`);
  } catch (error) {
    const err = error as Error;
    throw new PentestError(`Failed to write final report: ${err.message}`, 'filesystem', false, {
      finalReportPath,
      originalError: err.message,
    });
  }

  return finalContent;
}

/**
 * Inject model information into the final security report.
 * Reads session.json to get the model(s) used, then injects a "Model:" line
 * into the Executive Summary section of the report.
 */
export async function injectModelIntoReport(
  repoPath: string,
  outputPath: string,
  logger: ActivityLogger,
): Promise<void> {
  // 1. Read session.json to get model information
  const sessionJsonPath = path.join(outputPath, 'session.json');

  if (!(await fs.pathExists(sessionJsonPath))) {
    logger.warn('session.json not found, skipping model injection');
    return;
  }

  interface SessionData {
    metrics: {
      agents: Record<string, { model?: string }>;
    };
  }

  const sessionData: SessionData = await fs.readJson(sessionJsonPath);

  // 2. Extract unique models from all agents
  const models = new Set<string>();
  for (const agent of Object.values(sessionData.metrics.agents)) {
    if (agent.model) {
      models.add(agent.model);
    }
  }

  if (models.size === 0) {
    logger.warn('No model information found in session.json');
    return;
  }

  const modelStr = Array.from(models).join(', ');
  logger.info(`Injecting model info into report: ${modelStr}`);

  // 3. Read the final report
  const reportPath = path.join(repoPath, '.shannon', 'deliverables', 'comprehensive_security_assessment_report.md');

  if (!(await fs.pathExists(reportPath))) {
    logger.warn('Final report not found, skipping model injection');
    return;
  }

  let reportContent = await fs.readFile(reportPath, 'utf8');

  // 4. Find and inject model line after "Assessment Date" in Executive Summary
  // Pattern: "- Assessment Date: <date>" followed by a newline
  const assessmentDatePattern = /^(- Assessment Date: .+)$/m;
  const match = reportContent.match(assessmentDatePattern);

  if (match) {
    // Inject model line after Assessment Date
    const modelLine = `- Model: ${modelStr}`;
    reportContent = reportContent.replace(assessmentDatePattern, `$1\n${modelLine}`);
    logger.info('Model info injected into Executive Summary');
  } else {
    // If no Assessment Date line found, try to add after Executive Summary header
    const execSummaryPattern = /^## Executive Summary$/m;
    if (reportContent.match(execSummaryPattern)) {
      // Add model as first item in Executive Summary
      reportContent = reportContent.replace(execSummaryPattern, `## Executive Summary\n- Model: ${modelStr}`);
      logger.info('Model info added to Executive Summary header');
    } else {
      logger.warn('Could not find Executive Summary section');
      return;
    }
  }

  // 5. Write modified report back
  await fs.writeFile(reportPath, reportContent);
}

/**
 * Format milliseconds as human-readable duration (e.g., "12m 34s", "1h 23m").
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a number with commas (e.g., 45000 -> "45,000").
 */
function formatNumber(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString('en-US');
}

/**
 * Inject a scan metrics appendix at the end of the final report.
 * Reads session.json for per-agent metrics and appends a markdown table.
 */
export async function injectScanMetrics(
  repoPath: string,
  outputPath: string,
  logger: ActivityLogger,
): Promise<void> {
  const sessionJsonPath = path.join(outputPath, 'session.json');

  if (!(await fs.pathExists(sessionJsonPath))) {
    logger.warn('session.json not found, skipping metrics injection');
    return;
  }

  interface AgentSessionData {
    status: string;
    model?: string;
    final_duration_ms?: number;
    total_cost_usd?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_cache_creation_input_tokens?: number;
    total_cache_read_input_tokens?: number;
  }

  interface MetricsSessionData {
    session: {
      id: string;
      scanProfile?: string;
      fileCount?: number;
    };
    metrics: {
      total_cost_usd: number;
      agents: Record<string, AgentSessionData>;
    };
  }

  let sessionData: MetricsSessionData;
  try {
    sessionData = await fs.readJson(sessionJsonPath);
  } catch {
    logger.warn('Could not parse session.json for metrics injection');
    return;
  }

  const agents = sessionData.metrics.agents;
  if (!agents || Object.keys(agents).length === 0) {
    logger.warn('No agent metrics in session.json');
    return;
  }

  // Build table rows
  const rows: string[] = [];
  let totalDurationMs = 0;
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;

  for (const [name, data] of Object.entries(agents)) {
    if (data.status !== 'success') continue;

    const dur = data.final_duration_ms ?? 0;
    const cost = data.total_cost_usd ?? 0;
    const inp = data.total_input_tokens ?? 0;
    const out = data.total_output_tokens ?? 0;
    const cw = data.total_cache_creation_input_tokens ?? 0;
    const cr = data.total_cache_read_input_tokens ?? 0;

    totalDurationMs += dur;
    totalCost += cost;
    totalInput += inp;
    totalOutput += out;
    totalCacheWrite += cw;
    totalCacheRead += cr;

    rows.push(
      `| ${name} | ${formatDuration(dur)} | $${cost.toFixed(2)} | ${formatNumber(inp)} | ${formatNumber(out)} | ${formatNumber(cw)} | ${formatNumber(cr)} |`,
    );
  }

  if (rows.length === 0) {
    logger.warn('No successful agents to report metrics for');
    return;
  }

  // Total row
  rows.push(
    `| **Total** | **${formatDuration(totalDurationMs)}** | **$${totalCost.toFixed(2)}** | **${formatNumber(totalInput)}** | **${formatNumber(totalOutput)}** | **${formatNumber(totalCacheWrite)}** | **${formatNumber(totalCacheRead)}** |`,
  );

  // Build metadata lines
  const metaLines: string[] = [];
  const models = new Set<string>();
  for (const data of Object.values(agents)) {
    if (data.model) models.add(data.model);
  }
  if (sessionData.session.scanProfile) {
    const profileNote = sessionData.session.fileCount
      ? `${sessionData.session.scanProfile} (${sessionData.session.fileCount} source files)`
      : sessionData.session.scanProfile;
    metaLines.push(`- Scan Profile: ${profileNote}`);
  }
  if (models.size > 0) {
    metaLines.push(`- Model: ${Array.from(models).join(', ')}`);
  }

  // Assemble the metrics section
  const metricsSection = [
    '',
    '---',
    '',
    '## Appendix: Scan Metrics',
    '',
    '| Agent | Duration | Cost (USD) | Input Tokens | Output Tokens | Cache Write | Cache Read |',
    '|-------|----------|------------|--------------|---------------|-------------|------------|',
    ...rows,
    '',
    ...metaLines,
    '',
  ].join('\n');

  // Append to the report
  const reportPath = path.join(repoPath, '.shannon', 'deliverables', 'comprehensive_security_assessment_report.md');

  if (!(await fs.pathExists(reportPath))) {
    logger.warn('Final report not found, skipping metrics injection');
    return;
  }

  let reportContent = await fs.readFile(reportPath, 'utf8');
  reportContent = reportContent.trimEnd() + '\n' + metricsSection;
  await fs.writeFile(reportPath, reportContent);
  logger.info('Scan metrics appendix injected into report');
}
