/**
 * Unit tests for src/shared/logger.ts
 *
 * Tests the Logger class: creation, sinks, log levels, and message dispatch.
 * Uses custom sinks to capture log entries without console output.
 */

import * as assert from 'assert';
import { Logger, LogEntry } from '../../shared/logger';

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Capture sink that stores all received log entries */
function createCaptureSink(): { entries: LogEntry[]; sink: (entry: LogEntry) => void } {
  const entries: LogEntry[] = [];
  return {
    entries,
    sink: (entry: LogEntry) => entries.push(entry),
  };
}

// ─── Logger.create ───────────────────────────────────────────────────────────

describe('Logger.create', () => {
  it('should return a Logger instance', () => {
    const logger = Logger.create('TestComponent');
    assert.ok(logger instanceof Logger);
  });

  it('should create loggers with different component names', () => {
    const logger1 = Logger.create('Component1');
    const logger2 = Logger.create('Component2');
    assert.ok(logger1 instanceof Logger);
    assert.ok(logger2 instanceof Logger);
    assert.notStrictEqual(logger1, logger2);
  });
});

// ─── Logger sinks ────────────────────────────────────────────────────────────

describe('Logger sinks', () => {
  afterEach(() => {
    Logger.clearSinks();
    Logger.setLevel('info');
  });

  it('should receive log entries when a sink is added', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);

    const logger = Logger.create('TestSink');
    logger.info('test message');

    assert.strictEqual(capture.entries.length, 1);
    assert.strictEqual(capture.entries[0].message, 'test message');
    assert.strictEqual(capture.entries[0].component, 'TestSink');
    assert.strictEqual(capture.entries[0].level, 'info');
  });

  it('should include timestamp in log entries', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);

    const logger = Logger.create('TimeTest');
    logger.info('time check');

    assert.ok(capture.entries[0].timestamp, 'Should have a timestamp');
    // Timestamp should be an ISO string
    assert.ok(!isNaN(Date.parse(capture.entries[0].timestamp)), 'Timestamp should be valid ISO date');
  });

  it('should include data when provided', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);

    const logger = Logger.create('DataTest');
    const testData = { key: 'value', count: 42 };
    logger.info('with data', testData);

    assert.strictEqual(capture.entries[0].data, testData);
  });

  it('should not include data field when not provided', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);

    const logger = Logger.create('NoDataTest');
    logger.info('no data');

    assert.strictEqual(capture.entries[0].data, undefined);
  });

  it('should dispatch to multiple sinks', () => {
    const capture1 = createCaptureSink();
    const capture2 = createCaptureSink();
    Logger.addSink(capture1.sink);
    Logger.addSink(capture2.sink);

    const logger = Logger.create('MultiSink');
    logger.info('broadcast');

    assert.strictEqual(capture1.entries.length, 1);
    assert.strictEqual(capture2.entries.length, 1);
  });

  it('should clear all sinks', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);
    Logger.clearSinks();

    const logger = Logger.create('ClearedSink');
    // After clearing sinks, it falls back to console — no entries in our capture
    logger.info('should not be captured');

    assert.strictEqual(capture.entries.length, 0);
  });

  it('should not crash when a sink throws an error', () => {
    const badSink = () => { throw new Error('Sink error!'); };
    const capture = createCaptureSink();
    Logger.addSink(badSink);
    Logger.addSink(capture.sink);

    const logger = Logger.create('ErrorSink');
    // Should not throw — errors in sinks are caught
    assert.doesNotThrow(() => {
      logger.info('should survive bad sink');
    });
  });
});

// ─── Log levels ──────────────────────────────────────────────────────────────

describe('Logger log levels', () => {
  afterEach(() => {
    Logger.clearSinks();
    Logger.setLevel('info');
  });

  it('should log all levels: debug, info, warn, error', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);
    Logger.setLevel('debug');

    const logger = Logger.create('LevelTest');
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    assert.strictEqual(capture.entries.length, 4);
    assert.strictEqual(capture.entries[0].level, 'debug');
    assert.strictEqual(capture.entries[1].level, 'info');
    assert.strictEqual(capture.entries[2].level, 'warn');
    assert.strictEqual(capture.entries[3].level, 'error');
  });

  it('should filter debug messages when level is "info"', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);
    Logger.setLevel('info');

    const logger = Logger.create('FilterTest');
    logger.debug('should be filtered');
    logger.info('should pass');

    assert.strictEqual(capture.entries.length, 1);
    assert.strictEqual(capture.entries[0].level, 'info');
  });

  it('should filter debug and info when level is "warn"', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);
    Logger.setLevel('warn');

    const logger = Logger.create('WarnLevel');
    logger.debug('filtered');
    logger.info('filtered');
    logger.warn('passes');
    logger.error('passes');

    assert.strictEqual(capture.entries.length, 2);
    assert.strictEqual(capture.entries[0].level, 'warn');
    assert.strictEqual(capture.entries[1].level, 'error');
  });

  it('should only log errors when level is "error"', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);
    Logger.setLevel('error');

    const logger = Logger.create('ErrorLevel');
    logger.debug('filtered');
    logger.info('filtered');
    logger.warn('filtered');
    logger.error('passes');

    assert.strictEqual(capture.entries.length, 1);
    assert.strictEqual(capture.entries[0].level, 'error');
  });

  it('should log everything when level is "debug"', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);
    Logger.setLevel('debug');

    const logger = Logger.create('DebugLevel');
    logger.debug('passes');
    logger.info('passes');
    logger.warn('passes');
    logger.error('passes');

    assert.strictEqual(capture.entries.length, 4);
  });
});

// ─── Component context ───────────────────────────────────────────────────────

describe('Logger component context', () => {
  afterEach(() => {
    Logger.clearSinks();
    Logger.setLevel('info');
  });

  it('should include the component name in log entries', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);

    const logger = Logger.create('MyComponent');
    logger.info('test');

    assert.strictEqual(capture.entries[0].component, 'MyComponent');
  });

  it('should keep separate component names for different loggers', () => {
    const capture = createCaptureSink();
    Logger.addSink(capture.sink);

    const logger1 = Logger.create('Scanner');
    const logger2 = Logger.create('Parser');

    logger1.info('from scanner');
    logger2.info('from parser');

    assert.strictEqual(capture.entries[0].component, 'Scanner');
    assert.strictEqual(capture.entries[1].component, 'Parser');
  });
});

// ─── consoleSink ─────────────────────────────────────────────────────────────

describe('Logger.consoleSink', () => {
  it('should be a function', () => {
    assert.strictEqual(typeof Logger.consoleSink, 'function');
  });

  it('should not throw when called with a valid entry', () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'Test',
      message: 'console sink test',
    };
    assert.doesNotThrow(() => Logger.consoleSink(entry));
  });

  it('should handle entries with data', () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'debug',
      component: 'Test',
      message: 'with data',
      data: { foo: 'bar' },
    };
    assert.doesNotThrow(() => Logger.consoleSink(entry));
  });

  it('should handle all log levels without throwing', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    for (const level of levels) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        component: 'Test',
        message: `${level} test`,
      };
      assert.doesNotThrow(() => Logger.consoleSink(entry));
    }
  });
});
