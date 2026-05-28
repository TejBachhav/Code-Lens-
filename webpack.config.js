//@ts-check
'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

// ─── Shared copy patterns for WASM grammars & templates ─────────────────────

const assetCopyPatterns = [
  // tree-sitter runtime WASM (required by web-tree-sitter)
  {
    from: path.resolve(__dirname, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
    to: path.resolve(__dirname, 'dist/tree-sitter.wasm'),
  },
  // Language grammar WASMs
  {
    from: path.resolve(__dirname, 'grammars'),
    to: path.resolve(__dirname, 'dist/grammars'),
  },
  // Handlebars templates for output generation
  {
    from: path.resolve(__dirname, 'src/output/templates'),
    to: path.resolve(__dirname, 'dist/templates'),
  },
];

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },

  externals: {
    vscode: 'commonjs vscode',
    // ts-morph has native dependencies that shouldn't be bundled
    'ts-morph': 'commonjs ts-morph',
    '@ts-morph/common': 'commonjs @ts-morph/common',
  },

  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
      '@worker': path.resolve(__dirname, 'src/worker'),
      '@tier3': path.resolve(__dirname, 'src/tier3'),
      '@output': path.resolve(__dirname, 'src/output'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@commands': path.resolve(__dirname, 'src/commands'),
    },
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },

  plugins: [
    new CopyPlugin({ patterns: assetCopyPatterns }),
  ],

  devtool: 'nosources-source-map',

  infrastructureLogging: {
    level: 'log',
  },
};

// Worker process config — bundled separately since it runs in a child process
const workerConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/worker/pipelineWorker.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'pipelineWorker.js',
    libraryTarget: 'commonjs2',
  },

  externals: {
    'ts-morph': 'commonjs ts-morph',
    '@ts-morph/common': 'commonjs @ts-morph/common',
  },

  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
      '@worker': path.resolve(__dirname, 'src/worker'),
      '@tier3': path.resolve(__dirname, 'src/tier3'),
      '@output': path.resolve(__dirname, 'src/output'),
    },
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },

  devtool: 'nosources-source-map',
};

module.exports = [extensionConfig, workerConfig];
