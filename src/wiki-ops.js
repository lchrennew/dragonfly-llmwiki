import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { checkChangedFiles, updateMultipleHashes } from './hash-tracker.js';

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

export function listChangedRawFiles() {
  const allFiles = listRawFiles();
  if (allFiles.length === 0) return { changed: [], unchanged: [], notFound: [] };

  const filePaths = allFiles.map(f => f.path);
  const result = checkChangedFiles(filePaths);

  return {
    changed: result.changed.map(item => ({
      name: path.basename(item.path),
      path: item.path,
      reason: item.reason
    })),
    unchanged: result.unchanged.map(p => ({
      name: path.basename(p),
      path: p
    })),
    notFound: result.notFound
  };
}

export function markFilesAsProcessed(relPaths) {
  return updateMultipleHashes(relPaths);
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

  const wikiFiles = listWikiFiles();
  const fileList = wikiFiles.map(f => `- ${f.path}`).join('\n');

  return `你是一个 LLM Wiki 知识库助手。你的职责是帮助用户管理和维护一个结构化的个人知识库。

以下是 Wiki 的 Schema 配置：
${schema}

以下是当前 Wiki 索引：
${index}

以下是当前 Wiki 总览（overview.md）：
${overview}

以下是当前 Wiki 中实际存在的所有文件：
${fileList}

你的工作：
1. 当用户要求摄入资料时，你必须完成以下所有步骤：
   a. 阅读原始文档，在 wiki/sources/ 创建来源摘要页面
   b. **识别或创建领域**：
      - 判断文档所属的领域（如：deep-learning, software-engineering）
      - 如果是新领域，创建领域索引页到 wiki/domains/
      - 如果领域已存在，准备更新领域索引页
      - 在领域索引页中列出该领域的核心概念、重要实体、关键来源
   c. **系统化提取所有概念**：
      - 识别文档中的**每一个**重要概念（理论、方法、模式、技术、原则等）
      - 为**每个**概念创建独立的页面到 wiki/concepts/
      - 在概念页面的 frontmatter 中添加 domains 字段（可多个领域）
      - 不要把多个概念合并到一个页面
      - 概念页面必须包含：定义、核心要点、应用场景、相关概念链接、参考来源
   d. **系统化提取所有实体**：
      - 识别文档中的**每一个**重要实体（人物、组织、产品、项目等）
      - 为**每个**实体创建独立的页面到 wiki/entities/
      - 在实体页面的 frontmatter 中添加 domains 字段（可多个领域）
      - 实体页面必须包含：基本信息、背景、相关概念、来源引用
   e. **更新领域索引页**：
      - 将新增的概念和实体添加到对应的领域索引页
      - 更新领域之间的父子关系（如果需要）
   f. 更新 wiki/index.md 添加所有新条目（按领域组织）
   g. 更新 wiki/overview.md 反映新增内容对整体知识库的影响
   h. 在 wiki/log.md 追加操作记录
2. 当用户提问时，基于 Wiki 内容综合回答。你可以根据文件列表中的路径来判断知识库中有哪些内容，必要时告知用户具体有哪些相关页面。
3. 当用户要求健康检查时，分析 Wiki 状态并给出建议，包括：
   - 检查领域是否需要细分（概念数>20）
   - 检查领域是否需要合并（大量重叠）
   - 检查领域命名是否一致

重要提醒：
- 摄入资料时，必须为文档中的**每个**概念创建独立页面
- 即使一个文档包含10个概念，也要创建10个独立的概念页面
- 概念之间通过 [[链接]] 建立关联，而不是合并到一个页面
- 你必须输出所有需要创建或修改的文件，包括 overview.md
- 每个文件使用以下格式：
<<<FILE:相对路径>>>
文件内容
<<<END>>>`;
}
