#!/usr/bin/env node
import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { LLMClient } from './llm-client.js';
import * as wiki from './wiki-ops.js';

const llm = new LLMClient();
const chatHistory = [];

const CONFIG_PATH = path.join(wiki.ROOT, '.wiki-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { }
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function getLastImportDir() {
  const config = loadConfig();
  const dir = config.lastImportDir;
  if (dir && fs.existsSync(dir)) return dir;
  return process.env.HOME || '/';
}

function setLastImportDir(dir) {
  const config = loadConfig();
  config.lastImportDir = dir;
  saveConfig(config);
}

const screen = blessed.screen({
  smartCSR: true,
  title: 'LLM Wiki',
  fullUnicode: true,
});

const chatBox = blessed.box({
  parent: screen,
  label: ` 🤖 AI [${llm.getProviderName()}] `,
  top: 0,
  left: 0,
  width: '100%',
  height: '85%',
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
  label: ' 输入 (Enter发送) ',
  top: '85%',
  left: 0,
  width: '100%',
  height: '15%',
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
  content: ` 模型: ${llm.getProviderName()} | 输入 /help 查看命令`,
});

let chatMessages = [];

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
  statusBar.setContent(text);
  screen.render();
}

function getDefaultStatus() {
  return ` 模型: ${llm.getProviderName()} | 输入 /help 查看命令`;
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

function splitBySentences(text, targetSize = 3000) {
  const sentenceEnders = /([。！？.!?\n\n])/g;
  const segments = [];
  let current = '';

  const parts = text.split(sentenceEnders);
  for (let i = 0; i < parts.length; i++) {
    current += parts[i];
    const isEnder = sentenceEnders.test(parts[i]);
    sentenceEnders.lastIndex = 0;
    if (isEnder && current.length >= targetSize) {
      segments.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(s => s.length > 0);
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
        updateStatus(getDefaultStatus());
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

      appendChat('system', `⏳ 开始自动摄入: ${result.fileName}...`);
      screen.render();
      await autoIngestFile(result.fileName);

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
    setLastImportDir(path.dirname(absPath));
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
      '',
      '快捷键:',
      '  ^P (Ctrl+P)     - 切换模型',
      '  ^O (Ctrl+O)     - 打开文件选择器',
      '  ^Q (Ctrl+Q)     - 退出程序',
      '',
      '使用方式:',
      '  直接输入问题与 AI 对话',
      '  使用 /import 或 ^O 导入文档到 raw/ 目录',
      '  输入任意文本让 AI 摄入资料并生成 Wiki',
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
      }
      updateStatus(getDefaultStatus());
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
    }
  } catch (err) {
    chatMessages[chatMessages.length - 1] = `{red-fg}错误:{/red-fg} ${err.message}`;
    chatBox.setContent(chatMessages.join('\n'));
    screen.render();
  }

  updateStatus(getDefaultStatus());
}

async function importFile(absPath) {
  const fileName = path.basename(absPath);
  const ext = path.extname(fileName).toLowerCase();
  const convertibleExts = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.csv', '.json', '.xml'];
  const dest = path.join(wiki.RAW_DIR, fileName);
  let importedFileName = fileName;

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
        importedFileName = mdName;
        appendChat('system', `✓ 已导入并转换: ${fileName} → raw/${mdName}`);
      } else {
        appendChat('system', `✓ 已导入: ${fileName} → raw/（转换失败，保留原文件）`);
      }
    } else {
      appendChat('system', `✓ 已导入: ${fileName} → raw/`);
    }

    const importedRelPath = path.relative(wiki.ROOT, path.join(wiki.RAW_DIR, importedFileName));
    const { changed } = wiki.listChangedRawFiles();
    const isChanged = changed.some(f => f.path === importedRelPath);

    if (!isChanged) {
      appendChat('system', `⏭ 文件内容未变化，跳过摄入: ${importedFileName}`);
      return;
    }

    appendChat('system', `⏳ 开始自动摄入: ${importedFileName}...`);
    screen.render();
    await autoIngestFile(importedFileName);
    wiki.markFilesAsProcessed([importedRelPath]);

  } catch (e) {
    if (e.code === 'EACCES') {
      appendChat('system', `权限不足: ${fileName}\n请在终端执行: chmod +r "${absPath}"`);
    } else {
      appendChat('system', `导入失败: ${e.message}`);
    }
  }
}

