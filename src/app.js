#!/usr/bin/env node
import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { LLMClient } from './llm-client.js';
import * as wiki from './wiki-ops.js';
import { getLastImportDir, setLastImportDir, getIngestProgress, clearIngestProgress, saveIngestProgress } from './config.js';
import { autoIngestFile, parseFileOutputs } from './ingest.js';
import { handleQuery } from './query.js';
import { createUI, showFilePicker } from './ui.js';

const llm = new LLMClient();
const chatHistory = [];
const ui = createUI(llm);
const { screen, chatBox, inputBox, appendChat, updateStatus, getDefaultStatus, chatMessages } = ui;

function getContext() {
  return { llm, appendChat, updateStatus, getDefaultStatus, screen, chatMessages, chatBox, chatHistory };
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
    await autoIngestFile(importedFileName, 0, [], {}, getContext());
    wiki.markFilesAsProcessed([importedRelPath]);

  } catch (e) {
    if (e.code === 'EACCES') {
      appendChat('system', `权限不足: ${fileName}\n请在终端执行: chmod +r "${absPath}"`);
    } else {
      appendChat('system', `导入失败: ${e.message}`);
    }
  }
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

  if (text === '/prune --all') {
    const wikiFiles = wiki.listWikiFiles();
    let deleted = 0;
    for (const f of wikiFiles) {
      const fullPath = path.join(wiki.ROOT, f.path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    }
    const hashPath = path.join(wiki.ROOT, '.wiki-hashes.json');
    if (fs.existsSync(hashPath)) fs.writeFileSync(hashPath, '{}', 'utf-8');
    clearIngestProgress();
    appendChat('system', `✓ 已清空 Wiki（删除了 ${deleted} 个文件），哈希和进度已重置`);
    return;
  }

  if (text === '/prune') {
    handlePrune();
    return;
  }

  if (text === '/lint') {
    appendChat('system', '正在执行健康检查...');
    const wikiFiles = wiki.listWikiFiles();
    const rawFiles = wiki.listRawFiles();
    appendChat('system', `Wiki页面: ${wikiFiles.length} | 原始资料: ${rawFiles.length}`);
    return;
  }

  if (text === '/reindex') {
    await handleReindex();
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
      await autoIngestFile(result.fileName, 0, [], {}, getContext());
    } catch (e) {
      appendChat('system', `抓取失败: ${e.message}`);
    }
    return;
  }

  if (text.startsWith('/import')) {
    const filePath = text.replace('/import', '').trim();
    if (!filePath) {
      showFilePicker(screen, getLastImportDir(), (selected, dir) => {
        setLastImportDir(dir);
        importFile(selected);
      });
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
    await handleForceIngest(text);
    return;
  }

  if (text.startsWith('/ingest')) {
    await handleIngest(text);
    return;
  }

  if (text.startsWith('/retry')) {
    await handleRetry(text);
    return;
  }

  if (text.startsWith('/continue')) {
    await handleContinue(text);
    return;
  }

  if (text.startsWith('/learn')) {
    await handleLearn(text);
    return;
  }

  if (text === '/help') {
    appendChat('system', [
      '可用命令:',
      '  /import [路径]  - 导入文件（无路径则弹出选择器）',
      '  /ingest [文件名] [--brief] - 手工摄入（--brief 精简模式）',
      '  /ingest! <文件名> [--brief] - 强制重新摄入',
      '  /url <网址>     - 抓取网页内容并导入',
      '  /learn <内容>   - 对话式录入新知识',
      '  /model [名称]   - 查看/切换模型',
      '  /retry          - 重试失败的摄入段落',
      '  /continue       - 跳过失败段落继续摄入',
      '  /reindex        - 重建索引层级结构',
      '  /prune          - 清理不可达的领域索引页',
      '  /lint           - 健康检查',
      '  /exit /quit /bye - 退出程序',
      '  /help           - 显示帮助',
      '',
      '使用方式:',
      '  直接输入问题与 AI 对话',
      '  使用 /import 导入文档到 raw/ 目录（自动摄入）',
      '  使用 /ingest 手工触发摄入 raw/ 中的文件',
      '  使用 /learn 直接告诉系统新知识',
    ].join('\n'));
    return;
  }

  await handleQuery(text, getContext());
}

