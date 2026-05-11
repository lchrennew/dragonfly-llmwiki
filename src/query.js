import * as wiki from './wiki-ops.js';
import { parseFileOutputs } from './ingest.js';

const MAX_AGENT_ROUNDS = 5;

export async function handleQuery(text, ctx) {
  const { llm, appendChat, updateStatus, chatHistory } = ctx;
  const updateLastChat = ctx.updateLastChat || ((role, text) => {
    if (ctx.chatMessages && ctx.chatBox) {
      ctx.chatMessages[ctx.chatMessages.length - 1] = `{yellow-fg}AI:{/yellow-fg} ${text}`;
      ctx.chatBox.setContent(ctx.chatMessages.join('\n'));
      ctx.chatBox.setScrollPerc(100);
      if (ctx.screen) ctx.screen.render();
    }
  });

  updateStatus(' ⏳ 模型思考中...');
  appendChat('ai', '思考中...');

  try {
    updateStatus(' ⏳ 提取关键词...');
    const keywords = await extractKeywords(text, llm);

    let searchContext = '';
    if (keywords.length > 0) {
      const results = wiki.searchWiki(keywords);
      if (results.length > 0) {
        appendChat('system', `  🔍 搜索到 ${results.length} 个相关页面`);
        for (const r of results) {
          const content = wiki.readFile(r.path);
          if (content) {
            searchContext += `\n\n--- ${r.path} (${r.title || r.path}) ---\n${content}`;
          }
        }
      }
    }

    const queryPrompt = wiki.getSystemPrompt('query');
    let finalResponse;

    if (searchContext) {
      finalResponse = await agentLoopWithContext(text, searchContext, queryPrompt, ctx);
    } else {
      finalResponse = await agentLoopWithoutContext(text, queryPrompt, ctx);
    }

    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: finalResponse });

    const files = parseFileOutputs(finalResponse);
    if (files.length > 0) {
      for (const f of files) wiki.writeFile(f.path, f.content);
      appendChat('system', `✓ 已更新 ${files.length} 个文件`);
    } else if (finalResponse.includes('<<<NEW_KNOWLEDGE>>>')) {
      await saveNewKnowledge(text, finalResponse, ctx);
    }
  } catch (err) {
    appendChat('system', `错误: ${err.message}`);
  }

  updateStatus(ctx.getDefaultStatus());
}

async function extractKeywords(text, llm) {
  const messages = [
    { role: 'system', content: '你是一个关键词提取助手。从用户的问题中提取用于搜索知识库的关键词（概念名、实体名、技术术语等）。只输出 JSON 数组格式的关键词列表，不要输出其他内容。例如：["注意力机制", "transformer", "RLHF"]' },
    { role: 'user', content: text },
  ];

  let response = '';
  await llm.chatStream(messages, (chunk) => { response += chunk; });

  try {
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { }
  return [];
}

async function agentLoopWithContext(text, searchContext, queryPrompt, ctx) {
  const { llm, appendChat, updateStatus, chatHistory } = ctx;
  const updateLastChat = ctx.updateLastChat || (() => { });

  const messages = [
    { role: 'system', content: queryPrompt },
    ...chatHistory.slice(-10),
    { role: 'user', content: `${text}\n\n以下是从知识库中检索到的相关内容：${searchContext}\n\n请基于以上内容回答问题。如果信息不足，可以使用 <<<READ:路径>>> 请求读取更多文件。` },
  ];

  updateStatus(' ⏳ 生成回答...');
  let finalResponse = '';
  let scratchpad = '';
  let round = 0;

  while (round < MAX_AGENT_ROUNDS) {
    round++;
    let response = '';
    await llm.chatStream(messages, (chunk) => {
      response += chunk;
      const displayText = response
        .replace(/<<<READ:.*?>>>/g, '[检索中...]')
        .replace(/<<<NOTE:[\s\S]*?>>>$/g, '')
        .replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]')
        .replace(/<<<NEW_KNOWLEDGE>>>/g, '');
      updateLastChat('ai', displayText);
    });

    const readRequests = extractReadRequests(response);

    if (readRequests.length === 0) {
      finalResponse = response;
      break;
    }

    const noteMatch = response.match(/<<<NOTE:([\s\S]*?)>>>/);
    if (noteMatch) {
      scratchpad += '\n' + noteMatch[1].trim();
    }

    appendChat('system', `  🔍 探索性检索 ${readRequests.length} 个文件...`);

    const fileContents = readFiles(readRequests);

    messages.length = 0;
    messages.push(
      { role: 'system', content: queryPrompt },
      { role: 'user', content: `用户问题：${text}\n\n${scratchpad ? `已知信息（笔记）：\n${scratchpad}\n\n` : ''}以下是本轮读取的文件内容：${fileContents}\n\n请根据以上信息回答问题，或使用 <<<READ:路径>>> 继续检索。如果从文件中发现了有用信息，请用 <<<NOTE:要点>>> 记录关键发现。` }
    );
  }

  return finalResponse;
}

