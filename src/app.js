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

function saveIngestProgress(fileName, completedSegments, totalSegments, opts = {}) {
  const config = loadConfig();
  const existing = config.ingestProgress || {};
  config.ingestProgress = {
    fileName,
    completedSegments,
    totalSegments,
    failedSegments: opts.failedSegments || existing.failedSegments || [],
    paused: opts.paused || false,
    pausedAt: opts.paused ? (opts.pausedAt || completedSegments) : null,
    updatedAt: new Date().toISOString(),
  };
  saveConfig(config);
}

function getIngestProgress() {
  const config = loadConfig();
  return config.ingestProgress || null;
}

function clearIngestProgress() {
  const config = loadConfig();
  delete config.ingestProgress;
  saveConfig(config);
}

const screen = blessed.screen({
  smartCSR: true,
  title: 'LLM Wiki',
  fullUnicode: true,
});

const chatBox = blessed.box({
  parent: screen,
  label: ` AI [${llm.getProviderName()}] `,
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
        chatBox.setLabel(` AI [${llm.getProviderName()}] `);
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

  if (text === '/exit' || text === '/quit' || text === '/bye') {
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

  if (text.startsWith('/ingest!')) {
    const targetName = text.replace('/ingest!', '').trim();
    if (!targetName) {
      appendChat('system', '用法: /ingest! <文件名> - 强制重新摄入指定文件');
      return;
    }
    const rawFiles = wiki.listRawFiles();
    const target = rawFiles.find(f => f.name === targetName);
    if (!target) {
      appendChat('system', `raw/ 目录中找不到文件: ${targetName}`);
      return;
    }
    updateStatus(' ⏳ 强制摄入中...');
    appendChat('system', `⏳ 强制摄入: ${targetName}...`);
    screen.render();
    await autoIngestFile(targetName);
    wiki.markFilesAsProcessed([target.path]);
    return;
  }

  if (text.startsWith('/ingest')) {
    const targetName = text.replace('/ingest', '').trim();
    const { changed, unchanged } = wiki.listChangedRawFiles();

    if (targetName) {
      const target = changed.find(f => f.name === targetName) || unchanged.find(f => f.name === targetName);
      if (!target) {
        appendChat('system', `raw/ 目录中找不到文件: ${targetName}`);
        return;
      }
      if (unchanged.find(f => f.name === targetName)) {
        appendChat('system', `文件未变化，跳过: ${targetName}（使用 /ingest! ${targetName} 强制摄入）`);
        return;
      }
      updateStatus(' ⏳ 摄入中...');
      appendChat('system', `⏳ 开始摄入: ${targetName}...`);
      screen.render();
      await autoIngestFile(targetName);
      const relPath = `raw/${targetName}`;
      wiki.markFilesAsProcessed([relPath]);
      return;
    }

    if (changed.length === 0) {
      appendChat('system', `raw/ 目录中没有需要摄入的文件（共 ${unchanged.length} 个文件已是最新）`);
      return;
    }

    appendChat('system', `发现 ${changed.length} 个待摄入文件，${unchanged.length} 个已是最新`);
    screen.render();
    for (const f of changed) {
      updateStatus(` ⏳ 摄入: ${f.name}...`);
      appendChat('system', `⏳ 开始摄入: ${f.name}（${f.reason === 'new_file' ? '新文件' : '内容已变化'}）...`);
      screen.render();
      await autoIngestFile(f.name);
      wiki.markFilesAsProcessed([f.path]);
      const progress = getIngestProgress();
      if (progress && progress.paused) {
        appendChat('system', `摄入暂停，剩余文件将在恢复后继续`);
        return;
      }
    }
    updateStatus(getDefaultStatus());
    return;
  }

  if (text === '/retry') {
    const progress = getIngestProgress();
    if (!progress) {
      appendChat('system', '没有需要恢复的摄入任务');
      return;
    }
    updateStatus(' ⏳ 重试摄入中...');
    screen.render();
    if (progress.paused && progress.failedSegments && progress.failedSegments.length > 0 && progress.completedSegments >= progress.totalSegments) {
      appendChat('system', `重试 ${progress.failedSegments.length} 个失败段落: [${progress.failedSegments.map(s => s + 1).join(', ')}]`);
      const failedList = [...progress.failedSegments];
      clearIngestProgress();
      for (const segIdx of failedList) {
        await autoIngestFile(progress.fileName, segIdx, []);
        const newProgress = getIngestProgress();
        if (newProgress && newProgress.paused) return;
      }
      clearIngestProgress();
      appendChat('system', '✓ 所有失败段落重试完成');
    } else if (progress.paused && progress.pausedAt !== null) {
      appendChat('system', `重试第 ${progress.pausedAt + 1}/${progress.totalSegments} 段...`);
      const failedSegments = (progress.failedSegments || []).filter(s => s !== progress.pausedAt);
      saveIngestProgress(progress.fileName, progress.pausedAt, progress.totalSegments, { failedSegments });
      await autoIngestFile(progress.fileName, progress.pausedAt, failedSegments);
    } else {
      appendChat('system', `恢复摄入: ${progress.fileName}（从第 ${progress.completedSegments + 1}/${progress.totalSegments} 段继续）`);
      await autoIngestFile(progress.fileName, progress.completedSegments, progress.failedSegments || []);
    }
    return;
  }

  if (text === '/continue') {
    const progress = getIngestProgress();
    if (!progress || !progress.paused) {
      appendChat('system', '当前没有暂停的摄入任务');
      return;
    }
    appendChat('system', `跳过第 ${progress.pausedAt + 1} 段，继续后续段落...`);
    updateStatus(' ⏳ 继续摄入中...');
    screen.render();
    const nextSegment = progress.pausedAt + 1;
    const failedSegments = progress.failedSegments || [];
    saveIngestProgress(progress.fileName, nextSegment, progress.totalSegments, { failedSegments });
    await autoIngestFile(progress.fileName, nextSegment, failedSegments);
    return;
  }

  if (text === '/help') {
    appendChat('system', [
      '可用命令:',
      '  /import [路径]  - 导入文件（无路径则弹出选择器）',
      '  /ingest [文件名] - 手工摄入 raw/ 中的文件（无参数则摄入所有变化文件）',
      '  /ingest! <文件名> - 强制重新摄入指定文件（忽略哈希检查）',
      '  /url <网址>     - 抓取网页内容并导入',
      '  /model [名称]   - 查看/切换模型',
      '  /retry          - 重试失败的摄入段落',
      '  /continue       - 跳过失败段落继续摄入',
      '  /lint           - 健康检查',
      '  /exit /quit /bye - 退出程序',
      '  /help           - 显示帮助',
      '',
      '使用方式:',
      '  直接输入问题与 AI 对话',
      '  使用 /import 导入文档到 raw/ 目录（自动摄入）',
      '  使用 /ingest 手工触发摄入 raw/ 中的文件',
    ].join('\n'));
    return;
  }

  updateStatus(' ⏳ 模型思考中...');
  appendChat('ai', '思考中...');

  const messages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    ...chatHistory.slice(-10),
    { role: 'user', content: text },
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

async function autoIngestFile(fileName, startFromSegment = 0, skipSegments = []) {
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
    const MAX_RETRIES = 2;

    if (content.length > INCREMENTAL_THRESHOLD) {
      const segments = splitBySentences(content, 3000);
      const totalSegments = segments.length;

      if (startFromSegment > 0) {
        appendChat('system', `从第 ${startFromSegment + 1}/${totalSegments} 段继续摄入...`);
      } else {
        appendChat('system', `文件较长（${content.length}字），将分 ${totalSegments} 段增量摄入...`);
      }
      screen.render();

      let totalFiles = 0;
      const failedSegments = [...skipSegments];

      for (let i = startFromSegment; i < totalSegments; i++) {
        if (skipSegments.includes(i)) {
          appendChat('system', `  ⏭ 跳过第 ${i + 1} 段（之前已失败，稍后统一重试）`);
          continue;
        }

        appendChat('system', `  📖 阅读第 ${i + 1}/${totalSegments} 段...`);
        screen.render();

        const isFirst = i === 0;
        const isLast = i === totalSegments - 1;

        let instruction;
        if (isFirst) {
          instruction = `你正在逐段阅读文档"${fileName}"（共${totalSegments}段），像做读书笔记一样边读边记录。

这是第 1 段：

${segments[i]}

请基于这段内容：
1. 在 wiki/sources/ 创建来源摘要页面（先写已读到的部分，后续段落会补充）
2. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面
3. 提取其中的实体，为每个实体创建 wiki/entities/ 页面
4. 识别或创建领域，更新 wiki/domains/ 索引页

每个文件用 <<<FILE:路径>>> 格式输出。暂不更新 index.md 和 overview.md（最后一段统一更新）。`;
        } else if (isLast) {
          instruction = `继续阅读文档"${fileName}"，这是最后一段（第 ${i + 1}/${totalSegments} 段）：

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
          instruction = `继续阅读文档"${fileName}"，这是第 ${i + 1}/${totalSegments} 段：

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

        let success = false;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            appendChat('system', `  🔄 第 ${i + 1} 段重试（第 ${attempt} 次）...`);
            screen.render();
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

            const files = parseFileOutputs(response);
            if (files.length > 0) {
              for (const file of files) wiki.writeFile(file.path, file.content);
              totalFiles += files.length;
              appendChat('system', `  ✓ 第 ${i + 1} 段处理完成，更新了 ${files.length} 个文件`);
            } else {
              appendChat('system', `  ✓ 第 ${i + 1} 段无新增内容`);
            }
            appendChat('ai', '');
            success = true;
            saveIngestProgress(fileName, i + 1, totalSegments, { failedSegments });
            break;
          } catch (err) {
            if (attempt === MAX_RETRIES) {
              appendChat('system', `  ⚠ 第 ${i + 1} 段处理失败（已重试 ${MAX_RETRIES} 次）: ${err.message}`);
              appendChat('system', `  💡 /retry 立即重试当前段 | /continue 跳过继续后续段落`);
              failedSegments.push(i);
              saveIngestProgress(fileName, i, totalSegments, { failedSegments, paused: true, pausedAt: i });
              updateStatus(getDefaultStatus());
              return;
            }
          }
        }
      }

      if (failedSegments.length > 0) {
        saveIngestProgress(fileName, totalSegments, totalSegments, { failedSegments });
        appendChat('system', `⚠ 摄入基本完成，但有 ${failedSegments.length} 段失败: [${failedSegments.map(s => s + 1).join(', ')}]`);
        appendChat('system', `💡 输入 /retry 重试所有失败段落`);
      } else {
        clearIngestProgress();
        appendChat('system', `✓ 增量摄入完成，共更新 ${totalFiles} 个 Wiki 文件`);
      }

    } else {
      let success = false;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          appendChat('system', `🔄 重试摄入（第 ${attempt} 次）...`);
          screen.render();
        }
        try {
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
          success = true;
          break;
        } catch (err) {
          if (attempt === MAX_RETRIES) {
            appendChat('system', `⚠ 摄入失败（已重试 ${MAX_RETRIES} 次）: ${err.message}`);
            appendChat('system', `💡 输入 /retry 可重新尝试摄入`);
            saveIngestProgress(fileName, 0, 1, { paused: true, pausedAt: 0 });
            updateStatus(getDefaultStatus());
            return;
          }
        }
      }
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

const inputHistory = [];
let historyIndex = -1;
let commandListBox = null;

const COMMANDS = [
  { cmd: '/import', desc: '导入文件' },
  { cmd: '/ingest', desc: '手工摄入' },
  { cmd: '/ingest!', desc: '强制摄入' },
  { cmd: '/url', desc: '抓取网页' },
  { cmd: '/model', desc: '切换模型' },
  { cmd: '/retry', desc: '重试失败段落' },
  { cmd: '/continue', desc: '跳过继续' },
  { cmd: '/lint', desc: '健康检查' },
  { cmd: '/help', desc: '显示帮助' },
  { cmd: '/bye', desc: '退出程序' },
];

function showCommandList() {
  if (commandListBox) return;
  commandListBox = blessed.list({
    parent: screen,
    bottom: '15%',
    left: 1,
    width: 30,
    height: COMMANDS.length + 2,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
    },
    keys: true,
    vi: true,
    mouse: true,
    items: COMMANDS.map(c => `${c.cmd}  ${c.desc}`),
  });
  commandListBox.on('select', (item, idx) => {
    const selected = COMMANDS[idx];
    inputBox.setValue(selected.cmd + ' ');
    hideCommandList();
    inputBox.focus();
    screen.render();
  });
  commandListBox.key(['escape'], () => {
    hideCommandList();
    inputBox.focus();
    screen.render();
  });
  commandListBox.focus();
  screen.render();
}

function hideCommandList() {
  if (commandListBox) {
    commandListBox.destroy();
    commandListBox = null;
  }
}

inputBox.on('keypress', (ch, key) => {
  if (key.name === 'up') {
    if (inputHistory.length === 0) return;
    if (historyIndex < inputHistory.length - 1) historyIndex++;
    inputBox.setValue(inputHistory[historyIndex]);
    screen.render();
    return false;
  }
  if (key.name === 'down') {
    if (historyIndex > 0) {
      historyIndex--;
      inputBox.setValue(inputHistory[historyIndex]);
    } else {
      historyIndex = -1;
      inputBox.setValue('');
    }
    screen.render();
    return false;
  }
  if (ch === '/' && inputBox.getValue() === '') {
    process.nextTick(() => showCommandList());
  }
});

inputBox.key('enter', () => {
  const text = inputBox.getValue();
  inputBox.clearValue();
  hideCommandList();
  screen.render();
  if (text.trim()) {
    inputHistory.unshift(text);
    if (inputHistory.length > 50) inputHistory.pop();
    historyIndex = -1;
  }
  handleUserInput(text);
});

screen.key(['C-c'], () => process.exit(0));

appendChat('system', `欢迎使用 LLM Wiki! 当前模型: ${llm.getProviderName()}`);
appendChat('system', '命令: /import 导入文件 | /url 抓取网页 | /model 切换模型 | /help 帮助');
const pendingProgress = getIngestProgress();
if (pendingProgress) {
  const failed = pendingProgress.failedSegments || [];
  if (failed.length > 0 && pendingProgress.completedSegments >= pendingProgress.totalSegments) {
    appendChat('system', `⚠ 有 ${failed.length} 个失败段落待重试: ${pendingProgress.fileName}`);
    appendChat('system', '  输入 /retry 重试失败段落');
  } else if (pendingProgress.paused) {
    appendChat('system', `⚠ 摄入暂停: ${pendingProgress.fileName}（第 ${pendingProgress.pausedAt + 1}/${pendingProgress.totalSegments} 段失败）`);
    appendChat('system', '  /retry 重试当前段 | /continue 跳过继续');
  } else {
    appendChat('system', `⚠ 有未完成的摄入任务: ${pendingProgress.fileName}（${pendingProgress.completedSegments}/${pendingProgress.totalSegments} 段已完成）`);
    appendChat('system', '  输入 /retry 从断点继续');
  }
}
inputBox.focus();
screen.render();