function handlePrune() {
  const indexContent = wiki.readFile('wiki/index.md');
  if (!indexContent) {
    appendChat('system', 'wiki/index.md 不存在，请先执行 /reindex');
    return;
  }

  const domainLinkRegex = /\[\[domains\/([^\]]+)\]\]/g;
  let match;
  const topDomains = new Set();
  while ((match = domainLinkRegex.exec(indexContent)) !== null) {
    topDomains.add(match[1].replace('.md', ''));
  }

  if (topDomains.size === 0) {
    appendChat('system', 'index.md 中没有找到领域链接');
    return;
  }

  const reachable = new Set();
  const queue = [...topDomains];
  while (queue.length > 0) {
    const domain = queue.shift();
    if (reachable.has(domain)) continue;
    reachable.add(domain);
    const domainContent = wiki.readFile(`wiki/domains/${domain}.md`);
    if (!domainContent) continue;
    const fmMatch = domainContent.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const childrenMatch = fmMatch[1].match(/children:\s*\[([^\]]*)\]/);
    if (childrenMatch) {
      const children = childrenMatch[1].split(',').map(c => c.trim().replace(/['"]/g, '')).filter(c => c);
      for (const child of children) {
        if (!reachable.has(child)) queue.push(child);
      }
    }
  }

  const wikiFiles = wiki.listWikiFiles();
  const domainFiles = wikiFiles.filter(f => f.category === 'domains' && f.name.endsWith('.md'));
  const unreachable = domainFiles.filter(f => {
    const name = f.name.replace('.md', '');
    return !reachable.has(name);
  });

  if (unreachable.length === 0) {
    appendChat('system', `✓ 所有领域索引页均可达（共 ${reachable.size} 个领域）`);
    return;
  }

  appendChat('system', `发现 ${unreachable.length} 个不可达的领域索引页：`);
  for (const f of unreachable) {
    appendChat('system', `  - ${f.path}`);
  }

  for (const f of unreachable) {
    const fullPath = path.join(wiki.ROOT, f.path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
  appendChat('system', `✓ 已删除 ${unreachable.length} 个不可达的领域索引页`);
}

async function handleReindex() {
  const wikiFiles = wiki.listWikiFiles();
  const contentFiles = wikiFiles.filter(f => !['index.md', 'log.md', 'overview.md'].includes(f.name) && f.category !== 'domains');
  if (contentFiles.length === 0) {
    appendChat('system', 'Wiki 中没有内容页面，无需重建索引');
    return;
  }

  appendChat('system', `⏳ 正在重建索引（${contentFiles.length} 个页面）...`);
  updateStatus(' ⏳ 重建索引中...');
  screen.render();

  const domainGroups = {};
  for (const f of contentFiles) {
    const content = wiki.readFile(f.path);
    if (!content) continue;
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch ? fmMatch[1] : '';
    const domainsMatch = fm.match(/domains:\s*\[([^\]]*)\]/);
    const domains = domainsMatch
      ? domainsMatch[1].split(',').map(d => d.trim().replace(/['"]/g, '')).filter(d => d)
      : ['uncategorized'];
    for (const domain of domains) {
      if (!domainGroups[domain]) domainGroups[domain] = [];
      domainGroups[domain].push({ path: f.path, fm: fm.replace(/\n/g, ' | ') });
    }
  }

  const domainNames = Object.keys(domainGroups);
  let totalFiles = 0;

  for (let i = 0; i < domainNames.length; i++) {
    const domain = domainNames[i];
    const pages = domainGroups[domain];
    appendChat('system', `  📂 处理领域 ${i + 1}/${domainNames.length}: ${domain}（${pages.length} 个页面）...`);
    screen.render();

    const pagesInfo = pages.map(p => `- ${p.path}: ${p.fm}`).join('\n');
    const messages = [
      { role: 'system', content: wiki.getSystemPrompt() },
      {
        role: 'user', content: `请为领域"${domain}"创建或更新索引页 wiki/domains/${domain}.md。

该领域包含以下页面：
${pagesInfo}

请输出完整的领域索引页，包含：概述、核心概念列表、重要实体列表、关键来源列表。
如果该领域应该是某个更大领域的子领域，请在 frontmatter 中设置 parent 字段。

只输出这一个文件，用 <<<FILE:路径>>> 格式。` },
    ];

    try {
      let response = '';
      appendChat('ai', '');
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
        for (const f of files) wiki.writeFile(f.path, f.content);
        totalFiles += files.length;
      }
    } catch (err) {
      appendChat('system', `  ⚠ 领域 ${domain} 处理失败: ${err.message}`);
    }
  }

  appendChat('system', `  📋 生成 index.md 和 overview.md...`);
  screen.render();

  const domainFilesList = wiki.listWikiFiles().filter(f => f.category === 'domains' && f.name !== '_meta.json');
  const domainList = domainFilesList.map(f => {
    const content = wiki.readFile(f.path);
    const fmMatch = content ? content.match(/^---\n([\s\S]*?)\n---/) : null;
    const fm = fmMatch ? fmMatch[1] : '';
    return `- ${f.path}: ${fm.replace(/\n/g, ' | ')}`;
  }).join('\n');

  const finalMessages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    {
      role: 'user', content: `请根据以下领域索引页信息，生成 wiki/index.md 和 wiki/overview.md。

当前所有领域索引页：
${domainList}

统计：共 ${contentFiles.length} 个内容页面，${domainNames.length} 个领域。

要求：
1. wiki/index.md 只列顶层领域（没有 parent 的领域）目录和统计数字
2. wiki/overview.md 概述整个知识库的内容全貌

两个文件都必须输出，用 <<<FILE:路径>>> 格式。` },
  ];

  try {
    let response = '';
    appendChat('ai', '');
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
      for (const f of files) wiki.writeFile(f.path, f.content);
      totalFiles += files.length;
    }
  } catch (err) {
    appendChat('system', `  ⚠ index/overview 生成失败: ${err.message}`);
  }

  appendChat('system', `✓ 索引重建完成，共更新 ${totalFiles} 个文件`);
  updateStatus(getDefaultStatus());
}

async function handleForceIngest(text) {
  const args = text.replace('/ingest!', '').trim();
  const brief = args.includes('--brief');
  const targetName = args.replace('--brief', '').trim();
  if (!targetName) {
    appendChat('system', '用法: /ingest! <文件名> [--brief] - 强制重新摄入指定文件');
    return;
  }
  const rawFiles = wiki.listRawFiles();
  const target = rawFiles.find(f => f.name === targetName);
  if (!target) {
    appendChat('system', `raw/ 目录中找不到文件: ${targetName}`);
    return;
  }
  updateStatus(' ⏳ 强制摄入中...');
  appendChat('system', `⏳ 强制摄入${brief ? '(精简)' : ''}: ${targetName}...`);
  screen.render();
  await autoIngestFile(targetName, 0, [], { brief }, getContext());
  wiki.markFilesAsProcessed([target.path]);
}

async function handleIngest(text) {
  const args = text.replace('/ingest', '').trim();
  const brief = args.includes('--brief');
  const targetName = args.replace('--brief', '').trim();
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
    appendChat('system', `⏳ 开始摄入${brief ? '(精简)' : ''}: ${targetName}...`);
    screen.render();
    await autoIngestFile(targetName, 0, [], { brief }, getContext());
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
    await autoIngestFile(f.name, 0, [], {}, getContext());
    wiki.markFilesAsProcessed([f.path]);
    const progress = getIngestProgress(f.name);
    if (progress && progress.paused) {
      appendChat('system', `${f.name} 摄入暂停，继续处理下一个文件...`);
    }
  }
  updateStatus(getDefaultStatus());
}

async function handleRetry(text) {
  const targetFile = text.replace('/retry', '').trim();
  const allProgress = getIngestProgress();
  if (!allProgress || Object.keys(allProgress).length === 0) {
    appendChat('system', '没有需要恢复的摄入任务');
    return;
  }

  if (!targetFile) {
    const files = Object.keys(allProgress);
    if (files.length === 1) {
      const fileName = files[0];
      const progress = allProgress[fileName];
      updateStatus(' ⏳ 重试摄入中...');
      screen.render();
      if (progress.failedSegments && progress.failedSegments.length > 0 && progress.completedSegments >= progress.totalSegments) {
        appendChat('system', `重试 ${fileName} 的 ${progress.failedSegments.length} 个失败段落`);
        const failedList = [...progress.failedSegments];
        clearIngestProgress(fileName);
        for (const segIdx of failedList) {
          await autoIngestFile(fileName, segIdx, [], {}, getContext());
          const p = getIngestProgress(fileName);
          if (p && p.paused) return;
        }
        clearIngestProgress(fileName);
        appendChat('system', '✓ 所有失败段落重试完成');
      } else if (progress.paused && progress.pausedAt !== null) {
        appendChat('system', `重试 ${fileName} 第 ${progress.pausedAt + 1}/${progress.totalSegments} 段...`);
        const failedSegments = (progress.failedSegments || []).filter(s => s !== progress.pausedAt);
        saveIngestProgress(fileName, progress.pausedAt, progress.totalSegments, { failedSegments });
        await autoIngestFile(fileName, progress.pausedAt, failedSegments, {}, getContext());
      } else {
        appendChat('system', `恢复摄入: ${fileName}（从第 ${progress.completedSegments + 1}/${progress.totalSegments} 段继续）`);
        await autoIngestFile(fileName, progress.completedSegments, progress.failedSegments || [], {}, getContext());
      }
    } else {
      appendChat('system', `有 ${files.length} 个文件有未完成的摄入任务：`);
      for (const f of files) {
        const p = allProgress[f];
        const status = p.paused ? '暂停' : `${p.completedSegments}/${p.totalSegments}`;
        appendChat('system', `  - ${f} (${status})`);
      }
      appendChat('system', '请指定文件: /retry <文件名>');
    }
    return;
  }

  const progress = allProgress[targetFile];
  if (!progress) {
    appendChat('system', `没有找到 ${targetFile} 的摄入进度`);
    return;
  }
  updateStatus(' ⏳ 重试摄入中...');
  screen.render();
  if (progress.failedSegments && progress.failedSegments.length > 0 && progress.completedSegments >= progress.totalSegments) {
    appendChat('system', `重试 ${targetFile} 的 ${progress.failedSegments.length} 个失败段落`);
    const failedList = [...progress.failedSegments];
    clearIngestProgress(targetFile);
    for (const segIdx of failedList) {
      await autoIngestFile(targetFile, segIdx, [], {}, getContext());
      const p = getIngestProgress(targetFile);
      if (p && p.paused) return;
    }
    clearIngestProgress(targetFile);
    appendChat('system', '✓ 所有失败段落重试完成');
  } else if (progress.paused && progress.pausedAt !== null) {
    appendChat('system', `重试 ${targetFile} 第 ${progress.pausedAt + 1}/${progress.totalSegments} 段...`);
    const failedSegments = (progress.failedSegments || []).filter(s => s !== progress.pausedAt);
    saveIngestProgress(targetFile, progress.pausedAt, progress.totalSegments, { failedSegments });
    await autoIngestFile(targetFile, progress.pausedAt, failedSegments, {}, getContext());
  } else {
    appendChat('system', `恢复摄入: ${targetFile}（从第 ${progress.completedSegments + 1}/${progress.totalSegments} 段继续）`);
    await autoIngestFile(targetFile, progress.completedSegments, progress.failedSegments || [], {}, getContext());
  }
}

async function handleContinue(text) {
  const targetFile = text.replace('/continue', '').trim();
  const allProgress = getIngestProgress();
  if (!allProgress) {
    appendChat('system', '当前没有暂停的摄入任务');
    return;
  }

  let fileName = targetFile;
  if (!fileName) {
    const pausedFiles = Object.entries(allProgress).filter(([, p]) => p.paused);
    if (pausedFiles.length === 0) {
      appendChat('system', '当前没有暂停的摄入任务');
      return;
    }
    if (pausedFiles.length === 1) {
      fileName = pausedFiles[0][0];
    } else {
      appendChat('system', `有 ${pausedFiles.length} 个文件暂停中：`);
      for (const [f, p] of pausedFiles) {
        appendChat('system', `  - ${f} (第${p.pausedAt + 1}段失败)`);
      }
      appendChat('system', '请指定文件: /continue <文件名>');
      return;
    }
  }

  const progress = allProgress[fileName];
  if (!progress || !progress.paused) {
    appendChat('system', `${fileName} 没有暂停的摄入任务`);
    return;
  }
  appendChat('system', `跳过 ${fileName} 第 ${progress.pausedAt + 1} 段，继续后续段落...`);
  updateStatus(' ⏳ 继续摄入中...');
  screen.render();
  const nextSegment = progress.pausedAt + 1;
  const failedSegments = progress.failedSegments || [];
  saveIngestProgress(fileName, nextSegment, progress.totalSegments, { failedSegments });
  await autoIngestFile(fileName, nextSegment, failedSegments, {}, getContext());
}

async function handleLearn(text) {
  const content = text.replace('/learn', '').trim();
  if (!content) {
    showLearnEditor();
    return;
  }

  await doLearn(content);
}

function showLearnEditor() {
  appendChat('system', '📝 进入多行输入模式（Escape 提交，Ctrl+C 取消）');
  screen.render();

  const editor = blessed.textarea({
    parent: screen,
    label: ' 📝 录入知识 (Escape提交 | Ctrl+C取消) ',
    top: 'center',
    left: 'center',
    width: '80%',
    height: '60%',
    border: { type: 'line' },
    style: {
      border: { fg: 'green' },
      label: { fg: 'green' },
      fg: 'white',
    },
    keys: true,
    mouse: true,
    inputOnFocus: true,
  });

  editor.key(['escape'], () => {
    const value = editor.getValue().trim();
    editor.destroy();
    screen.render();
    if (value) {
      doLearn(value);
    } else {
      appendChat('system', '已取消录入');
    }
  });

  editor.key(['C-c'], () => {
    editor.destroy();
    screen.render();
    appendChat('system', '已取消录入');
    inputBox.readInput();
  });

  editor.focus();
  screen.render();
}

async function doLearn(content) {

  appendChat('system', '💡 正在录入新知识...');
  updateStatus(' ⏳ 录入知识中...');
  screen.render();

  const messages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    {
      role: 'user', content: `用户通过对话方式提供了以下知识，请将其保存到 Wiki 中：

${content}

请：
1. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面
2. 提取其中的实体，为每个实体创建 wiki/entities/ 页面
3. 识别或创建领域（在 frontmatter 的 domains 字段中标注）
4. 在 sources 字段标注来源为 "用户录入"
5. 如果内容涉及已有页面，输出更新后的完整页面

每个文件用 <<<FILE:路径>>> 格式输出。不需要输出 index.md 和领域索引页。
如果内容过于简短或不适合保存，请说明原因。` },
  ];

  try {
    let response = '';
    appendChat('ai', '');
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
      for (const f of files) wiki.writeFile(f.path, f.content);
      appendChat('system', `✓ 已保存 ${files.length} 个页面到知识库`);

      const indexMessages = [
        { role: 'system', content: wiki.getSystemPrompt() },
        { role: 'user', content: `本轮录入了以下新页面：\n${files.map(f => `- ${f.path}`).join('\n')}\n\n请更新相关的领域索引页（wiki/domains/）和 wiki/index.md（只列顶层领域目录和统计数字）。\n如果涉及的领域索引页不存在，请创建它。\n只输出需要更新的文件，用 <<<FILE:路径>>> 格式。` },
      ];
      let indexResponse = '';
      await llm.chatStream(indexMessages, (chunk) => { indexResponse += chunk; });
      const indexFiles = parseFileOutputs(indexResponse);
      if (indexFiles.length > 0) {
        for (const f of indexFiles) wiki.writeFile(f.path, f.content);
      }
    }
  } catch (err) {
    appendChat('system', `录入失败: ${err.message}`);
  }

  updateStatus(getDefaultStatus());
}

