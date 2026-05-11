import blessed from 'blessed';
import fs from 'fs';
import path from 'path';

const COMMANDS = [
  { cmd: '/import', desc: '导入文件' },
  { cmd: '/ingest', desc: '手工摄入' },
  { cmd: '/ingest!', desc: '强制摄入' },
  { cmd: '/url', desc: '抓取网页' },
  { cmd: '/learn', desc: '录入新知识' },
  { cmd: '/model', desc: '切换模型' },
  { cmd: '/retry', desc: '重试失败段落' },
  { cmd: '/continue', desc: '跳过继续' },
  { cmd: '/reindex', desc: '重建索引' },
  { cmd: '/prune', desc: '清理不可达领域' },
  { cmd: '/lint', desc: '健康检查' },
  { cmd: '/help', desc: '显示帮助' },
  { cmd: '/bye', desc: '退出程序' },
];

export function createUI(llm) {
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
  let hintText = '';
  const inputHistory = [];
  let historyIndex = -1;

  const hintBox = blessed.box({
    parent: inputBox,
    top: 0,
    left: 0,
    height: 1,
    style: { fg: '#666666' },
    content: '',
  });

  function updateHint(input) {
    if (!input || !input.startsWith('/')) {
      hintText = '';
      hintBox.setContent('');
      hintBox.hide();
      screen.render();
      return;
    }
    const matches = COMMANDS.filter(c => c.cmd.startsWith(input) && c.cmd !== input);
    if (matches.length > 0) {
      const first = matches[0];
      const suffix = first.cmd.slice(input.length);
      hintText = suffix;
      hintBox.left = input.length;
      hintBox.setContent(`${suffix}  ${first.desc}`);
      hintBox.show();
    } else {
      hintText = '';
      hintBox.setContent('');
      hintBox.hide();
    }
    screen.render();
  }

  function completeHint() {
    if (!hintText) return false;
    const current = inputBox.getValue();
    inputBox.setValue(current + hintText);
    hintText = '';
    hintBox.setContent('');
    hintBox.hide();
    screen.render();
    return true;
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
    statusBar.setContent(text);
    screen.render();
  }

  function getDefaultStatus() {
    return ` 模型: ${llm.getProviderName()} | 输入 /help 查看命令`;
  }

  inputBox.on('keypress', (ch, key) => {
    if (key.name === 'escape') {
      chatBox.focus();
      screen.render();
      return false;
    }
    if (key.name === 'tab') {
      completeHint();
      process.nextTick(() => {
        const val = inputBox.getValue();
        if (val.includes('\t')) {
          inputBox.setValue(val.replace(/\t/g, ''));
          screen.render();
        }
      });
      return;
    }
    if (key.name === 'up') {
      if (inputHistory.length === 0) return;
      if (historyIndex < inputHistory.length - 1) historyIndex++;
      inputBox.setValue(inputHistory[historyIndex]);
      updateHint(inputHistory[historyIndex]);
      screen.render();
      return false;
    }
    if (key.name === 'down') {
      if (historyIndex > 0) {
        historyIndex--;
        inputBox.setValue(inputHistory[historyIndex]);
        updateHint(inputHistory[historyIndex]);
      } else {
        historyIndex = -1;
        inputBox.setValue('');
        updateHint('');
      }
      screen.render();
      return false;
    }
    process.nextTick(() => {
      updateHint(inputBox.getValue());
    });
  });

  screen.key(['C-c'], () => process.exit(0));

  screen.on('keypress', (ch, key) => {
    if (screen.focused !== inputBox && ch && !key.ctrl && !key.meta && key.name !== 'escape' && key.name !== 'enter' && key.name !== 'return' && key.name !== 'tab') {
      const current = inputBox.getValue();
      inputBox.setValue(current + ch);
      inputBox.focus();
      inputBox.readInput();
      process.nextTick(() => {
        updateHint(inputBox.getValue());
      });
    }
  });

  return {
    screen,
    chatBox,
    inputBox,
    statusBar,
    chatMessages,
    appendChat,
    updateStatus,
    getDefaultStatus,
    inputHistory,
    get historyIndex() { return historyIndex; },
    set historyIndex(v) { historyIndex = v; },
  };
}

export function showFilePicker(screen, startDir, onSelect) {
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
      onSelect(selected, currentDir);
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