async function agentLoopWithoutContext(text, queryPrompt, ctx) {
  const { llm, appendChat, updateStatus, chatHistory } = ctx;
  const updateLastChat = ctx.updateLastChat || (() => { });

  const messages = [
    { role: 'system', content: queryPrompt },
    ...chatHistory.slice(-10),
    { role: 'user', content: text },
  ];

  updateStatus(' ⏳ 探索性检索...');
  let finalResponse = '';
  let scratchpad = '';
  let round = 0;

  while (round < MAX_AGENT_ROUNDS) {
    round++;
    let response = '';
    await llm.chatStream(messages, (chunk) => {
      response += chunk;
      const displayText = response
        .replace(/<<<READ:.*?>>>/g, '[检索中...]')
        .replace(/<<<NOTE:[\s\S]*?>>>$/g, '')
        .replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]')
        .replace(/<<<NEW_KNOWLEDGE>>>/g, '');
      updateLastChat('ai', displayText);
    });

    const readRequests = extractReadRequests(response);

    if (readRequests.length === 0) {
      finalResponse = response;
      break;
    }

    const noteMatch = response.match(/<<<NOTE:([\s\S]*?)>>>/);
    if (noteMatch) {
      scratchpad += '\n' + noteMatch[1].trim();
    }

    appendChat('system', `  🔍 探索性检索 ${readRequests.length} 个文件 (第${round}轮)...`);

    const fileContents = readFiles(readRequests);

    messages.length = 0;
    messages.push(
      { role: 'system', content: queryPrompt },
      { role: 'user', content: `用户问题：${text}\n\n${scratchpad ? `已知信息（笔记）：\n${scratchpad}\n\n` : ''}以下是本轮读取的文件内容：${fileContents}\n\n请根据以上信息回答问题，或使用 <<<READ:路径>>> 继续检索。如果从文件中发现了有用信息，请用 <<<NOTE:要点>>> 记录关键发现。` }
    );
  }

  return finalResponse;
}

function extractReadRequests(response) {
  const readRegex = /<<<READ:(.*?)>>>/g;
  let match;
  const requests = [];
  while ((match = readRegex.exec(response)) !== null) {
    requests.push(match[1].trim());
  }
  return requests;
}

function readFiles(requests) {
  let fileContents = '';
  for (const filePath of requests) {
    const content = wiki.readFile(filePath);
    if (content) {
      fileContents += `\n\n--- ${filePath} ---\n${content}`;
    } else {
      fileContents += `\n\n--- ${filePath} ---\n[文件不存在]`;
    }
  }
  return fileContents;
}

async function saveNewKnowledge(question, answer, ctx) {
  const { llm, appendChat } = ctx;
  const cleanAnswer = answer.replace(/<<<NEW_KNOWLEDGE>>>/g, '').trim();

  appendChat('system', '  💡 检测到新知识，正在保存到知识库...');

  const messages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    {
      role: 'user', content: `以下是用户提问和 AI 的回答，其中包含知识库中没有的新信息。请将有价值的知识提取并保存到 Wiki 中。

用户问题：${question}

AI 回答：
${cleanAnswer}

请：
1. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面
2. 提取其中的实体，为每个实体创建 wiki/entities/ 页面
3. 识别或创建领域（在 frontmatter 的 domains 字段中标注）
4. 在 sources 字段标注来源为 "AI 回答"

每个文件用 <<<FILE:路径>>> 格式输出。不需要输出 index.md 和领域索引页。
如果回答内容过于简短或不适合保存（如闲聊、确认性回复），可以不输出任何文件。` },
  ];

  try {
    let response = '';
    await llm.chatStream(messages, (chunk) => { response += chunk; });
    const files = parseFileOutputs(response);
    if (files.length > 0) {
      for (const f of files) wiki.writeFile(f.path, f.content);
      appendChat('system', `  ✓ 已将新知识保存到知识库（${files.length} 个页面）`);

      const indexMessages = [
        { role: 'system', content: wiki.getSystemPrompt() },
        { role: 'user', content: `本轮保存了以下新页面：\n${files.map(f => `- ${f.path}`).join('\n')}\n\n请更新相关的领域索引页（wiki/domains/）和 wiki/index.md（只列顶层领域目录和统计数字）。\n如果涉及的领域索引页不存在，请创建它。\n只输出需要更新的文件，用 <<<FILE:路径>>> 格式。` },
      ];
      let indexResponse = '';
      await llm.chatStream(indexMessages, (chunk) => { indexResponse += chunk; });
      const indexFiles = parseFileOutputs(indexResponse);
      if (indexFiles.length > 0) {
        for (const f of indexFiles) wiki.writeFile(f.path, f.content);
      }
    }
  } catch (err) {
    appendChat('system', `  ⚠ 保存新知识失败: ${err.message}`);
  }
}