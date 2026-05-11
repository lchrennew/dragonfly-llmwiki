import fs from 'fs';
import path from 'path';
import * as wiki from './wiki-ops.js';
import { saveIngestProgress, getIngestProgress, clearIngestProgress } from './config.js';

export function splitBySentences(text, targetSize = 3000) {
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

export function parseFileOutputs(response) {
  const regex = /<<<FILE:(.*?)>>>\n([\s\S]*?)<<<END>>>/g;
  let match;
  const files = [];
  while ((match = regex.exec(response)) !== null) {
    files.push({ path: match[1].trim(), content: match[2] });
  }
  return files;
}

export async function autoIngestFile(fileName, startFromSegment = 0, skipSegments = [], opts = {}, ctx) {
  const { llm, appendChat, updateStatus, getDefaultStatus } = ctx;
  const updateLastChat = ctx.updateLastChat || ((role, text) => {
    if (ctx.chatMessages && ctx.chatBox) {
      ctx.chatMessages[ctx.chatMessages.length - 1] = `{yellow-fg}AI:{/yellow-fg} ${text}`;
      ctx.chatBox.setContent(ctx.chatMessages.join('\n'));
      ctx.chatBox.setScrollPerc(100);
      if (ctx.screen) ctx.screen.render();
    }
  });

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

      let totalFiles = 0;
      const failedSegments = [...skipSegments];

      for (let i = startFromSegment; i < totalSegments; i++) {
        if (skipSegments.includes(i)) {
          appendChat('system', `  ⏭ 跳过第 ${i + 1} 段（之前已失败，稍后统一重试）`);
          continue;
        }

        appendChat('system', `  📖 阅读第 ${i + 1}/${totalSegments} 段...`);

        const isFirst = i === 0;
        const isLast = i === totalSegments - 1;
        const brief = opts.brief;

        const instruction = buildSegmentInstruction(fileName, segments[i], i, totalSegments, isFirst, isLast, brief);

        const messages = [
          { role: 'system', content: wiki.getSystemPrompt() },
          { role: 'user', content: instruction },
        ];

        let success = false;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            appendChat('system', `  🔄 第 ${i + 1} 段重试（第 ${attempt} 次）...`);
          }
          try {
            let response = '';
            await llm.chatStream(messages, (chunk) => {
              response += chunk;
              const displayText = response.replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]');
              updateLastChat('ai', displayText);
            });

            const files = parseFileOutputs(response);
            if (files.length > 0) {
              for (const file of files) wiki.writeFile(file.path, file.content);
              totalFiles += files.length;
              appendChat('system', `  ✓ 第 ${i + 1} 段处理完成，更新了 ${files.length} 个文件`);

              const newConcepts = files.filter(f => f.path.includes('concepts/') || f.path.includes('entities/'));
              if (newConcepts.length > 0) {
                await updateDomainIndex(newConcepts, fileName, isLast, ctx);
              }
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
        clearIngestProgress(fileName);
        appendChat('system', `✓ 增量摄入完成，共更新 ${totalFiles} 个 Wiki 文件`);
      }

    } else {
      await ingestShortFile(fileName, content, MAX_RETRIES, ctx);
    }

    updateStatus(getDefaultStatus());

  } catch (err) {
    appendChat('system', `摄入失败: ${err.message}`);
    updateStatus(getDefaultStatus());
  }
}

