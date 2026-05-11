import fs from 'fs';
import path from 'path';
import { ROOT } from './wiki-ops.js';

const CONFIG_PATH = path.join(ROOT, '.wiki-config.json');

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { }
  return {};
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function getLastImportDir() {
  const config = loadConfig();
  const dir = config.lastImportDir;
  if (dir && fs.existsSync(dir)) return dir;
  return process.env.HOME || '/';
}

export function setLastImportDir(dir) {
  const config = loadConfig();
  config.lastImportDir = dir;
  saveConfig(config);
}

export function saveIngestProgress(fileName, completedSegments, totalSegments, opts = {}) {
  const config = loadConfig();
  if (!config.ingestProgress) config.ingestProgress = {};
  config.ingestProgress[fileName] = {
    completedSegments,
    totalSegments,
    failedSegments: opts.failedSegments || (config.ingestProgress[fileName] || {}).failedSegments || [],
    paused: opts.paused || false,
    pausedAt: opts.paused ? (opts.pausedAt || completedSegments) : null,
    updatedAt: new Date().toISOString(),
  };
  saveConfig(config);
}

export function getIngestProgress(fileName) {
  const config = loadConfig();
  if (!config.ingestProgress) return null;
  if (config.ingestProgress.fileName) {
    const old = config.ingestProgress;
    config.ingestProgress = { [old.fileName]: { completedSegments: old.completedSegments, totalSegments: old.totalSegments, failedSegments: old.failedSegments || [], paused: old.paused || false, pausedAt: old.pausedAt || null, updatedAt: old.updatedAt } };
    saveConfig(config);
  }
  if (fileName) return config.ingestProgress[fileName] || null;
  return config.ingestProgress;
}

export function clearIngestProgress(fileName) {
  const config = loadConfig();
  if (!config.ingestProgress) return;
  if (fileName) {
    delete config.ingestProgress[fileName];
    if (Object.keys(config.ingestProgress).length === 0) delete config.ingestProgress;
  } else {
    delete config.ingestProgress;
  }
  saveConfig(config);
}
