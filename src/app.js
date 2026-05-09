#!/usr/bin/env node
import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { LLMClient } from './llm-client.js';
import * as wiki from './wiki-ops.js';

const llm = new LLMClient();
const chatHistory = [];

const screen = blessed.screen({
  smartCSR: true,
  title: 'LLM Wiki',
  fullUnicode: true,
});

const fileTree = blessed.list({
  parent: screen,
  label: ' 📂 文件 ',
  top: 0,
  left: 0,
  width: '30%',
  height: '70%',
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    selected: { bg: 'blue', fg: 'white' },
    item: { fg: 'white' },
    label: { fg: 'cyan' },
  },
  keys: true,
  vi: true,
  mouse: true,
  scrollable: true,
  tags: true,
});

const contentBox = blessed.box({
  parent: screen,
  label: ' 📄 内容 ',
  top: 0,
  left: '30%',
  width: '70%',
  height: '70%',
  border: { type: 'line' },
  style: {
    border: { fg: 'green' },
    label: { fg: 'green' },
  },
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  vi: true,
  mouse: true,
  tags: true,
});

const chatBox = blessed.box({
  parent: screen,
  label: ` 🤖 AI [${llm.getProviderName()}] `,
  top: '70%',
  left: 0,
  width: '100%',
  height: '20%',
  border: { type: 'line' },
  style: {
    border: { fg: 'yellow' },
    label: { fg: 'yellow' },
  },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  tags: true,
});

const inputBox = blessed.textbox({
  parent: screen,
  label: ' 输入 (Enter发送 | Tab补全 | F2切换模型 | q退出) ',
  top: '90%',
  left: 0,
  width: '100%',
  height: 4,
  border: { type: 'line' },
  style: {
    border: { fg: 'magenta' },
    label: { fg: 'magenta' },
    fg: 'white',
  },
  inputOnFocus: true,
  mouse: true,
});

const statusBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  style: { bg: 'blue', fg: 'white' },
  tags: true,
  content: ` 模型: ${llm.getProviderName()} | Enter:发送 | F2:模型 | F3:导入文件 | Tab:焦点 | q:退出`,
});

let fileItems = [];
let chatMessages = [];

function refreshFileTree() {
  const wikiTree = wiki.getFileTree(wiki.WIKI_DIR);
  const rawTree = wiki.getFileTree(wiki.RAW_DIR);
  fileItems = [
    { name: '{cyan-fg}── wiki/ ──{/cyan-fg}', path: null, type: 'header' },
    ...wikiTree,
    { name: '{cyan-fg}── raw/ ──{/cyan-fg}', path: null, type: 'header' },
    ...rawTree,
  ];
  const displayItems = fileItems.map(item => {
    if (item.type === 'header') return item.name;
    if (item.type === 'dir') return `  📁 ${item.name}/`;
    return `    📄 ${item.name}`;
  });
  fileTree.setItems(displayItems);
  screen.render();
}

async function showFileContent(relPath) {
  contentBox.setLabel(` 📄 ${relPath} `);
  contentBox.setContent('加载中...');
  screen.render();
  const content = await wiki.readFileAsMarkdown(relPath);
  if (content) {
    contentBox.setContent(content);
  } else {
    contentBox.setContent('(无法读取文件)');
  }
  screen.render();
}

function appendChat(role, text) {
  const prefix = role === 'user'
    ? '{magenta-fg}你:{/magenta-fg} '
    : role === 'system'
      ? '{cyan-fg}系统:{/cyan-fg} '
      : '{yellow-fg}AI:{/yellow-fg} ';
  chatMessages.push(`${prefix}${text}`);
  if (chatMessages.length > 100) chatMessages.shift();
  chatBox.setContent(chatMessages.join('\n'));
  chatBox.setScrollPerc(100);
  screen.render();
}

function updateStatus(text) {
  statusBar.setContent(` ${text}`);
  screen.render();
}

function parseFileOutputs(response) {
  const regex = /<<<FILE:(.*?)>>>\n([\s\S]*?)<<<END>>>/g;
  let match;
  const files = [];
  while ((match = regex.exec(response)) !== null) {
    files.push({ path: match[1].trim(), content: match[2] });
  }
  return files;
}

