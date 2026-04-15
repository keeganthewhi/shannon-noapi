// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Agent type definitions
 */

/**
 * List of all agents in execution order.
 * Used for iteration during resume state checking.
 */
export const ALL_AGENTS = [
  'pre-recon',
  'recon',
  'injection-vuln',
  'xss-vuln',
  'auth-vuln',
  'ssrf-vuln',
  'authz-vuln',
  'injection-exploit',
  'xss-exploit',
  'auth-exploit',
  'ssrf-exploit',
  'authz-exploit',
  'report',
] as const;

/**
 * Agent name type derived from ALL_AGENTS.
 * This ensures type safety and prevents drift between type and array.
 */
export type AgentName = (typeof ALL_AGENTS)[number];

export type PlaywrightSession = 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5';

import type { ActivityLogger } from './activity-logger.js';

export type AgentValidator = (sourceDir: string, logger: ActivityLogger) => Promise<boolean>;

export type AgentStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled-back';

export interface AgentDefinition {
  name: AgentName;
  displayName: string;
  prerequisites: AgentName[];
  promptTemplate: string;
  deliverableFilename: string;
  modelTier?: 'small' | 'medium' | 'large';
}

/**
 * Vulnerability types supported by the pipeline.
 */
export type VulnType = 'injection' | 'xss' | 'auth' | 'ssrf' | 'authz';

/** Runtime array of all vulnerability types (mirrors the VulnType union). */
export const VULN_TYPES: readonly VulnType[] = ['injection', 'xss', 'auth', 'ssrf', 'authz'];

/**
 * Scan profile controls which vuln/exploit pairs run based on project size.
 * 'auto' detects project size and picks the appropriate tier.
 */
export type ScanProfile = 'minimal' | 'standard' | 'comprehensive' | 'auto';

/** Valid concrete profiles (excludes 'auto'). */
export type ConcreteProfile = Exclude<ScanProfile, 'auto'>;

/** Mapping from scan profile to which vuln types are enabled. */
export const SCAN_PROFILE_TYPES: Readonly<Record<ConcreteProfile, readonly VulnType[]>> = {
  minimal: ['injection', 'auth'],
  standard: ['injection', 'xss', 'auth', 'authz'],
  comprehensive: VULN_TYPES,
};

/** Auto-detect profile from source file count. */
export function autoDetectProfile(fileCount: number): ConcreteProfile {
  if (fileCount < 50) return 'minimal';
  if (fileCount <= 300) return 'standard';
  return 'comprehensive';
}

/** Compute the effective agent list for a given set of enabled vuln types. */
export function getEffectiveAgents(enabledVulnTypes: readonly VulnType[]): AgentName[] {
  const vuln = enabledVulnTypes.map((t) => `${t}-vuln` as AgentName);
  const exploit = enabledVulnTypes.map((t) => `${t}-exploit` as AgentName);
  return ['pre-recon', 'recon', ...vuln, ...exploit, 'report'];
}

/**
 * Decision returned by queue validation for exploitation phase.
 */
export interface ExploitationDecision {
  shouldExploit: boolean;
  shouldRetry: boolean;
  vulnerabilityCount: number;
  vulnType: VulnType;
}
