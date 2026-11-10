import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

export const RELAY_PATH = '/internal/ai/responses';
const UPSTREAM = 'https://api.openai.com/v1/responses';
const BODY_KEYS = new Set(['model', 'store', 'instructions', 'input', 'max_output_tokens', 'text', 'reasoning']);
const NAMES = new Set(['turtle_judge', 'turtle_grade']);
const hash = (value) => createHash('sha256').update(value).digest();
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

function validSchema(schema) {
  if (!object(schema)) return false;
  const pending = [{ value: schema, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++nodes > 512 || depth > 16) return false;
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  return true;
}

function requestBody(body, model) {
  const format = body?.text?.format;
  if (!object(body) || Object.keys(body).some((k) => !BODY_KEYS.has(k))
    || body.model !== model || body.store !== false || body.max_output_tokens !== 1400
    || typeof body.instructions !== 'string' || !body.instructions.trim()
    || typeof body.input !== 'string' || !body.input.trim()
    || !object(body.text) || Object.keys(body.text).some((k) => k !== 'format')
    || !object(format) || Object.keys(format).some((k) => !['type', 'name', 'strict', 'schema'].includes(k))
    || format.type !== 'json_schema' || format.strict !== true || !NAMES.has(format.name) || !validSchema(format.schema)
    || body.reasoning && (!object(body.reasoning) || body.reasoning.effort !== 'low' || Object.keys(body.reasoning).length !== 1)) return null;
  // Rebuild the body, so the caller cannot add tools, another target, extra headers,
  // background processing, storage, a more expensive model or larger output budget.
  const safe = { model, store: false, instructions: body.instructions, input: body.input, max_output_tokens: 1400,
    text: { format: { type: 'json_schema', name: format.name, strict: true, schema: format.schema } } };
  if (/^gpt-[56]/.test(model)) safe.reasoning = { effort: 'low' };
  return safe;
}

async function upstreamJSON(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 262144) { await reader.cancel(); throw new Error('oversize'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function mountOpenAIRelay(app, {
  token = process.env.RELAY_SERVER_TOKEN,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  fetchImpl = globalThis.fetch,
  timeoutMs = 40_000,
} = {}) {
  // No route exists unless its independent server secret is configured.
  if (typeof token !== 'string' || token.length < 32) return false;
  const expected = hash(token); let inflight = 0;
  const fail = (res, status, code) => res.status(status).json({ error: { code } });
  app.post(RELAY_PATH, (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!timingSafeEqual(expected, hash(supplied))) return fail(res, 401, 'relay_unauthorized');
    next();
  }, express.json({ limit: '64kb', strict: true }), async (req, res) => {
    const body = requestBody(req.body, model);
    if (!body) return fail(res, 400, 'relay_invalid_body');
    if (!apiKey) return fail(res, 503, 'relay_not_configured');
    if (inflight >= 4) return fail(res, 429, 'relay_busy');
    inflight++;
    try {
      const response = await fetchImpl(UPSTREAM, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.min(50_000, Math.max(1, timeoutMs))),
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await upstreamJSON(response);
      if (!response.ok) return fail(res, 502, result?.error?.code === 'insufficient_quota' ? 'insufficient_quota' : 'relay_upstream_error');
      const parts = (Array.isArray(result.output) ? result.output : []).flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string').map((part) => ({ type: 'output_text', text: part.text }));
      if (!parts.length) return fail(res, 502, 'relay_incomplete_response');
      // Only return the Responses fields consumed by the game. Never relay request
      // instructions, arbitrary upstream errors, internal headers or credentials.
      return res.json({ status: result.status === 'incomplete' ? 'incomplete' : 'completed', output: [{ type: 'message', content: parts }] });
    } catch (error) {
      return fail(res, error.name === 'TimeoutError' || error.name === 'AbortError' ? 504 : 502, 'relay_unavailable');
    } finally { inflight--; }
  }, (error, _req, res, _next) => fail(res, error.type === 'entity.too.large' ? 413 : 400, 'relay_invalid_body'));
  return true;
}