function splitBySemanticBoundary(text, maxSize) {
  const chunks = [];
  let remaining = text;
  const overlap = 500;

  while (remaining.length > maxSize) {
    let splitPoint = -1;
    const searchEnd = Math.min(remaining.length, maxSize);
    const searchRegion = remaining.slice(Math.floor(maxSize * 0.7), searchEnd);
    const offset = Math.floor(maxSize * 0.7);

    const headingMatch = searchRegion.lastIndexOf('\n#');
    if (headingMatch !== -1) {
      splitPoint = offset + headingMatch + 1;
    }

    if (splitPoint === -1) {
      const hrMatch = searchRegion.lastIndexOf('\n---');
      if (hrMatch !== -1) splitPoint = offset + hrMatch + 1;
    }

    if (splitPoint === -1) {
      const doubleNewline = searchRegion.lastIndexOf('\n\n');
      if (doubleNewline !== -1) splitPoint = offset + doubleNewline + 2;
    }

    if (splitPoint === -1) {
      const singleNewline = remaining.lastIndexOf('\n', searchEnd);
      if (singleNewline > maxSize * 0.5) splitPoint = singleNewline + 1;
    }

    if (splitPoint === -1) splitPoint = maxSize;

    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(Math.max(0, splitPoint - overlap));
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function handleUserInput(text) {
  if (!text.trim()) return;

  appendChat('user', text);

  if (text.startsWith('/model')) {
    const parts = text.split(/\s+/);
    if (parts[1]) {
      try {
        llm.switchProvider(parts[1]);
        appendChat('system', `已切换到: ${llm.getProviderName()}`);
        chatBox.setLabel(` 🤖 AI [${llm.getProviderName()}] `);
        updateStatus(` 模型: ${llm.getProviderName()} | Enter:发送 | F2:模型 | F3:导入文件 | Tab:焦点 | q:退出`);
      } catch (e) {
        appendChat('system', e.message);
      }
    } else {
      const list = llm.getProviderList();
      const info = list.map(p => `  ${p.active ? '→' : ' '} ${p.key} (${p.name})`).join('\n');
      appendChat('system', `可用模型:\n${info}\n用法: /model <名称>`);
    }
    return;
  }

  if (text === '/exit' || text === '/quit') {
    process.exit(0);
  }

  if (text === '/lint') {
    appendChat('system', '正在执行健康检查...');
    const wikiFiles = wiki.listWikiFiles();
    const rawFiles = wiki.listRawFiles();
    appendChat('system', `Wiki页面: ${wikiFiles.length} | 原始资料: ${rawFiles.length}`);
    return;
  }

  if (text.startsWith('/url')) {
    const url = text.replace('/url', '').trim();
    if (!url) {
      appendChat('system', '用法: /url <网页地址>\n示例: /url https://example.com/article');
      return;
    }
    appendChat('system', `正在抓取: ${url}`);
    try {
      const result = await wiki.fetchUrl(url);
      appendChat('system', `✓ 已保存: ${result.fileName} → raw/`);
      refreshFileTree();
    } catch (e) {
      appendChat('system', `抓取失败: ${e.message}`);
    }
    return;
  }

  if (text.startsWith('/import')) {
    const filePath = text.replace('/import', '').trim();
    if (!filePath) {
      showFilePicker();
      return;
    }
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      appendChat('system', `文件不存在: ${absPath}`);
      return;
    }
    importFile(absPath);
    return;
  }

  if (text === '/help') {
    appendChat('system', [
      '可用命令:',
      '  /import [路径]  - 导入文件（无路径则弹出选择器）',
      '  /url <网址>     - 抓取网页内容并导入',
      '  /model [名称]   - 查看/切换模型',
      '  /lint           - 健康检查',
      '  /exit 或 /quit  - 退出程序',
      '  /help           - 显示帮助',
      '  F3              - 打开文件选择器',
      '  直接输入        - 与 AI 对话',
    ].join('\n'));
    return;
  }

  updateStatus(' ⏳ 模型思考中...');
  appendChat('ai', '思考中...');

  let contextContent = '';
  let isIngest = text.includes('摄入') || text.includes('ingest');
  if (isIngest) {
    const rawFiles = wiki.listRawFiles();
    for (const f of rawFiles) {
      const content = await wiki.readFileAsMarkdown(f.path);
      if (content) {
        contextContent += `\n\n--- 原始资料: ${f.name} ---\n${content}`;
      }
    }
  }

  const messages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    ...chatHistory.slice(-10),
  ];

  if (contextContent) {
    const rawFiles = wiki.listRawFiles();
    let allFiles = [];
    const CHUNK_SIZE = 30000;
    let needsBatch = false;

    for (const f of rawFiles) {
      const content = await wiki.readFileAsMarkdown(f.path);
      if (content && content.length > CHUNK_SIZE) {
        needsBatch = true;
        break;
      }
    }

    if (needsBatch || contextContent.length > 60000) {
      appendChat('system', `资料较长，将逐个文件摄入...`);
      screen.render();

      for (const f of rawFiles) {
        const content = await wiki.readFileAsMarkdown(f.path);
        if (!content) continue;

        appendChat('system', `⏳ 正在摄入: ${f.name} (${Math.round(content.length / 1000)}k字符)...`);
        screen.render();

        if (content.length > CHUNK_SIZE) {
          const chunks = splitBySemanticBoundary(content, CHUNK_SIZE);

          let partialSummaries = '';
          for (let i = 0; i < chunks.length; i++) {
            appendChat('system', `  📄 处理第 ${i + 1}/${chunks.length} 段...`);
            screen.render();

            const chunkMessages = [
              { role: 'system', content: '你是一个文档摘要助手。请对以下文档片段进行详细摘要，保留所有关键信息、数据、观点和结论。不要遗漏重要内容。注意：这是一个较长文档的片段，片段开头或结尾可能与前后内容相关联，请尽量完整理解当前片段的语义。' },
              { role: 'user', content: `这是文档"${f.name}"的第 ${i + 1}/${chunks.length} 部分：\n\n${chunks[i]}\n\n请输出这部分的详细摘要，保留所有重要信息。` },
            ];

            try {
              let summary = '';
              await llm.chatStream(chunkMessages, (chunk) => { summary += chunk; });
              partialSummaries += `\n\n### 第${i + 1}部分摘要\n${summary}`;
            } catch (err) {
              partialSummaries += `\n\n### 第${i + 1}部分\n[处理失败: ${err.message}]`;
            }
          }

          const finalMessages = [
            { role: 'system', content: wiki.getSystemPrompt() },
            { role: 'user', content: `请执行摄入操作。以下是文档"${f.name}"各部分的详细摘要：${partialSummaries}\n\n请基于以上完整摘要，严格按照工作流完成所有步骤：创建来源摘要、更新实体/概念页面、更新 index.md、更新 overview.md、追加 log.md。每个需要创建或修改的文件都必须用 <<<FILE:路径>>> 格式输出。请确保wiki页面完整反映文档全部内容。\n\n用户补充指令：${text}` },
          ];

          try {
            let response = '';
            await llm.chatStream(finalMessages, (chunk) => {
              response += chunk;
              const displayText = response.replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]');
              chatMessages[chatMessages.length - 1] = `{yellow-fg}AI:{/yellow-fg} ${displayText}`;
              chatBox.setContent(chatMessages.join('\n'));
              chatBox.setScrollPerc(100);
              screen.render();
            });

            const files = parseFileOutputs(response);
            if (files.length > 0) {
              for (const file of files) wiki.writeFile(file.path, file.content);
              allFiles.push(...files);
            }
            appendChat('ai', '');
          } catch (err) {
            appendChat('system', `摄入 ${f.name} 失败: ${err.message}`);
          }
        } else {
          const batchMessages = [
            { role: 'system', content: wiki.getSystemPrompt() },
            { role: 'user', content: `请执行摄入操作。以下是需要处理的原始资料：\n\n--- 原始资料: ${f.name} ---\n${content}\n\n请严格按照工作流完成所有步骤：创建来源摘要、更新实体/概念页面、更新 index.md、更新 overview.md、追加 log.md。每个需要创建或修改的文件都必须用 <<<FILE:路径>>> 格式输出。请确保完整摘要文档内容，不要遗漏重要信息。\n\n用户补充指令：${text}` },
          ];

          try {
            let response = '';
            await llm.chatStream(batchMessages, (chunk) => {
              response += chunk;
              const displayText = response.replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]');
              chatMessages[chatMessages.length - 1] = `{yellow-fg}AI:{/yellow-fg} ${displayText}`;
              chatBox.setContent(chatMessages.join('\n'));
              chatBox.setScrollPerc(100);
              screen.render();
            });

            const files = parseFileOutputs(response);
            if (files.length > 0) {
              for (const file of files) wiki.writeFile(file.path, file.content);
              allFiles.push(...files);
            }
            appendChat('ai', '');
          } catch (err) {
            appendChat('system', `摄入 ${f.name} 失败: ${err.message}`);
          }
        }
      }

      if (allFiles.length > 0) {
        appendChat('system', `✓ 摄入完成，共更新 ${allFiles.length} 个文件`);
        refreshFileTree();
      }
      updateStatus(` 模型: ${llm.getProviderName()} | Enter:发送 | F2:模型 | F3:导入文件 | Tab:焦点 | q:退出`);
      return;
    }

    messages.push({ role: 'user', content: `请执行摄入操作。以下是需要处理的原始资料：${contextContent}\n\n请严格按照工作流完成所有步骤，包括：创建来源摘要、更新实体/概念页面、更新 index.md、更新 overview.md、追加 log.md。每个需要创建或修改的文件都必须用 <<<FILE:路径>>> 格式输出。请确保完整摘要文档内容，不要遗漏重要信息。\n\n用户补充指令：${text}` });
  } else {
    messages.push({ role: 'user', content: text });
  }

  try {
    let response = '';
    await llm.chatStream(messages, (chunk) => {
      response += chunk;
      const displayText = response.replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]');
      chatMessages[chatMessages.length - 1] = `{yellow-fg}AI:{/yellow-fg} ${displayText}`;
      chatBox.setContent(chatMessages.join('\n'));
      chatBox.setScrollPerc(100);
      screen.render();
    });

    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: response });

    const files = parseFileOutputs(response);
    if (files.length > 0) {
      for (const f of files) {
        wiki.writeFile(f.path, f.content);
      }
      appendChat('system', `✓ 已更新 ${files.length} 个文件`);
      refreshFileTree();
    }
  } catch (err) {
    chatMessages[chatMessages.length - 1] = `{red-fg}错误:{/red-fg} ${err.message}`;
    chatBox.setContent(chatMessages.join('\n'));
    screen.render();
  }

  updateStatus(` 模型: ${llm.getProviderName()} | Enter:发送 | F2:模型 | F3:导入文件 | Tab:焦点 | q:退出`);
}