async function autoIngestFile(fileName) {
  try {
    const rawFiles = wiki.listRawFiles();
    const targetFile = rawFiles.find(f => f.name === fileName);

    if (!targetFile) {
      appendChat('system', `找不到文件: ${fileName}`);
      return;
    }

    const content = await wiki.readFileAsMarkdown(targetFile.path);
    if (!content) {
      appendChat('system', `无法读取文件内容: ${fileName}`);
      return;
    }

    const INCREMENTAL_THRESHOLD = 6000;

    if (content.length > INCREMENTAL_THRESHOLD) {
      const segments = splitBySentences(content, 3000);
      appendChat('system', `文件较长（${content.length}字），将分 ${segments.length} 段增量摄入...`);
      screen.render();

      let totalFiles = 0;
      for (let i = 0; i < segments.length; i++) {
        appendChat('system', `  📖 阅读第 ${i + 1}/${segments.length} 段...`);
        screen.render();

        const isFirst = i === 0;
        const isLast = i === segments.length - 1;

        let instruction;
        if (isFirst) {
          instruction = `你正在逐段阅读文档"${fileName}"（共${segments.length}段），像做读书笔记一样边读边记录。

这是第 1 段：

${segments[i]}

请基于这段内容：
1. 在 wiki/sources/ 创建来源摘要页面（先写已读到的部分，后续段落会补充）
2. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面
3. 提取其中的实体，为每个实体创建 wiki/entities/ 页面
4. 识别或创建领域，更新 wiki/domains/ 索引页

每个文件用 <<<FILE:路径>>> 格式输出。暂不更新 index.md 和 overview.md（最后一段统一更新）。`;
        } else if (isLast) {
          instruction = `继续阅读文档"${fileName}"，这是最后一段（第 ${i + 1}/${segments.length} 段）：

${segments[i]}

请基于这段内容：
1. 补充/更新 wiki/sources/ 来源摘要页面
2. 提取新概念，创建新的 wiki/concepts/ 页面；如果已有概念需要补充，输出更新后的完整页面
3. 提取新实体，创建新的 wiki/entities/ 页面；如果已有实体需要补充，输出更新后的完整页面
4. 更新领域索引页
5. 更新 wiki/index.md（包含本次摄入的所有条目）
6. 更新 wiki/overview.md
7. 追加 wiki/log.md 操作记录

每个文件用 <<<FILE:路径>>> 格式输出。`;
        } else {
          instruction = `继续阅读文档"${fileName}"，这是第 ${i + 1}/${segments.length} 段：

${segments[i]}

请基于这段内容：
1. 如果来源摘要需要补充，输出更新后的 wiki/sources/ 页面
2. 提取新概念，创建新的 wiki/concepts/ 页面；如果已有概念需要补充，输出更新后的完整页面
3. 提取新实体，创建新的 wiki/entities/ 页面；如果已有实体需要补充，输出更新后的完整页面
4. 更新领域索引页（如有新增）

每个文件用 <<<FILE:路径>>> 格式输出。暂不更新 index.md 和 overview.md。
如果这段没有新的概念或实体需要记录，可以只输出简短说明。`;
        }

        const messages = [
          { role: 'system', content: wiki.getSystemPrompt() },
          { role: 'user', content: instruction },
        ];

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

          const files = parseFileOutputs(response);
          if (files.length > 0) {
            for (const file of files) wiki.writeFile(file.path, file.content);
            totalFiles += files.length;
            appendChat('system', `  ✓ 第 ${i + 1} 段处理完成，更新了 ${files.length} 个文件`);
          } else {
            appendChat('system', `  ✓ 第 ${i + 1} 段无新增内容`);
          }
          appendChat('ai', '');
        } catch (err) {
          appendChat('system', `  ⚠ 第 ${i + 1} 段处理失败: ${err.message}`);
        }
      }

      appendChat('system', `✓ 增量摄入完成，共更新 ${totalFiles} 个 Wiki 文件`);

    } else {
      const messages = [
        { role: 'system', content: wiki.getSystemPrompt() },
        { role: 'user', content: `请执行摄入操作。以下是需要处理的原始资料：\n\n--- 原始资料: ${fileName} ---\n${content}\n\n请严格按照工作流完成所有步骤：创建来源摘要、更新实体/概念页面、更新 index.md、更新 overview.md、追加 log.md。每个需要创建或修改的文件都必须用 <<<FILE:路径>>> 格式输出。请确保完整摘要文档内容，不要遗漏重要信息。` },
      ];

      let response = '';
      await llm.chatStream(messages, (chunk) => {
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
        appendChat('system', `✓ 摄入完成，已更新 ${files.length} 个 Wiki 文件`);
      }
      appendChat('ai', '');
    }

    updateStatus(getDefaultStatus());

  } catch (err) {
    appendChat('system', `摄入失败: ${err.message}`);
    updateStatus(getDefaultStatus());
  }
}

function showFilePicker(startDir = getLastImportDir()) {
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
      setLastImportDir(currentDir);
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

screen.key(['C-c'], () => process.exit(0));

appendChat('system', `欢迎使用 LLM Wiki! 当前模型: ${llm.getProviderName()}`);
appendChat('system', '命令: /import 导入文件 | /url 抓取网页 | /model 切换模型 | /help 帮助');
inputBox.focus();
screen.render();