inputBox.key('enter', async () => {
  const text = inputBox.getValue();
  inputBox.clearValue();
  screen.render();
  if (text.trim()) {
    ui.inputHistory.unshift(text);
    if (ui.inputHistory.length > 50) ui.inputHistory.pop();
    ui.historyIndex = -1;
  }
  await handleUserInput(text);
  inputBox.readInput();
});

appendChat('system', `欢迎使用 LLM Wiki! 当前模型: ${llm.getProviderName()}`);
appendChat('system', '命令: /import 导入文件 | /url 抓取网页 | /model 切换模型 | /help 帮助');
const pendingProgress = getIngestProgress();
if (pendingProgress && Object.keys(pendingProgress).length > 0) {
  const files = Object.entries(pendingProgress);
  appendChat('system', `⚠ 有 ${files.length} 个未完成的摄入任务：`);
  for (const [f, p] of files) {
    if (p.paused) {
      appendChat('system', `  - ${f}（第${p.pausedAt + 1}/${p.totalSegments}段暂停）`);
    } else if (p.failedSegments && p.failedSegments.length > 0 && p.completedSegments >= p.totalSegments) {
      appendChat('system', `  - ${f}（${p.failedSegments.length}段失败待重试）`);
    } else {
      appendChat('system', `  - ${f}（${p.completedSegments}/${p.totalSegments}段已完成）`);
    }
  }
  appendChat('system', '  /retry [文件名] 恢复 | /continue [文件名] 跳过');
}
inputBox.readInput();
screen.render();