fileTree.on('select', (item, index) => {
  const fileItem = fileItems[index];
  if (fileItem && fileItem.type === 'file') {
    showFileContent(fileItem.path);
  }
});

async function importFile(absPath) {
  const fileName = path.basename(absPath);
  const ext = path.extname(fileName).toLowerCase();
  const convertibleExts = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.csv', '.json', '.xml'];
  const dest = path.join(wiki.RAW_DIR, fileName);
  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.copyFileSync(absPath, dest);
    if (convertibleExts.includes(ext)) {
      appendChat('system', `⏳ 正在转换: ${fileName} → Markdown...`);
      screen.render();
      const relPath = path.relative(wiki.ROOT, dest);
      const mdContent = await wiki.readFileAsMarkdown(relPath);
      if (mdContent && !mdContent.startsWith('[转换')) {
        const mdName = fileName.replace(/\.[^.]+$/, '.md');
        const mdDest = path.join(wiki.RAW_DIR, mdName);
        fs.writeFileSync(mdDest, mdContent, 'utf-8');
        fs.unlinkSync(dest);
        appendChat('system', `✓ 已导入并转换: ${fileName} → raw/${mdName}`);
      } else {
        appendChat('system', `✓ 已导入: ${fileName} → raw/（转换失败，保留原文件）`);
      }
    } else {
      appendChat('system', `✓ 已导入: ${fileName} → raw/`);
    }
    refreshFileTree();
  } catch (e) {
    if (e.code === 'EACCES') {
      appendChat('system', `权限不足: ${fileName}\n请在终端执行: chmod +r "${absPath}"`);
    } else {
      appendChat('system', `导入失败: ${e.message}`);
    }
  }
}

