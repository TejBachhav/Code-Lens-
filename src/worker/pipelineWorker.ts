/**
 * CodeLens — Pipeline Worker (child process entry point)
 *
 * This module is forked as a child process by the extension host. It listens
 * for {@link PipelineCommand} messages on the IPC channel and orchestrates the
 * full scanning pipeline:
 *
 *   1. **Discovery** — find files per language
 *   2. **Detection** — auto-detect relevant framework plugins
 *   3. **Tier 1**    — AST scanning (deterministic)
 *   4. **Tier 2**    — data-flow analysis
 *   5. **Tier 3**    — LLM enrichment (optional)
 *   6. **Output**    — write pipeline.json and generated artefacts
 *
 * Progress, log, and result events are sent back to the parent via
 * {@link PipelineEvent} IPC messages.
 *
 * @module worker/pipelineWorker
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  PipelineCommand,
  PipelineEvent,
  PipelineOptions,
  PipelineResult,
  PipelinePhase,
  PipelineStats,
  EndpointRecord,
  FrameworkDetection,
  OutputFileRecord,
  SupportedLanguage,
  LogLevel,
} from '../shared/types';
import { Logger } from '../shared/logger';
import { countUnresolved } from '../shared/utils';
import { discoverFiles } from './fileDiscovery';
import { createDefaultRegistry, PluginRegistry } from './pluginRegistry';

// ─── IPC Helpers ──────────────────────────────────────────────────────────────

/**
 * Send a {@link PipelineEvent} back to the parent process.
 * Silently drops the message if there is no IPC channel (e.g. running standalone).
 */
function sendEvent(event: PipelineEvent): void {
  if (typeof process.send === 'function') {
    process.send(event);
  }
}

/**
 * Convenience: send a progress event.
 */
function sendProgress(phase: PipelinePhase, message: string, percent: number): void {
  sendEvent({ type: 'progress', phase, message, percent: Math.round(percent) });
}

/**
 * Convenience: send an error event.
 */
function sendError(message: string, details?: string): void {
  sendEvent({ type: 'error', message, details });
}

// ─── Logger Setup ─────────────────────────────────────────────────────────────

/**
 * Install a Logger sink that forwards all log entries as {@link PipelineEvent}
 * messages over the IPC channel, so the extension host can display them in the
 * OutputChannel.
 */
function setupLogger(): void {
  Logger.clearSinks();
  Logger.addSink((entry) => {
    sendEvent({
      type: 'log',
      level: entry.level as LogLevel,
      message: `[${entry.component}] ${entry.message}`,
    });
  });
}

const logger = Logger.create('PipelineWorker');

// ─── Cancellation ─────────────────────────────────────────────────────────────

/** Module-level cancellation flag. Set when a `cancel` command is received. */
let cancelled = false;

/**
 * Check whether the pipeline has been cancelled and, if so, throw an error
 * that the top-level handler can catch.
 */
function checkCancellation(): void {
  if (cancelled) {
    throw new Error('Pipeline cancelled by user');
  }
}

// ─── Pipeline Execution ──────────────────────────────────────────────────────

/**
 * Execute the full pipeline for the given workspace and options.
 *
 * @param workspaceRoot - Absolute path to the workspace
 * @param options       - Pipeline configuration options
 */
