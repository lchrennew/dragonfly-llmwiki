import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    apiKey: () => process.env.OPENAI_API_KEY,
    baseURL: () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o',
  },
  deepseek: {
    name: 'DeepSeek',
    apiKey: () => process.env.DEEPSEEK_API_KEY,
    baseURL: () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: () => process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
  qwen: {
    name: '通义千问',
    apiKey: () => process.env.QWEN_API_KEY,
    baseURL: () => process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: () => process.env.QWEN_MODEL || 'qwen-plus',
  },
  ollama: {
    name: 'Ollama',
    apiKey: () => 'ollama',
    baseURL: () => process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    model: () => process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  },
};

export class LLMClient {
  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'deepseek';
    this.client = null;
    this._initClient();
  }

  _initClient() {
    const config = PROVIDERS[this.provider];
    if (!config) {
      throw new Error(`未知的模型提供商: ${this.provider}`);
    }
    this.client = new OpenAI({
      apiKey: config.apiKey(),
      baseURL: config.baseURL(),
    });
    this.model = config.model();
  }

  switchProvider(provider) {
    if (!PROVIDERS[provider]) {
      throw new Error(`未知的模型提供商: ${provider}，可选: ${Object.keys(PROVIDERS).join(', ')}`);
    }
    this.provider = provider;
    this._initClient();
  }

  getProviderName() {
    return PROVIDERS[this.provider].name;
  }

  getProviderList() {
    return Object.entries(PROVIDERS).map(([key, val]) => ({
      key,
      name: val.name,
      active: key === this.provider,
    }));
  }

  async chat(messages, options = {}) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 16384,
      stream: false,
    });
    return response.choices[0].message.content;
  }

  async chatStream(messages, onChunk, options = {}) {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 16384,
      stream: true,
    });
    let fullContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullContent += content;
      if (content) onChunk(content);
    }
    return fullContent;
  }
}

export { PROVIDERS };
