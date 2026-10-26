/* 模型提供方配置与协议适配（v1.9.8）
   纯逻辑模块，不依赖 DOM；浏览器挂到 window.AIProviders，Node 测试用 require。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIProviders = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PROTOCOLS = [
    { id: 'openai', name: 'OpenAI Chat Completions（兼容多数服务）' },
    { id: 'anthropic', name: 'Anthropic Messages（Claude）' }
  ];

  var PRESETS = [
    {
      id: 'zhipu', name: '智谱 BigModel', protocol: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      textModels: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
      visionModels: ['glm-4v-flash', 'glm-4v-plus'],
      requiresKey: true,
      hint: '在 open.bigmodel.cn 控制台创建 API Key；glm-4-flash / glm-4v-flash 有免费额度。'
    },
    {
      id: 'openai', name: 'OpenAI', protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      textModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
      visionModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
      requiresKey: true,
      hint: '在 platform.openai.com 创建 API Key；模型名可自行填写。'
    },
    {
      id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      textModels: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
      visionModels: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
      requiresKey: true,
      hint: '在 console.anthropic.com 创建 API Key；使用 Anthropic Messages 协议。'
    },
    {
      id: 'gemini', name: 'Google Gemini', protocol: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      textModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      visionModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      requiresKey: true,
      hint: '在 aistudio.google.com/apikey 创建 Key；走 Gemini 的 OpenAI 兼容端点。'
    },
    {
      id: 'deepseek', name: 'DeepSeek', protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      textModels: ['deepseek-chat', 'deepseek-reasoner'],
      visionModels: [],
      requiresKey: true,
      hint: '在 platform.deepseek.com 创建 API Key；DeepSeek 当前以文本模型为主。'
    },
    {
      id: 'moonshot', name: 'Moonshot Kimi', protocol: 'openai',
      baseUrl: 'https://api.moonshot.cn/v1',
      textModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'],
      visionModels: ['moonshot-v1-8k-vision-preview'],
      requiresKey: true,
      hint: '在 platform.moonshot.cn 创建 API Key；视觉模型按账号可用性填写。'
    },
    {
      id: 'qwen', name: '阿里云百炼 Qwen', protocol: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      textModels: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
      visionModels: ['qwen-vl-plus', 'qwen-vl-max'],
      requiresKey: true,
      hint: '在阿里云百炼控制台创建 API Key；使用 OpenAI 兼容模式端点。'
    },
    {
      id: 'doubao', name: '火山方舟 Doubao', protocol: 'openai',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      textModels: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115'],
      visionModels: ['doubao-1-5-vision-pro-32k-250115'],
      requiresKey: true,
      hint: '在火山方舟控制台创建 API Key；模型名通常需要填推理接入点 ID，可直接改写。'
    },
    {
      id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1',
      textModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
      visionModels: ['Qwen/Qwen2-VL-72B-Instruct'],
      requiresKey: true,
      hint: '在 cloud.siliconflow.cn 创建 API Key；模型名按平台列表填写。'
    },
    {
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      textModels: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
      visionModels: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
      requiresKey: true,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/juju080112/schedule-assistant',
        'X-Title': 'Schedule Assistant'
      },
      hint: '在 openrouter.ai/keys 创建 Key；可统一访问多家模型。'
    },
    {
      id: 'ollama', name: 'Ollama（本地）', protocol: 'openai',
      baseUrl: 'http://10.0.2.2:11434/v1',
      textModels: ['llama3.2', 'qwen2.5'],
      visionModels: ['llava'],
      requiresKey: false, local: true,
      hint: '模拟器用 10.0.2.2；真机填电脑局域网 IP（如 http://192.168.1.10:11434/v1）。Android 可能拦截 HTTP 明文，见 README。'
    },
    {
      id: 'lmstudio', name: 'LM Studio（本地）', protocol: 'openai',
      baseUrl: 'http://10.0.2.2:1234/v1',
      textModels: ['local-model'],
      visionModels: [],
      requiresKey: false, local: true,
      hint: 'LM Studio 开启本地服务器后使用；模拟器用 10.0.2.2，真机填电脑局域网 IP。'
    },
    {
      id: 'custom', name: '自定义（OpenAI 兼容 / Anthropic）', protocol: 'openai',
      baseUrl: '', textModels: [], visionModels: [], requiresKey: false,
      hint: '填任意兼容服务的 Base URL（到 /v1 或 /v1beta 一级），模型名可直接输入；协议按服务选择。'
    }
  ];

  var PRESET_MAP = {};
  PRESETS.forEach(function (p) { PRESET_MAP[p.id] = p; });

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function emptyProvider(preset) {
    return {
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      apiKey: '',
      textModel: (preset.textModels || [])[0] || '',
      visionModel: (preset.visionModels || [])[0] || '',
      headers: Object.assign({}, preset.defaultHeaders || {})
    };
  }

  function defaultConfig() {
    var providers = {};
    PRESETS.forEach(function (p) { providers[p.id] = emptyProvider(p); });
    return { active: 'zhipu', providers: providers };
  }

  function pickString(v, fallback) {
    return typeof v === 'string' ? v : fallback;
  }

  function normalizeConfig(raw, legacy) {
    var cfg = defaultConfig();
    if (raw && typeof raw === 'object' && raw.providers && typeof raw.providers === 'object') {
      PRESETS.forEach(function (preset) {
        var p = raw.providers[preset.id];
        if (!p || typeof p !== 'object') return;
        var target = cfg.providers[preset.id];
        var proto = p.protocol === 'anthropic' ? 'anthropic' : (p.protocol === 'openai' ? 'openai' : target.protocol);
        target.protocol = proto;
        target.baseUrl = pickString(p.baseUrl, target.baseUrl);
        target.apiKey = pickString(p.apiKey, target.apiKey);
        target.textModel = pickString(p.textModel, target.textModel);
        target.visionModel = pickString(p.visionModel, target.visionModel);
        if (p.headers && typeof p.headers === 'object' && !Array.isArray(p.headers)) {
          var headers = {};
          Object.keys(p.headers).forEach(function (k) { headers[k] = String(p.headers[k]); });
          target.headers = headers;
        }
      });
      if (raw.active && cfg.providers[raw.active]) cfg.active = raw.active;
    } else if (legacy && typeof legacy === 'object' &&
               (legacy.apiKey || legacy.textModel || legacy.visionModel)) {
      cfg.providers.zhipu.apiKey = legacy.apiKey || '';
      if (legacy.textModel) cfg.providers.zhipu.textModel = legacy.textModel;
      if (legacy.visionModel) cfg.providers.zhipu.visionModel = legacy.visionModel;
      cfg.active = 'zhipu';
    }
    return cfg;
  }

  function getProvider(cfg, id) {
    var key = id || (cfg && cfg.active) || 'zhipu';
    var preset = PRESET_MAP[key] || PRESET_MAP.custom;
    var stored = (cfg && cfg.providers && cfg.providers[key]) || {};
    var has = function (k) { return Object.prototype.hasOwnProperty.call(stored, k); };
    var headers = Object.assign({}, preset.defaultHeaders || {}, stored.headers || {});
    return {
      id: key,
      name: preset.name,
      protocol: stored.protocol === 'anthropic' ? 'anthropic' : (stored.protocol === 'openai' ? 'openai' : preset.protocol),
      baseUrl: has('baseUrl') ? stored.baseUrl : preset.baseUrl,
      apiKey: has('apiKey') ? stored.apiKey : '',
      textModel: has('textModel') ? stored.textModel : ((preset.textModels || [])[0] || ''),
      visionModel: has('visionModel') ? stored.visionModel : ((preset.visionModels || [])[0] || ''),
      headers: headers,
      textModels: (preset.textModels || []).slice(),
      visionModels: (preset.visionModels || []).slice(),
      requiresKey: preset.requiresKey !== false,
      local: !!preset.local,
      hint: preset.hint || ''
    };
  }

  function endpointFor(provider, protocol) {
    var base = String(provider && provider.baseUrl != null ? provider.baseUrl : '').trim();
    if (!base) throw new Error('请填写接口地址（Base URL）');
    var proto = protocol || (provider && provider.protocol) || 'openai';
    var suffix = proto === 'anthropic' ? '/messages' : '/chat/completions';
    var other = proto === 'anthropic' ? '/chat/completions' : '/messages';
    var q = base.indexOf('?');
    var path = q >= 0 ? base.slice(0, q) : base;
    var query = q >= 0 ? base.slice(q) : '';
    path = path.replace(/\/+$/, '');
    if (path.slice(-suffix.length) === suffix) return path + query;
    if (path.slice(-other.length) === other) path = path.slice(0, -other.length);
    return path + suffix + query;
  }

  function buildHeaders(provider) {
    var h = { 'Content-Type': 'application/json' };
    if (provider.protocol === 'anthropic') {
      if (provider.apiKey) h['x-api-key'] = provider.apiKey;
      h['anthropic-version'] = '2023-06-01';
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (provider.apiKey) {
      h['Authorization'] = 'Bearer ' + provider.apiKey;
    }
    Object.assign(h, provider.headers || {});
    return h;
  }

  function imagePartToAnthropic(part) {
    if (!part) return null;
    var url = part.image_url && part.image_url.url ? part.image_url.url :
      (typeof part.image_url === 'string' ? part.image_url : '');
    if (!url) return null;
    var m = /^data:([^;]+);base64,([\s\S]+)$/.exec(url);
    if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url: url } };
    return null;
  }

  function contentToAnthropic(content) {
    if (content == null) return [];
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (!Array.isArray(content)) return [{ type: 'text', text: JSON.stringify(content) }];
    var out = [];
    content.forEach(function (part) {
      if (!part || !part.type) return;
      if (part.type === 'text') out.push({ type: 'text', text: String(part.text == null ? '' : part.text) });
      else if (part.type === 'image_url') {
        var img = imagePartToAnthropic(part);
        if (img) out.push(img);
      }
    });
    return out;
  }

  function toAnthropicMessages(messages) {
    var system = [];
    var out = [];
    var toolResults = [];
    function flushTools() {
      if (!toolResults.length) return;
      out.push({ role: 'user', content: toolResults });
      toolResults = [];
    }
    (messages || []).forEach(function (m) {
      if (!m || !m.role) return;
      if (m.role === 'system') {
        if (m.content != null) system.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
        return;
      }
      if (m.role === 'tool') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: m.tool_call_id || m.tool_use_id || '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content == null ? '' : m.content)
        });
        return;
      }
      flushTools();
      if (m.role === 'assistant') {
        var blocks = [];
        if (m.content != null && m.content !== '') blocks = blocks.concat(contentToAnthropic(m.content));
        if (Array.isArray(m.tool_calls)) {
          m.tool_calls.forEach(function (tc) {
            if (!tc) return;
            var fn = tc.function || {};
            var input = {};
            try { input = JSON.parse(fn.arguments || '{}'); } catch (e) { input = { _raw: String(fn.arguments || '') }; }
            blocks.push({ type: 'tool_use', id: tc.id || '', name: fn.name || '', input: input });
          });
        }
        if (blocks.length) out.push({ role: 'assistant', content: blocks });
        return;
      }
      if (m.role === 'user') {
        out.push({ role: 'user', content: contentToAnthropic(m.content) });
      }
    });
    flushTools();
    return { system: system.join('\n\n'), messages: out };
  }

  function toOpenAIMessages(messages) {
    return (messages || []).map(function (m) {
      if (!m || !m.role) return m;
      var out = { role: m.role };
      if (m.content !== undefined) out.content = m.content;
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name) out.name = m.name;
      return out;
    });
  }

  function supportsTemperature(model) {
    return !/^(o\d|gpt-5)/i.test(String(model || ''));
  }

  function toolsForAnthropic(tools) {
    return (tools || []).map(function (t) {
      var fn = t && t.function ? t.function : t;
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} }
      };
    });
  }

  function buildRequest(provider, opts) {
    opts = opts || {};
    var proto = provider.protocol === 'anthropic' ? 'anthropic' : 'openai';
    var model = opts.model;
    if (model == null || model === '') {
      model = opts.vision ? provider.visionModel : provider.textModel;
    }
    if (!model) throw new Error(opts.vision ? '尚未配置图片理解模型' : '尚未配置文本模型');
    var url = endpointFor(provider, proto);
    var headers = buildHeaders(provider);
    var body;
    if (proto === 'anthropic') {
      var conv = toAnthropicMessages(opts.messages);
      body = {
        model: model,
        max_tokens: opts.maxTokens || 4096,
        temperature: opts.temperature == null ? 0.3 : opts.temperature,
        messages: conv.messages
      };
      if (conv.system) body.system = conv.system;
      if (opts.tools && opts.tools.length) body.tools = toolsForAnthropic(opts.tools);
    } else {
      body = {
        model: model,
        messages: toOpenAIMessages(opts.messages)
      };
      /* o 系列 / gpt-5 不支持自定义 temperature，带上会直接 400 */
      if (supportsTemperature(model)) {
        body.temperature = opts.temperature == null ? 0.3 : opts.temperature;
      }
      if (opts.tools && opts.tools.length) {
        body.tools = opts.tools;
        body.tool_choice = 'auto';
      }
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    }
    return { url: url, headers: headers, body: body, protocol: proto };
  }

  function normalizeOpenAITool(tc, idx) {
    if (!tc) return null;
    if (tc.function) {
      var args = tc.function.arguments;
      return {
        id: tc.id || ('call_' + idx),
        type: 'function',
        function: { name: tc.function.name || '', arguments: typeof args === 'string' ? args : JSON.stringify(args || {}) }
      };
    }
    if (tc.name) {
      return {
        id: tc.id || ('call_' + idx),
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) }
      };
    }
    return null;
  }

  function parseResponse(provider, data) {
    if (provider.protocol === 'anthropic') {
      var text = [];
      var calls = [];
      var blocks = data && data.content;
      if (typeof blocks === 'string') text.push(blocks);
      else if (Array.isArray(blocks)) {
        blocks.forEach(function (b) {
          if (!b) return;
          if (b.type === 'text') text.push(b.text || '');
          else if (b.type === 'tool_use') {
            calls.push({
              id: b.id || '',
              type: 'function',
              function: { name: b.name || '', arguments: JSON.stringify(b.input || {}) }
            });
          }
        });
      }
      return { content: text.join(''), toolCalls: calls, raw: data };
    }
    var msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return { content: '', toolCalls: [], raw: data };
    var content = msg.content;
    if (Array.isArray(content)) {
      content = content.map(function (p) { return p && p.text ? p.text : ''; }).join('');
    }
    var toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map(normalizeOpenAITool).filter(Boolean) : [];
    if (!toolCalls.length && msg.function_call) {
      toolCalls = [normalizeOpenAITool({ id: 'call_0', function: msg.function_call }, 0)].filter(Boolean);
    }
    return { content: content == null ? '' : content, toolCalls: toolCalls, raw: data };
  }

  function errorMessage(data, status) {
    if (data) {
      if (typeof data.error === 'string') return data.error;
      if (data.error && data.error.message) return data.error.message;
      if (data.message) return data.message;
    }
    return 'HTTP ' + status;
  }

  function providerList() {
    return PRESETS.map(function (p) {
      return {
        id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl,
        textModels: (p.textModels || []).slice(), visionModels: (p.visionModels || []).slice(),
        requiresKey: p.requiresKey !== false, local: !!p.local, hint: p.hint || ''
      };
    });
  }

  return {
    PROTOCOLS: PROTOCOLS,
    PRESETS: PRESETS,
    providerList: providerList,
    defaultConfig: defaultConfig,
    normalizeConfig: normalizeConfig,
    getProvider: getProvider,
    endpointFor: endpointFor,
    buildHeaders: buildHeaders,
    toAnthropicMessages: toAnthropicMessages,
    toOpenAIMessages: toOpenAIMessages,
    buildRequest: buildRequest,
    parseResponse: parseResponse,
    errorMessage: errorMessage,
    clone: clone
  };
});
