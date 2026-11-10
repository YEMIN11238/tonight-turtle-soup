import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mountOpenAIRelay, RELAY_PATH } from '../server/openai-relay.js';

const token = 'test-relay-credential-32-characters-long';
const apiKey = 'test-api-credential-stays-on-relay';
const body = () => ({ model: 'gpt-5.4-mini', store: false, instructions: '只返回裁判判定。', input: '他知道吗？', max_output_tokens: 1400,
  text: { format: { type: 'json_schema', name: 'turtle_judge', strict: true, schema: { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'], additionalProperties: false } } }, reasoning: { effort: 'low' } });
const success = () => new Response(JSON.stringify({ status: 'completed', instructions: 'upstream-private-instructions', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"verdict":"yes"}' }] }] }), { status: 200 });

async function server(t, options) {
  const app = express(); mountOpenAIRelay(app, options);
  app.use(express.json({ limit: '8kb' }));
  const running = app.listen(0, '127.0.0.1'); await once(running, 'listening');
  t.after(() => new Promise((resolve) => { running.closeAllConnections(); running.close(resolve); }));
  const url = `http://127.0.0.1:${running.address().port}${RELAY_PATH}`;
  return (value = body(), authorization = 'Bearer ' + token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: typeof value === 'string' ? value : JSON.stringify(value) });
}

test('中继默认无路由；身份校验在解析请求前完成，未授权请求不产生模型调用', async (t) => {
  let calls = 0;
  const request = await server(t, { token: '', apiKey, fetchImpl: async () => { calls++; return success(); } });
  assert.equal((await request()).status, 404);
  const protectedRequest = await server(t, { token, apiKey, fetchImpl: async () => { calls++; return success(); } });
  assert.equal((await protectedRequest('{broken', '')).status, 401);
  assert.equal((await protectedRequest(body(), 'Bearer incorrect')).status, 401);
  assert.equal(calls, 0);
});

test('中继只调用固定官方端点并重建受限请求；返回结果不带上游指令或凭据', async (t) => {
  let calls = 0;
  const request = await server(t, { token, apiKey, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + apiKey);
    const sent = JSON.parse(options.body);
    assert.equal(sent.model, 'gpt-5.4-mini'); assert.equal(sent.store, false); assert.equal(sent.max_output_tokens, 1400);
    assert.deepEqual(sent.reasoning, { effort: 'low' });
    assert.equal(sent.tools, undefined);
    return success();
  } });
  const response = await request();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.output[0].content[0].text, '{"verdict":"yes"}');
  for (const privateValue of [token, apiKey, 'upstream-private-instructions']) assert.ok(!JSON.stringify(result).includes(privateValue));
  assert.equal(calls, 1);
});

test('任意目标、工具、昂贵模型、大输出及超大请求均在调用上游前被拒绝', async (t) => {
  let calls = 0;
  const request = await server(t, { token, apiKey, fetchImpl: async () => { calls++; return success(); } });
  for (const extra of [{ url: 'https://other.example/private' }, { tools: [{ type: 'web_search' }] }, { model: 'another-model' }, { max_output_tokens: 100000 }, { store: true }]) {
    assert.equal((await request({ ...body(), ...extra })).status, 400);
  }
  assert.equal((await request({ ...body(), input: 'x'.repeat(70000) })).status, 413);
  assert.equal(calls, 0);
  assert.equal((await request({ ...body(), instructions: 'x'.repeat(12000) })).status, 200, '内部64KB解析器应先于全局8KB限制');
});

test('上游错误与超时返回受控错误码，不回传可能带敏感内容的错误正文', async (t) => {
  const request = await server(t, { token, apiKey, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: apiKey + token } }), { status: 401 }) });
  const response = await request(); assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: 'relay_upstream_error' } });
  const timeoutRequest = await server(t, { token, apiKey, timeoutMs: 10, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }) });
  const timeoutResponse = await timeoutRequest(); assert.equal(timeoutResponse.status, 504);
  assert.deepEqual(await timeoutResponse.json(), { error: { code: 'relay_unavailable' } });
});

test('客户端中继模式无需OpenAI密钥，只向已配置的中继发送独立凭据', async () => {
  const previous = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_RELAY_URL, token: process.env.OPENAI_RELAY_TOKEN, fetch: globalThis.fetch };
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_RELAY_URL = 'https://relay.example/internal/ai/responses'; process.env.OPENAI_RELAY_TOKEN = token;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://relay.example/internal/ai/responses');
      assert.equal(options.headers.Authorization, 'Bearer ' + token);
      assert.equal(options.redirect, 'error');
      return success();
    };
    const client = await import('../server/openai.js?relay-contract');
    assert.equal(client.openaiConfigured, true); assert.equal(client.openaiRelayConfigured, true);
    assert.deepEqual(await client.openaiJSON('turtle_judge', body().text.format.schema, '只返回判定', '他知道吗'), { verdict: 'yes' });
  } finally {
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: previous.key, OPENAI_RELAY_URL: previous.url, OPENAI_RELAY_TOKEN: previous.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globalThis.fetch = previous.fetch;
  }
});
