import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
export const WIKI_DIR = path.join(ROOT, 'wiki');
export const RAW_DIR = path.join(ROOT, 'raw');

const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.csv', '.json', '.xml'];

export function getFileTree(dir, prefix = '') {
  const items = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, fullPath);
    if (entry.isDirectory()) {
      items.push({ name: entry.name, path: relPath, type: 'dir' });
      items.push(...getFileTree(fullPath, prefix + '  '));
    } else if (SUPPORTED_EXTS.includes(path.extname(entry.name).toLowerCase())) {
      items.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }
  return items;
}

const require = createRequire(import.meta.url);
const { MarkItDown } = require('markitdown-node');
const markitdown = new MarkItDown();

const CONVERTIBLE_EXTS = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.csv', '.json', '.xml'];

export function readFile(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

function suppressWarnings() {
  const origWarn = console.warn;
  const origLog = console.log;
  const origStderrWrite = process.stderr.write;
  console.warn = () => { };
  console.log = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('Warning:') || msg.includes('TT:')) return;
    origLog.apply(console, args);
  };
  process.stderr.write = (chunk, ...rest) => {
    if (typeof chunk === 'string' && (chunk.includes('Warning') || chunk.includes('TT:'))) return true;
    return origStderrWrite.call(process.stderr, chunk, ...rest);
  };
  return () => {
    console.warn = origWarn;
    console.log = origLog;
    process.stderr.write = origStderrWrite;
  };
}

export async function readFileAsMarkdown(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  const ext = path.extname(fullPath).toLowerCase();
  if (CONVERTIBLE_EXTS.includes(ext)) {
    const restore = suppressWarnings();
    try {
      const result = await markitdown.convert(fullPath);
      if (result.status === 'success') {
        return result.markdown_content || result.text_content || '';
      }
      return `[转换失败: ${result.status}]`;
    } catch (e) {
      return `[转换错误: ${e.message}]`;
    } finally {
      restore();
    }
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

export function writeFile(relPath, content) {
  const fullPath = path.join(ROOT, relPath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf-8');
}

export function listRawFiles() {
  if (!fs.existsSync(RAW_DIR)) return [];
  return fs.readdirSync(RAW_DIR)
    .filter(f => SUPPORTED_EXTS.includes(path.extname(f).toLowerCase()))
    .map(f => ({ name: f, path: path.join('raw', f) }));
}

export function listWikiFiles() {
  if (!fs.existsSync(WIKI_DIR)) return [];
  const results = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        results.push({
          name: entry.name,
          path: path.relative(ROOT, full),
          category: path.relative(WIKI_DIR, dir) || 'root',
        });
      }
    }
  };
  walk(WIKI_DIR);
  return results;
}

export async function fetchUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const html = await res.text();
  const tempFile = path.join(RAW_DIR, `_temp_${Date.now()}.html`);
  fs.writeFileSync(tempFile, html, 'utf-8');
  const restore = suppressWarnings();
  try {
    const result = await markitdown.convert(tempFile);
    const markdown = result.markdown_content || result.text_content || html;
    const slug = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '-').slice(0, 60);
    const fileName = `${slug}.md`;
    const dest = path.join(RAW_DIR, fileName);
    fs.writeFileSync(dest, `---\nsource_url: ${url}\nfetched: ${new Date().toISOString().slice(0, 10)}\n---\n\n${markdown}`, 'utf-8');
    return { fileName, path: path.join('raw', fileName) };
  } finally {
    restore();
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

export function appendToLog(entry) {
  const logPath = path.join(WIKI_DIR, 'log.md');
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  const lines = existing.split('\n');
  const lastDashIdx = lines.lastIndexOf('---');
  const insertPoint = lastDashIdx >= 0 ? lastDashIdx + 1 : lines.length;
  lines.splice(insertPoint, 0, '', entry);
  fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
}

export function getSystemPrompt() {
  const agentsPath = path.join(ROOT, 'AGENTS.md');
  const schema = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '';
  const indexPath = path.join(WIKI_DIR, 'index.md');
  const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '';
  const overviewPath = path.join(WIKI_DIR, 'overview.md');
  const overview = fs.existsSync(overviewPath) ? fs.readFileSync(overviewPath, 'utf-8') : '';

  return `你是一个 LLM Wiki 知识库助手。你的职责是帮助用户管理和维护一个结构化的个人知识库。

以下是 Wiki 的 Schema 配置：
${schema}

以下是当前 Wiki 索引：
${index}

以下是当前 Wiki 总览（overview.md）：
${overview}

你的工作：
1. 当用户要求摄入资料时，你必须完成以下所有步骤：
   a. 阅读原始文档，在 wiki/sources/ 创建来源摘要页面
   b. 识别并更新相关的实体页面（wiki/entities/）
   c. 识别并更新相关的概念页面（wiki/concepts/）
   d. 更新 wiki/index.md 添加新条目
   e. 更新 wiki/overview.md 反映新增内容对整体知识库的影响
   f. 在 wiki/log.md 追加操作记录
2. 当用户提问时，基于 Wiki 内容综合回答
3. 当用户要求健康检查时，分析 Wiki 状态并给出建议

重要：摄入资料时，你必须输出所有需要创建或修改的文件，包括 overview.md。每个文件使用以下格式：
<<<FILE:相对路径>>>
文件内容
<<<END>>>`;
}
