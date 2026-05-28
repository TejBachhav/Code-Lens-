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
/**
 * Centralised registry for language/framework scanner plugins.
 *
 * Plugins are stored by their `id` property and can be queried by language
 * or auto-detected for a given workspace root.
 */
export declare class PluginRegistry {
    /** Internal map of plugin id → plugin instance */
    private readonly plugins;
    /**
     * Register a plugin. If a plugin with the same `id` is already registered
     * it is silently replaced (last-write-wins).
     *
     * @param plugin - The plugin to register
     */
    register(plugin: LanguagePlugin): void;
    /**
     * Retrieve a plugin by its unique identifier.
     *
     * @param id - Plugin identifier, e.g. `"python-fastapi"`
     * @returns The plugin instance, or `undefined` if not found
     */
    getPlugin(id: string): LanguagePlugin | undefined;
    /**
     * Return every registered plugin.
     */
    getAllPlugins(): LanguagePlugin[];
    /**
     * Return all plugins that handle a given source language.
     *
     * @param language - The language to filter by
     */
    getPluginsForLanguage(language: SupportedLanguage): LanguagePlugin[];
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
    detectPlugins(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<LanguagePlugin[]>;
    /**
     * Return the number of registered plugins.
     */
    get size(): number;
}
/**
 * Create a {@link PluginRegistry} pre-loaded with all built-in plugins.
 *
 * @returns A ready-to-use PluginRegistry with built-in plugins registered
 */
export declare function createDefaultRegistry(): PluginRegistry;
//# sourceMappingURL=pluginRegistry.d.ts.map