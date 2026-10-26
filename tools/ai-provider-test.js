/* AI 提供方适配测试（Node，无网络）
   运行：node tools/ai-provider-test.js */
const assert = require('assert');
const AI = require('../www/js/ai-providers.js');

let total = 0;
const failures = [];
function check(name, fn) {
  total++;
  try {
    fn();
    console.log('✔ ' + name);
  } catch (e) {
    failures.push(name + ' — ' + e.message);
    console.log('✘ ' + name + '  → ' + e.message);
  }
}

check('预设包含主流提供方与自定义', () => {
  const ids = AI.providerList().map((p) => p.id);
  ['zhipu', 'openai', 'anthropic', 'gemini', 'deepseek', 'moonshot', 'qwen', 'doubao', 'siliconflow', 'openrouter', 'ollama', 'lmstudio', 'custom']
    .forEach((id) => assert(ids.includes(id), '缺少 ' + id));
});

check('默认配置是智谱且字段完整', () => {
  const cfg = AI.defaultConfig();
  assert.strictEqual(cfg.active, 'zhipu');
  const p = AI.getProvider(cfg);
  assert.strictEqual(p.protocol, 'openai');
  assert(p.baseUrl.includes('bigmodel.cn'));
  assert(p.textModel);
});

check('旧版 settings 迁移到智谱', () => {
  const cfg = AI.normalizeConfig(null, { apiKey: 'old-key', textModel: 'glm-4-air', visionModel: 'glm-4v-plus' });
  const p = AI.getProvider(cfg);
  assert.strictEqual(p.apiKey, 'old-key');
  assert.strictEqual(p.textModel, 'glm-4-air');
  assert.strictEqual(p.visionModel, 'glm-4v-plus');
});

check('自定义配置保留 baseUrl/协议/模型/请求头', () => {
  const raw = {
    active: 'custom',
    providers: {
      custom: {
        protocol: 'anthropic', baseUrl: 'https://example.com/v1',
        apiKey: 'k', textModel: 'my-text', visionModel: 'my-vision',
        headers: { 'X-Test': '1' }
      }
    }
  };
  const p = AI.getProvider(AI.normalizeConfig(raw), 'custom');
  assert.strictEqual(p.protocol, 'anthropic');
  assert.strictEqual(p.baseUrl, 'https://example.com/v1');
  assert.strictEqual(p.textModel, 'my-text');
  assert.strictEqual(p.headers['X-Test'], '1');
});

check('OpenAI 端点拼接', () => {
  assert.strictEqual(AI.endpointFor({ baseUrl: 'https://api.openai.com/v1', protocol: 'openai' }),
    'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(AI.endpointFor({ baseUrl: 'https://api.openai.com/v1/', protocol: 'openai' }),
    'https://api.openai.com/v1/chat/completions');
});

check('完整端点不重复拼接', () => {
  assert.strictEqual(AI.endpointFor({ baseUrl: 'https://x.test/v1/chat/completions', protocol: 'openai' }),
    'https://x.test/v1/chat/completions');
  assert.strictEqual(AI.endpointFor({ baseUrl: 'https://x.test/v1/messages', protocol: 'anthropic' }),
    'https://x.test/v1/messages');
});

check('带 query 的端点把路径插在 query 前', () => {
  assert.strictEqual(
    AI.endpointFor({ baseUrl: 'https://x.test/openai/deployments/d/chat/completions?api-version=2024-10-21', protocol: 'openai' }),
    'https://x.test/openai/deployments/d/chat/completions?api-version=2024-10-21'
  );
});

check('Anthropic 端点', () => {
  assert.strictEqual(AI.endpointFor({ baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic' }),
    'https://api.anthropic.com/v1/messages');
});

check('OpenAI 请求头与请求体', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'openai');
  p.apiKey = 'sk-test';
  const req = AI.buildRequest(p, { messages: [{ role: 'user', content: 'hi' }] });
  assert.strictEqual(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(req.headers.Authorization, 'Bearer sk-test');
  assert.strictEqual(req.body.model, 'gpt-4o-mini');
  assert.strictEqual(req.body.messages[0].content, 'hi');
  assert.strictEqual(req.body.temperature, 0.3);
});

check('o 系列模型不带 temperature', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'openai');
  const req = AI.buildRequest(p, { model: 'o4-mini', messages: [{ role: 'user', content: 'hi' }] });
  assert.strictEqual(req.body.temperature, undefined);
});

check('Anthropic 请求头与 system 分离', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'anthropic');
  p.apiKey = 'sk-ant';
  const req = AI.buildRequest(p, {
    messages: [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' }
    ]
  });
  assert.strictEqual(req.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(req.headers['x-api-key'], 'sk-ant');
  assert.strictEqual(req.headers['anthropic-version'], '2023-06-01');
  assert.strictEqual(req.body.system, '你是助手');
  assert.strictEqual(req.body.messages.length, 1);
  assert.strictEqual(req.body.messages[0].role, 'user');
});

