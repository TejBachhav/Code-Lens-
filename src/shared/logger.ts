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
export class Logger {
  private static sinks: LogSink[] = [];
  private static minLevel: LogLevel = 'info';

  private readonly component: string;

  private static readonly LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(component: string) {
    this.component = component;
  }

  /**
   * Create a logger for a specific component/module.
   */
  static create(component: string): Logger {
    return new Logger(component);
  }

  /**
   * Add a log sink (output channel, IPC sender, console, etc.)
   */
  static addSink(sink: LogSink): void {
    Logger.sinks.push(sink);
  }

  /**
   * Remove all sinks.
   */
  static clearSinks(): void {
    Logger.sinks = [];
  }

  /**
   * Set minimum log level.
   */
  static setLevel(level: LogLevel): void {
    Logger.minLevel = level;
  }

  /**
   * Console sink — logs to stdout/stderr.
   */
  static consoleSink: LogSink = (entry: LogEntry) => {
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}]`;
    const msg = entry.data
      ? `${prefix} ${entry.message} ${JSON.stringify(entry.data)}`
      : `${prefix} ${entry.message}`;

    switch (entry.level) {
      case 'error':
        console.error(msg);
        break;
      case 'warn':
        console.warn(msg);
        break;
      case 'debug':
        console.debug(msg);
        break;
      default:
        console.log(msg);
    }
  };

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (Logger.LEVEL_ORDER[level] < Logger.LEVEL_ORDER[Logger.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };

    // If no sinks configured, fall back to console
    if (Logger.sinks.length === 0) {
      Logger.consoleSink(entry);
      return;
    }

    for (const sink of Logger.sinks) {
      try {
        sink(entry);
      } catch {
        // Never let a sink error crash the pipeline
        console.error(`Logger sink error: ${message}`);
      }
    }
  }
}
