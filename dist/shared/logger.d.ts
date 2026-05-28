/**
 * CodeLens — Structured Logger
 *
 * Provides structured logging that works in both the extension host (OutputChannel)
 * and child processes (IPC messages). Logs include timestamps, levels, and context.
 */
import { LogLevel } from './types';
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    component: string;
    message: string;
    data?: unknown;
}
type LogSink = (entry: LogEntry) => void;
/**
 * Structured logger with component context and pluggable sinks.
 */
export declare class Logger {
    private static sinks;
    private static minLevel;
    private readonly component;
    private static readonly LEVEL_ORDER;
    constructor(component: string);
    /**
     * Create a logger for a specific component/module.
     */
    static create(component: string): Logger;
    /**
     * Add a log sink (output channel, IPC sender, console, etc.)
     */
    static addSink(sink: LogSink): void;
    /**
     * Remove all sinks.
     */
    static clearSinks(): void;
    /**
     * Set minimum log level.
     */
    static setLevel(level: LogLevel): void;
    /**
     * Console sink — logs to stdout/stderr.
     */
    static consoleSink: LogSink;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    private log;
}
export {};
//# sourceMappingURL=logger.d.ts.map