async function runPipeline(workspaceRoot: string, options: PipelineOptions): Promise<void> {
  const pipelineStart = Date.now();
  const errors: string[] = [];

  try {
    // ── Phase 1: Discovery ─────────────────────────────────────────────
    sendProgress('discovery', 'Discovering source files…', 5);
    checkCancellation();

    const fileMap = await discoverFiles(
      workspaceRoot,
      options.languages,
      options.excludePatterns,
    );

    const totalFiles = Array.from(fileMap.values()).reduce((s, a) => s + a.length, 0);
    logger.info(`Discovered ${totalFiles} file(s)`);
    sendProgress('discovery', `Found ${totalFiles} source file(s)`, 10);

    // ── Phase 2: Detection ─────────────────────────────────────────────
    sendProgress('detection', 'Detecting frameworks…', 15);
    checkCancellation();

    const registry: PluginRegistry = createDefaultRegistry();
    const activePlugins = await registry.detectPlugins(workspaceRoot, fileMap);

    if (activePlugins.length === 0) {
      logger.warn('No framework plugins detected — pipeline will produce no endpoints');
    }

    sendProgress('detection', `Detected ${activePlugins.length} framework(s)`, 20);

    // ── Phase 3: Tier 1 — AST Scanning ─────────────────────────────────
    sendProgress('tier1', 'Running AST scanners (Tier 1)…', 25);
    checkCancellation();

    const tier1Start = Date.now();
    let allEndpoints: EndpointRecord[] = [];
    const frameworkDetections: FrameworkDetection[] = [];

    for (let i = 0; i < activePlugins.length; i++) {
      const plugin = activePlugins[i];
      checkCancellation();

      const languageFiles = fileMap.get(plugin.language as SupportedLanguage) ?? [];
      const pluginFiles = filterFilesByPatterns(languageFiles, plugin.filePatterns);

      logger.info(`Tier 1: ${plugin.id} — scanning ${pluginFiles.length} file(s)`);
      const pct = 25 + ((i + 1) / activePlugins.length) * 15; // 25→40 %
      sendProgress('tier1', `Scanning with ${plugin.id}…`, pct);

      try {
        const endpoints = await plugin.scan(pluginFiles, workspaceRoot);
        allEndpoints = allEndpoints.concat(endpoints);

        frameworkDetections.push({
          pluginId: plugin.id,
          language: plugin.language,
          framework: plugin.framework,
          fileCount: pluginFiles.length,
          endpointCount: endpoints.length,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Tier 1 scan failed for ${plugin.id}: ${msg}`);
        errors.push(`Tier 1 [${plugin.id}]: ${msg}`);
      }
    }

    const tier1Duration = Date.now() - tier1Start;
    sendProgress('tier1', `Tier 1 complete — ${allEndpoints.length} endpoint(s)`, 40);

    // Send intermediate endpoints to parent
    sendEvent({ type: 'endpoints', data: allEndpoints });

    // ── Phase 4: Tier 2 — Data-flow Analysis ───────────────────────────
    sendProgress('tier2', 'Running data-flow analysis (Tier 2)…', 45);
    checkCancellation();

    const tier2Start = Date.now();

    for (let i = 0; i < activePlugins.length; i++) {
      const plugin = activePlugins[i];
      checkCancellation();

      const pluginEndpoints = allEndpoints.filter(
        (ep) => ep.framework === plugin.framework && ep.language === plugin.language,
      );

      if (pluginEndpoints.length === 0) {
        continue;
      }

      const pct = 45 + ((i + 1) / activePlugins.length) * 15; // 45→60 %
      sendProgress('tier2', `Analysing with ${plugin.id}…`, pct);

      try {
        const enriched = await plugin.analyze(pluginEndpoints, workspaceRoot);

        // Replace the original endpoints with enriched ones
        const enrichedIds = new Set(enriched.map((e) => e.id));
        allEndpoints = allEndpoints
          .filter((ep) => !enrichedIds.has(ep.id))
          .concat(enriched);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Tier 2 analysis failed for ${plugin.id}: ${msg}`);
        errors.push(`Tier 2 [${plugin.id}]: ${msg}`);
      }
    }

    const tier2Duration = Date.now() - tier2Start;
    sendProgress('tier2', 'Tier 2 complete', 60);

    // ── Phase 5: Tier 3 — LLM Enrichment (optional) ───────────────────
    let tier3Duration = 0;
    if (options.enableTier3) {
      sendProgress('tier3', 'Running LLM enrichment (Tier 3)…', 65);
      checkCancellation();

      const tier3Start = Date.now();

      try {
        // Attempt to import the enricher module.  It may not exist yet.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const enricherMod = require('../tier3/enricher');
        if (typeof enricherMod.enrichEndpoints === 'function') {
          allEndpoints = await enricherMod.enrichEndpoints(allEndpoints, options.ollama);
        } else {
          logger.info('Tier 3 enricher not implemented — skipping');
        }
      } catch {
        logger.info('Tier 3 enricher module not available — skipping');
      }

      tier3Duration = Date.now() - tier3Start;
      sendProgress('tier3', 'Tier 3 complete', 80);
    } else {
      logger.info('Tier 3 enrichment disabled by configuration');
      sendProgress('tier3', 'Tier 3 skipped (disabled)', 80);
    }

    // ── Phase 6: Output Generation ─────────────────────────────────────
    sendProgress('output', 'Generating output files…', 85);
    checkCancellation();

    const outputStart = Date.now();
    const outputFiles: OutputFileRecord[] = [];

    try {
      const outputDir = path.resolve(workspaceRoot, options.outputDir);

      // Ensure the output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Always write the raw pipeline JSON
      const pipelineJsonPath = path.join(outputDir, 'pipeline.json');
      fs.writeFileSync(pipelineJsonPath, JSON.stringify(allEndpoints, null, 2), 'utf-8');
      outputFiles.push({ type: 'pipeline_json', path: pipelineJsonPath });
      logger.info(`Wrote pipeline.json (${allEndpoints.length} endpoints)`);

      // Attempt to call optional output generators
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const outputMod = require('../output');
        if (typeof outputMod.generateOutputs === 'function') {
          const extraFiles: OutputFileRecord[] = await outputMod.generateOutputs(
            allEndpoints,
            outputDir,
            options,
          );
          outputFiles.push(...extraFiles);
        }
      } catch {
        logger.debug('Optional output generators not available');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Output generation failed: ${msg}`);
      errors.push(`Output: ${msg}`);
    }

    const outputDuration = Date.now() - outputStart;
    sendProgress('output', 'Output generation complete', 95);

    // ── Compile Stats & Result ─────────────────────────────────────────
    const unresolvedCount = allEndpoints.reduce(
      (sum, ep) => sum + countUnresolved(ep),
      0,
    );

    const stats: PipelineStats = {
      totalFiles,
      totalEndpoints: allEndpoints.length,
      tier1DurationMs: tier1Duration,
      tier2DurationMs: tier2Duration,
      tier3DurationMs: tier3Duration,
      outputDurationMs: outputDuration,
      totalDurationMs: Date.now() - pipelineStart,
      unresolvedCount,
      errors,
    };

    const result: PipelineResult = {
      endpoints: allEndpoints,
      detectedFrameworks: frameworkDetections,
      outputFiles,
      stats,
    };

    sendProgress('complete', 'Pipeline complete', 100);
    sendEvent({ type: 'complete', data: result });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    if (msg === 'Pipeline cancelled by user') {
      logger.info('Pipeline cancelled');
      sendError('Pipeline was cancelled by the user');
    } else {
      logger.error(`Pipeline failed: ${msg}`);
      sendError(msg, stack);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Filter a list of absolute file paths to those matching at least one of the
 * supplied glob-like patterns. Uses a simple suffix / extension check rather
 * than full glob evaluation because the patterns are typically extension globs
 * like `**\/*.py`.
 *
 * @param files    - Absolute file paths to filter
 * @param patterns - Glob patterns (e.g. `['**\/*.py']`)
 * @returns Filtered file paths
 */
function filterFilesByPatterns(files: string[], patterns: string[]): string[] {
  // Extract raw extensions from the patterns, e.g. "**/*.py" → ".py"
  const extensions = new Set<string>();
  for (const pattern of patterns) {
    const match = pattern.match(/\*\.(\w+)$/);
    if (match) {
      extensions.add(`.${match[1]}`);
    }
  }

  if (extensions.size === 0) {
    // Cannot parse extensions — return everything
    return files;
  }

  return files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return extensions.has(ext);
  });
}

// ─── IPC Message Handler ──────────────────────────────────────────────────────

/**
 * Bootstrap: listen for commands from the parent process and start the pipeline.
 */
function main(): void {
  setupLogger();
  logger.info('Pipeline worker started');

  process.on('message', (msg: PipelineCommand) => {
    switch (msg.type) {
      case 'start':
        cancelled = false;
        logger.info('Received start command', {
          workspaceRoot: msg.workspaceRoot,
          languages: msg.options.languages,
        });
        runPipeline(msg.workspaceRoot, msg.options).catch((error) => {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error(`Unhandled pipeline error: ${errMsg}`);
          sendError(errMsg);
        });
        break;

      case 'cancel':
        logger.info('Received cancel command');
        cancelled = true;
        break;

      case 'status':
        logger.debug('Received status request');
        // A full status implementation could report current phase, etc.
        break;

      default:
        logger.warn('Unknown command received', { msg });
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Worker received SIGTERM — shutting down');
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    sendError(`Uncaught exception: ${error.message}`, error.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled rejection: ${msg}`);
    sendError(`Unhandled rejection: ${msg}`);
  });
}

// Run only when this file is the entry point
main();
