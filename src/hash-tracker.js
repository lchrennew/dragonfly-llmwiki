import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HASH_DB_PATH = path.join(ROOT, '.wiki-hashes.json');

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadHashDB() {
  if (!fs.existsSync(HASH_DB_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(HASH_DB_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveHashDB(db) {
  fs.writeFileSync(HASH_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export function hasFileChanged(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    return { changed: false, reason: 'file_not_found' };
  }

  const db = loadHashDB();
  const currentHash = computeFileHash(fullPath);
  const storedHash = db[relPath];

  if (!storedHash) {
    return { changed: true, reason: 'new_file', hash: currentHash };
  }

  if (currentHash !== storedHash) {
    return { changed: true, reason: 'content_changed', hash: currentHash, oldHash: storedHash };
  }

  return { changed: false, reason: 'unchanged', hash: currentHash };
}

export function updateFileHash(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    return false;
  }

  const db = loadHashDB();
  const currentHash = computeFileHash(fullPath);
  db[relPath] = currentHash;
  saveHashDB(db);
  return true;
}

export function checkChangedFiles(relPaths) {
  const results = {
    changed: [],
    unchanged: [],
    notFound: []
  };

  for (const relPath of relPaths) {
    const result = hasFileChanged(relPath);
    if (result.reason === 'file_not_found') {
      results.notFound.push(relPath);
    } else if (result.changed) {
      results.changed.push({ path: relPath, reason: result.reason, hash: result.hash });
    } else {
      results.unchanged.push(relPath);
    }
  }

  return results;
}

export function updateMultipleHashes(relPaths) {
  const db = loadHashDB();
  const updated = [];

  for (const relPath of relPaths) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) {
      const currentHash = computeFileHash(fullPath);
      db[relPath] = currentHash;
      updated.push(relPath);
    }
  }

  saveHashDB(db);
  return updated;
}

export function removeFileHash(relPath) {
  const db = loadHashDB();
  if (db[relPath]) {
    delete db[relPath];
    saveHashDB(db);
    return true;
  }
  return false;
}

export function listTrackedFiles() {
  const db = loadHashDB();
  return Object.keys(db);
}