function showFilePicker(startDir = process.env.HOME || '/') {
  let currentDir = startDir;
  let pickerEntries = [];

  const pickerBox = blessed.list({
    parent: screen,
    label: ` 📂 选择文件 [${currentDir}] `,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '60%',
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
      label: { fg: 'cyan' },
    },
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    tags: true,
  });

  function loadDir(dir) {
    currentDir = dir;
    pickerBox.setLabel(` 📂 选择文件 [${dir}] `);
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });
      pickerEntries = [{ name: '..', type: 'dir' }];
      const displayItems = ['[上级目录] ..'];
      for (const e of entries) {
        if (e.isDirectory()) {
          pickerEntries.push({ name: e.name, type: 'dir' });
          displayItems.push(`[目录] ${e.name}`);
        } else if (/\.(md|txt|pdf|docx|pptx|xlsx|html|htm|csv|json|xml)$/i.test(e.name)) {
          pickerEntries.push({ name: e.name, type: 'file' });
          displayItems.push(`[文件] ${e.name}`);
        }
      }
      pickerBox.setItems(displayItems);
      pickerBox.select(0);
      screen.render();
    } catch {
      appendChat('system', `无法读取目录: ${dir}`);
      pickerBox.destroy();
      screen.render();
    }
  }

  pickerBox.on('select', (item, idx) => {
    const entry = pickerEntries[idx];
    if (!entry) return;
    if (entry.type === 'dir') {
      if (entry.name === '..') {
        loadDir(path.dirname(currentDir));
      } else {
        loadDir(path.join(currentDir, entry.name));
      }
    } else {
      const selected = path.join(currentDir, entry.name);
      pickerBox.destroy();
      screen.render();
      importFile(selected);
    }
  });

  pickerBox.key(['escape'], () => {
    pickerBox.destroy();
    screen.render();
  });

  pickerBox.key(['backspace'], () => {
    loadDir(path.dirname(currentDir));
  });

  pickerBox.focus();
  loadDir(currentDir);
}

