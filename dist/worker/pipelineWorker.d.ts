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
export {};
//# sourceMappingURL=pipelineWorker.d.ts.map