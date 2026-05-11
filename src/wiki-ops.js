import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
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

if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D { constructor() { } };
}

const { MarkItDown } = await import('markitdown-ts');
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
      return result?.markdown || result?.text_content || '';
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

export function buildSearchIndex() {
  const wikiFiles = listWikiFiles();
  const index = [];

  for (const file of wikiFiles) {
    const content = readFile(file.path);
    if (!content) continue;

    const entry = { path: file.path, category: file.category, keywords: [] };

    const baseName = file.name.replace('.md', '').replace(/-/g, ' ');
    entry.keywords.push(baseName);

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const titleMatch = fm.match(/title:\s*(.+)/);
      if (titleMatch) entry.title = titleMatch[1].trim();

      const tagsMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
      if (tagsMatch) {
        entry.keywords.push(...tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')));
      }

      const aliasesMatch = fm.match(/aliases:\s*\[([^\]]*)\]/);
      if (aliasesMatch) {
        entry.keywords.push(...aliasesMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')));
      }

      const domainsMatch = fm.match(/domains:\s*\[([^\]]*)\]/);
      if (domainsMatch) {
        entry.keywords.push(...domainsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')));
      }
    }

    if (entry.title) entry.keywords.push(entry.title);
    entry.keywords = [...new Set(entry.keywords.filter(k => k))];
    index.push(entry);
  }

  return index;
}

export function searchWiki(keywords) {
  const index = buildSearchIndex();
  const results = [];

  for (const entry of index) {
    let score = 0;
    const entryText = entry.keywords.join(' ').toLowerCase();

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (entryText.includes(kwLower)) {
        score += 10;
      }
      for (const ek of entry.keywords) {
        if (ek.toLowerCase() === kwLower) {
          score += 20;
          break;
        }
      }
      const baseName = entry.path.split('/').pop().replace('.md', '').replace(/-/g, ' ');
      if (baseName.toLowerCase().includes(kwLower)) {
        score += 15;
      }
    }

    if (score > 0) {
      results.push({ ...entry, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
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
    const markdown = result?.markdown || result?.text_content || html;
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

export function getSystemPrompt(mode = 'ingest') {
  const indexPath = path.join(WIKI_DIR, 'index.md');
  const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '';
  const overviewPath = path.join(WIKI_DIR, 'overview.md');
  const overview = fs.existsSync(overviewPath) ? fs.readFileSync(overviewPath, 'utf-8') : '';

  if (mode === 'query') {
    const wikiFiles = listWikiFiles();
    const fileList = wikiFiles.map(f => `- ${f.path}`).join('\n');

    return `你是一个 LLM Wiki 知识库助手。用户会向你提问，你需要基于 Wiki 中的内容回答。

当前 Wiki 索引（只列领域）：
${index}

当前 Wiki 总览：
${overview}

当前 Wiki 中存在的所有文件：
${fileList}

## 检索机制

你可以请求读取 Wiki 中的任何文件来获取详细信息。使用以下格式：
<<<READ:wiki/domains/xxx.md>>>
<<<READ:wiki/concepts/yyy.md>>>

系统会返回文件内容，然后你可以继续检索或回答问题。

## 查询流程

1. 根据用户问题，判断涉及哪些领域
2. 请求读取相关领域索引页（wiki/domains/xxx.md），了解该领域有哪些概念和实体
3. 如果领域索引页中有子领域（children），且问题可能涉及子领域，继续读取子领域索引页
4. 请求读取具体的概念/实体页面获取详细信息
5. 信息充足后，综合回答问题，附带 [[页面引用]]

## 规则

- 如果需要读取文件，只输出 READ 指令，不要输出其他内容
- 可以一次请求多个文件（最多3个）
- 从文件中发现有用信息时，用 <<<NOTE:要点内容>>> 记录关键发现（系统会保留这些笔记作为后续轮次的上下文）
- 信息充足后直接回答，不需要再输出 READ 或 NOTE 指令
- 如果 Wiki 中没有相关信息，请用你自身的知识回答用户问题
- 回答不在知识库中的问题时，在回答末尾加上标记 <<<NEW_KNOWLEDGE>>> 表示这是知识库中没有的新信息`;
  }

  const agentsPath = path.join(ROOT, 'AGENTS.md');
  const schema = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '';
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
   f. 更新 wiki/index.md（只列领域及简要描述，不列具体条目）
   g. 更新 wiki/overview.md 反映新增内容对整体知识库的影响
   h. 在 wiki/log.md 追加操作记录
2. 当用户要求健康检查时，分析 Wiki 状态并给出建议

重要提醒：
- 摄入资料时，必须为文档中的**每个**概念创建独立页面
- 即使一个文档包含10个概念，也要创建10个独立的概念页面
- 概念之间通过 [[链接]] 建立关联，而不是合并到一个页面
- index.md 只列顶层领域（没有 parent 的领域）目录和统计数字，子领域不出现在 index.md 中
- 你必须输出所有需要创建或修改的文件
- 每个文件使用以下格式：
<<<FILE:相对路径>>>
文件内容
<<<END>>>`;
}