function buildSegmentInstruction(fileName, segment, index, totalSegments, isFirst, isLast, brief) {
  const extractRules = brief
    ? `请基于这段内容，精简提取：
1. 只提取最核心的概念和实体（每段最多3-5个），忽略次要细节
2. 概念页面只写简短定义（2-3句话），不需要展开分析
3. 相关的小概念可以合并为一个页面
4. 重点关注：核心人物、关键事件、重要主题`
    : `请基于这段内容：
1. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面
2. 提取其中的实体，为每个实体创建 wiki/entities/ 页面
3. 识别或创建领域（在 frontmatter 的 domains 字段中标注）`;

  if (isFirst) {
    return `你正在逐段阅读文档"${fileName}"（共${totalSegments}段），像做读书笔记一样边读边记录。随着阅读推进，知识结构会逐渐演变。

这是第 1 段：

${segment}

${brief ? extractRules : `请基于这段内容：
1. 在 wiki/sources/ 创建来源摘要页面（先写已读到的部分，后续段落会补充）
2. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面
3. 提取其中的实体，为每个实体创建 wiki/entities/ 页面
4. 识别或创建领域（在 frontmatter 的 domains 字段中标注）`}

每个文件用 <<<FILE:路径>>> 格式输出。不需要输出 index.md 和领域索引页（系统会自动更新）。`;
  }

  if (isLast) {
    return `继续阅读文档"${fileName}"，这是最后一段（第 ${index + 1}/${totalSegments} 段）：

${segment}

${brief ? extractRules + '\n5. 更新 wiki/overview.md\n6. 追加 wiki/log.md 操作记录' : `请基于这段内容：
1. 补充/更新 wiki/sources/ 来源摘要页面（完整版）
2. 提取新概念，创建新的 wiki/concepts/ 页面；如果已有概念需要补充，输出更新后的完整页面
3. 提取新实体，创建新的 wiki/entities/ 页面；如果已有实体需要补充，输出更新后的完整页面
4. 更新 wiki/overview.md
5. 追加 wiki/log.md 操作记录`}

每个文件用 <<<FILE:路径>>> 格式输出。不需要输出 index.md 和领域索引页（系统会自动更新）。`;
  }

  return `继续阅读文档"${fileName}"，这是第 ${index + 1}/${totalSegments} 段：

${segment}

${brief ? extractRules : `请基于这段内容：
1. 如果来源摘要需要补充，输出更新后的 wiki/sources/ 页面
2. 提取新概念，创建新的 wiki/concepts/ 页面；如果已有概念需要补充，输出更新后的完整页面
3. 提取新实体，创建新的 wiki/entities/ 页面；如果已有实体需要补充，输出更新后的完整页面`}

每个文件用 <<<FILE:路径>>> 格式输出。不需要输出 index.md 和领域索引页（系统会自动更新）。
如果这段没有新的概念或实体需要记录，可以只输出简短说明。`;
}

async function updateDomainIndex(newConcepts, fileName, isLast, ctx) {
  const { llm } = ctx;
  const indexMessages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    { role: 'user', content: `本轮摄入了以下新页面：\n${newConcepts.map(f => `- ${f.path}`).join('\n')}\n\n请更新相关的领域索引页（wiki/domains/）和 wiki/index.md（只列顶层领域目录和统计数字）。\n如果涉及的领域索引页不存在，请创建它。\n只输出需要更新的文件，用 <<<FILE:路径>>> 格式。` },
  ];
  try {
    let indexResponse = '';
    await llm.chatStream(indexMessages, (chunk) => { indexResponse += chunk; });
    const indexFiles = parseFileOutputs(indexResponse);
    if (indexFiles.length > 0) {
      for (const f of indexFiles) wiki.writeFile(f.path, f.content);
    }
  } catch { }

  if (isLast) {
    const overviewMessages = [
      { role: 'system', content: wiki.getSystemPrompt() },
      { role: 'user', content: `文档"${fileName}"摄入完成。请根据当前知识库状态更新 wiki/overview.md，概述整个知识库的内容全貌。只输出 wiki/overview.md，用 <<<FILE:路径>>> 格式。` },
    ];
    try {
      let ovResponse = '';
      await llm.chatStream(overviewMessages, (chunk) => { ovResponse += chunk; });
      const ovFiles = parseFileOutputs(ovResponse);
      if (ovFiles.length > 0) {
        for (const f of ovFiles) wiki.writeFile(f.path, f.content);
      }
    } catch { }
  }
}

async function ingestShortFile(fileName, content, MAX_RETRIES, ctx) {
  const { llm, appendChat, updateStatus, getDefaultStatus } = ctx;
  const updateLastChat = ctx.updateLastChat || ((role, text) => {
    if (ctx.chatMessages && ctx.chatBox) {
      ctx.chatMessages[ctx.chatMessages.length - 1] = `{yellow-fg}AI:{/yellow-fg} ${text}`;
      ctx.chatBox.setContent(ctx.chatMessages.join('\n'));
      ctx.chatBox.setScrollPerc(100);
      if (ctx.screen) ctx.screen.render();
    }
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      appendChat('system', `🔄 重试摄入（第 ${attempt} 次）...`);
    }
    try {
      const messages = [
        { role: 'system', content: wiki.getSystemPrompt() },
        { role: 'user', content: `请执行摄入操作。以下是需要处理的原始资料：\n\n--- 原始资料: ${fileName} ---\n${content}\n\n请严格按照工作流完成所有步骤：创建来源摘要、更新实体/概念页面、更新领域索引页、更新 index.md（只列领域目录）、更新 overview.md、追加 log.md。每个需要创建或修改的文件都必须用 <<<FILE:路径>>> 格式输出。请确保完整摘要文档内容，不要遗漏重要信息。` },
      ];

      let response = '';
      await llm.chatStream(messages, (chunk) => {
        response += chunk;
        const displayText = response.replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]');
        updateLastChat('ai', displayText);
      });

      const files = parseFileOutputs(response);
      if (files.length > 0) {
        for (const file of files) wiki.writeFile(file.path, file.content);
        appendChat('system', `✓ 摄入完成，已更新 ${files.length} 个 Wiki 文件`);
      }
      appendChat('ai', '');
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