inputBox.key('enter', () => {
  const text = inputBox.getValue();
  inputBox.clearValue();
  screen.render();
  handleUserInput(text);
});

screen.key(['f2'], () => {
  const providers = llm.getProviderList();
  const listBox = blessed.list({
    parent: screen,
    label: ' 选择模型 ',
    top: 'center',
    left: 'center',
    width: 40,
    height: providers.length + 4,
    border: { type: 'line' },
    style: {
      border: { fg: 'yellow' },
      selected: { bg: 'blue', fg: 'white' },
    },
    keys: true,
    mouse: true,
    items: providers.map(p => `${p.active ? '→ ' : '  '}${p.name} (${p.key})`),
  });
  listBox.focus();
  listBox.on('select', (item, idx) => {
    const selected = providers[idx];
    try {
      llm.switchProvider(selected.key);
      chatBox.setLabel(` 🤖 AI [${llm.getProviderName()}] `);
      updateStatus(` 模型: ${llm.getProviderName()} | Enter:发送 | F2:模型 | F3:导入文件 | Tab:焦点 | q:退出`);
      appendChat('system', `已切换到: ${llm.getProviderName()}`);
    } catch (e) {
      appendChat('system', e.message);
    }
    listBox.destroy();
    screen.render();
  });
  listBox.key(['escape'], () => {
    listBox.destroy();
    screen.render();
  });
  screen.render();
});

screen.key(['tab'], () => {
  if (inputBox.focused) return;
  if (fileTree.focused) {
    inputBox.focus();
  } else {
    fileTree.focus();
  }
  screen.render();
});

screen.key(['f3'], () => {
  showFilePicker();
});

screen.key(['q', 'C-c'], () => process.exit(0));

refreshFileTree();
appendChat('system', `欢迎使用 LLM Wiki! 当前模型: ${llm.getProviderName()}`);
appendChat('system', '命令: /import 导入文件 | /url 抓取网页 | /model 切换模型 | /lint 健康检查 | /help 帮助');
inputBox.focus();
screen.render();
