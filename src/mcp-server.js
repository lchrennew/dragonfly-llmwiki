#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as wiki from './wiki-ops.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: 'llmwiki',
  version: '1.0.0',
});

server.tool(
  'wiki_import',
  {
    file_path: z.string().describe('要导入的文件绝对路径'),
    convert: z.boolean().optional().default(true).describe('是否将非文本格式转换为Markdown'),
  },
  async ({ file_path: filePath, convert }) => {
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: 'text', text: `文件不存在: ${filePath}` }], isError: true };
    }
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const convertibleExts = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.csv', '.json', '.xml'];
    const dest = path.join(wiki.RAW_DIR, fileName);

    if (!fs.existsSync(wiki.RAW_DIR)) fs.mkdirSync(wiki.RAW_DIR, { recursive: true });
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.copyFileSync(filePath, dest);

    if (convert && convertibleExts.includes(ext)) {
      const relPath = path.relative(wiki.ROOT, dest);
      const mdContent = await wiki.readFileAsMarkdown(relPath);
      if (mdContent && !mdContent.startsWith('[转换')) {
        const mdName = fileName.replace(/\.[^.]+$/, '.md');
        const mdDest = path.join(wiki.RAW_DIR, mdName);
        fs.writeFileSync(mdDest, mdContent, 'utf-8');
        fs.unlinkSync(dest);
        return { content: [{ type: 'text', text: `已导入并转换: ${fileName} → raw/${mdName}` }] };
      }
    }
    return { content: [{ type: 'text', text: `已导入: ${fileName} → raw/` }] };
  }
);

server.tool(
  'wiki_import_url',
  {
    url: z.string().url().describe('要导入的网页URL'),
  },
  async ({ url }) => {
    try {
      const result = await wiki.fetchUrl(url);
      return { content: [{ type: 'text', text: `已抓取并保存: ${result.fileName} → raw/` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `抓取失败: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'wiki_ingest',
  {
    file_name: z.string().optional().describe('指定要摄入的raw文件名，不指定则摄入所有raw文件'),
  },
  async ({ file_name: fileName }) => {
    const rawFiles = wiki.listRawFiles();
    if (rawFiles.length === 0) {
      return { content: [{ type: 'text', text: 'raw/ 目录下没有可摄入的文件' }], isError: true };
    }

    let filesToProcess = rawFiles;
    if (fileName) {
      filesToProcess = rawFiles.filter(f => f.name === fileName);
      if (filesToProcess.length === 0) {
        return { content: [{ type: 'text', text: `未找到文件: ${fileName}` }], isError: true };
      }
    }

    const systemPrompt = wiki.getSystemPrompt();
    const contentParts = [{ type: 'text', text: `[系统提示]\n${systemPrompt}` }];

    for (const f of filesToProcess) {
      const content = await wiki.readFileAsMarkdown(f.path);
      if (content) {
        contentParts.push({ type: 'text', text: `--- 原始资料: ${f.name} ---\n${content}` });
      }
    }

    contentParts.push({
      type: 'text',
      text: `[摄入指令]\n请对以上每份原始资料执行完整摄入操作。严格按照工作流完成所有步骤：创建来源摘要、更新实体/概念页面、更新 index.md、更新 overview.md、追加 log.md。请确保完整摘要文档内容，不要遗漏重要信息。每个需要创建或修改的文件都必须用 <<<FILE:路径>>> 格式输出。`,
    });

    return { content: contentParts };
  }
);

server.tool(
  'wiki_search',
  {
    query: z.string().describe('搜索关键词'),
  },
  async ({ query }) => {
    const wikiFiles = wiki.listWikiFiles();
    const results = [];
    const keywords = query.toLowerCase().split(/\s+/);

    for (const f of wikiFiles) {
      const content = wiki.readFile(f.path);
      if (!content) continue;
      const lower = content.toLowerCase();
      const matched = keywords.some(kw => lower.includes(kw));
      if (matched) {
        const lines = content.split('\n');
        const matchedLines = lines.filter(l => keywords.some(kw => l.toLowerCase().includes(kw)));
        results.push({
          file: f.path,
          category: f.category,
          preview: matchedLines.slice(0, 3).join('\n'),
        });
      }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `未找到与 "${query}" 相关的内容` }] };
    }

    const output = results.map(r => `📄 ${r.file} [${r.category}]\n${r.preview}`).join('\n\n---\n\n');
    return { content: [{ type: 'text', text: `找到 ${results.length} 个相关页面：\n\n${output}` }] };
  }
);

server.tool(
  'wiki_read',
  {
    file_path: z.string().describe('Wiki页面的相对路径，如 wiki/sources/xxx.md'),
  },
  async ({ file_path: filePath }) => {
    const content = wiki.readFile(filePath);
    if (!content) {
      return { content: [{ type: 'text', text: `文件不存在: ${filePath}` }], isError: true };
    }
    return { content: [{ type: 'text', text: content }] };
  }
);

server.tool(
  'wiki_list',
  {},
  async () => {
    const wikiFiles = wiki.listWikiFiles();
    const rawFiles = wiki.listRawFiles();

    const wikiList = wikiFiles.map(f => `  ${f.path} [${f.category}]`).join('\n');
    const rawList = rawFiles.map(f => `  ${f.path}`).join('\n');

    return {
      content: [{
        type: 'text',
        text: `Wiki 页面 (${wikiFiles.length}):\n${wikiList || '  (空)'}\n\n原始资料 (${rawFiles.length}):\n${rawList || '  (空)'}`,
      }],
    };
  }
);

server.tool(
  'wiki_write',
  {
    file_path: z.string().describe('要写入的文件相对路径，如 wiki/sources/xxx.md'),
    content: z.string().describe('文件内容'),
  },
  async ({ file_path: filePath, content }) => {
    wiki.writeFile(filePath, content);
    return { content: [{ type: 'text', text: `已写入: ${filePath}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