check('Anthropic 视觉图片转 base64 source', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'anthropic');
  const dataUrl = 'data:image/jpeg;base64,AAAA';
  const req = AI.buildRequest(p, {
    vision: true,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }]
  });
  const parts = req.body.messages[0].content;
  assert.strictEqual(parts[0].text, '看图');
  assert.strictEqual(parts[1].type, 'image');
  assert.strictEqual(parts[1].source.type, 'base64');
  assert.strictEqual(parts[1].source.media_type, 'image/jpeg');
  assert.strictEqual(parts[1].source.data, 'AAAA');
});

check('Anthropic 工具调用与 tool_result 转换', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '查一下' },
    {
      role: 'assistant', content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_todos', arguments: '{"filter":"today"}' } }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' }
  ];
  const conv = AI.toAnthropicMessages(msgs);
  assert.strictEqual(conv.system, 'sys');
  assert.strictEqual(conv.messages.length, 3);
  assert.strictEqual(conv.messages[1].content[0].type, 'tool_use');
  assert.deepStrictEqual(conv.messages[1].content[0].input, { filter: 'today' });
  assert.strictEqual(conv.messages[2].role, 'user');
  assert.strictEqual(conv.messages[2].content[0].type, 'tool_result');
  assert.strictEqual(conv.messages[2].content[0].tool_use_id, 'call_1');
});

check('Anthropic 工具定义转 input_schema', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'anthropic');
  const req = AI.buildRequest(p, {
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{
      type: 'function',
      function: { name: 'list_todos', description: '列出', parameters: { type: 'object', properties: { filter: { type: 'string' } } } }
    }]
  });
  assert.strictEqual(req.body.tools[0].name, 'list_todos');
  assert.strictEqual(req.body.tools[0].input_schema.properties.filter.type, 'string');
});

check('解析 OpenAI 响应', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'openai');
  const r = AI.parseResponse(p, {
    choices: [{
      message: {
        content: '你好',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }]
      }
    }]
  });
  assert.strictEqual(r.content, '你好');
  assert.strictEqual(r.toolCalls[0].function.name, 'x');
});

check('解析 OpenAI/DeepSeek usage（含缓存命中）', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'deepseek');
  const r = AI.parseResponse(p, {
    choices: [{ message: { content: 'ok' } }],
    usage: {
      prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
      prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100
    }
  });
  assert.strictEqual(r.usage.inputTokens, 120);
  assert.strictEqual(r.usage.outputTokens, 30);
  assert.strictEqual(r.usage.totalTokens, 150);
  assert.strictEqual(r.usage.cacheHitTokens, 20);
});

check('解析 Anthropic usage', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'anthropic');
  const r = AI.parseResponse(p, {
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 80, output_tokens: 20 }
  });
  assert.strictEqual(r.usage.totalTokens, 100);
});

check('解析 Anthropic 响应', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'anthropic');
  const r = AI.parseResponse(p, {
    content: [
      { type: 'text', text: '好的' },
      { type: 'tool_use', id: 'tu1', name: 'list_todos', input: { filter: 'all' } }
    ]
  });
  assert.strictEqual(r.content, '好的');
  assert.strictEqual(r.toolCalls[0].id, 'tu1');
  assert.strictEqual(r.toolCalls[0].function.name, 'list_todos');
  assert.deepStrictEqual(JSON.parse(r.toolCalls[0].function.arguments), { filter: 'all' });
});

check('自定义额外请求头覆盖默认头', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'custom');
  p.baseUrl = 'https://x.test/v1';
  p.apiKey = 'k';
  p.textModel = 'my-model';
  p.headers = { 'X-Custom': 'yes', Authorization: 'Token abc' };
  const req = AI.buildRequest(p, { messages: [{ role: 'user', content: 'hi' }] });
  assert.strictEqual(req.headers['X-Custom'], 'yes');
  assert.strictEqual(req.headers.Authorization, 'Token abc');
});

check('OpenRouter 默认请求头自动带上', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'openrouter');
  assert(p.headers['HTTP-Referer']);
  assert(p.headers['X-Title']);
});

check('本地提供方不要求 Key', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'ollama');
  assert.strictEqual(p.requiresKey, false);
});

check('错误信息提取', () => {
  assert.strictEqual(AI.errorMessage({ error: { message: 'bad key' } }, 401), 'bad key');
  assert.strictEqual(AI.errorMessage({ error: 'oops' }, 500), 'oops');
  assert.strictEqual(AI.errorMessage({}, 502), 'HTTP 502');
});

check('未填 Base URL 时报错', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'custom');
  p.textModel = 'my-model';
  assert.throws(() => AI.buildRequest(p, { messages: [{ role: 'user', content: 'hi' }] }), /接口地址/);
});

check('未配置视觉模型时报错', () => {
  const p = AI.getProvider(AI.defaultConfig(), 'lmstudio');
  assert.throws(() => AI.buildRequest(p, { vision: true, messages: [{ role: 'user', content: 'hi' }] }), /图片理解模型/);
});

console.log('\n=== 汇总 ===');
console.log('通过 ' + (total - failures.length) + '/' + total);
if (failures.length) {
  failures.forEach((f) => console.log(' - ' + f));
  process.exitCode = 1;
}
