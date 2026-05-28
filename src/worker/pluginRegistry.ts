/**
 * CodeLens — Plugin Registry
 *
 * Discovers and manages language/framework plugins. Each plugin implements the
 * {@link LanguagePlugin} interface and is indexed by its unique `id`.
 *
 * The registry is the single source of truth for which frameworks the pipeline
 * can scan. At startup the {@link createDefaultRegistry} factory imports every
 * built-in plugin, wrapping each import in a try/catch so that a missing or
 * broken plugin never crashes the extension.
 *
 * @module worker/pluginRegistry
 */

import { LanguagePlugin, SupportedLanguage } from '../shared/types';
import { Logger } from '../shared/logger';

// Statically import plugins for bundle-ability and static analysis
import pythonFastApiPlugin from '../plugins/python-fastapi';
import pythonFlaskPlugin from '../plugins/python-flask';
import typescriptExpressPlugin from '../plugins/typescript-express';
import typescriptNestJsPlugin from '../plugins/typescript-nestjs';
import javascriptExpressPlugin from '../plugins/javascript-express';
import xmlSpringPlugin from '../plugins/xml-spring';

const logger = Logger.create('PluginRegistry');

/**
 * Centralised registry for language/framework scanner plugins.
 *
 * Plugins are stored by their `id` property and can be queried by language
 * or auto-detected for a given workspace root.
 */
export class PluginRegistry {
  /** Internal map of plugin id → plugin instance */
  private readonly plugins: Map<string, LanguagePlugin> = new Map();

  /**
   * Register a plugin. If a plugin with the same `id` is already registered
   * it is silently replaced (last-write-wins).
   *
   * @param plugin - The plugin to register
   */
  register(plugin: LanguagePlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Overwriting existing plugin: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
    logger.debug(`Registered plugin: ${plugin.id} (${plugin.language}/${plugin.framework})`);
  }

  /**
   * Retrieve a plugin by its unique identifier.
   *
   * @param id - Plugin identifier, e.g. `"python-fastapi"`
   * @returns The plugin instance, or `undefined` if not found
   */
  getPlugin(id: string): LanguagePlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Return every registered plugin.
   */
  getAllPlugins(): LanguagePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Return all plugins that handle a given source language.
   *
   * @param language - The language to filter by
   */
  getPluginsForLanguage(language: SupportedLanguage): LanguagePlugin[] {
    return this.getAllPlugins().filter((p) => p.language === language);
  }

  /**
   * Auto-detect which registered plugins are relevant for the given
   * workspace by calling each plugin's `detect()` method.
   *
   * Detection runs in parallel. A plugin that throws during detection is
   * silently skipped.
   *
   * @param workspaceRoot - Absolute path to the workspace root
   * @returns Array of plugins whose `detect()` returned `true`
   */
  async detectPlugins(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<LanguagePlugin[]> {
    logger.info('Detecting relevant plugins', { workspaceRoot });

    const allPlugins = this.getAllPlugins();
    const results = await Promise.allSettled(
      allPlugins.map(async (plugin) => {
        try {
          const detected = await plugin.detect(workspaceRoot, fileMap);
          return { plugin, detected };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn(`Plugin detection failed for ${plugin.id}: ${msg}`);
          return { plugin, detected: false };
        }
      }),
    );

    const detected: LanguagePlugin[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.detected) {
        detected.push(result.value.plugin);
        logger.info(`Detected plugin: ${result.value.plugin.id}`);
      }
    }

    logger.info(`Detection complete — ${detected.length} plugin(s) active out of ${allPlugins.length} registered`);
    return detected;
  }

  /**
   * Return the number of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }
}

/**
 * Create a {@link PluginRegistry} pre-loaded with all built-in plugins.
 *
 * @returns A ready-to-use PluginRegistry with built-in plugins registered
 */
export function createDefaultRegistry(): PluginRegistry {
  const registry = new PluginRegistry();

  try {
    registry.register(pythonFastApiPlugin);
    registry.register(pythonFlaskPlugin);
    registry.register(typescriptExpressPlugin);
    registry.register(typescriptNestJsPlugin);
    registry.register(javascriptExpressPlugin);
    registry.register(xmlSpringPlugin);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load built-in plugins: ${msg}`);
  }

  logger.info(`Default registry created with ${registry.size} plugin(s)`);
  return registry;
}
