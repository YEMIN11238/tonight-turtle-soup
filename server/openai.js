// Direct mode uses the local server key; relay mode uses only its independent
// service credential and keeps the actual API key on the relay server.
const relayURL = process.env.OPENAI_RELAY_URL || '';
const relayToken = process.env.OPENAI_RELAY_TOKEN || '';
export const openaiRelayConfigured = Boolean(relayURL && relayToken);
export const openaiConfigured = Boolean(process.env.OPENAI_API_KEY || openaiRelayConfigured);
export const openaiModel = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

function endpoint() {
  if (!relayURL) return { url: 'https://api.openai.com/v1/responses', token: process.env.OPENAI_API_KEY, timeout: 40_000 };
  let url;
  try { url = new URL(relayURL); } catch {}
  const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || !relayToken || url.username || url.password || url.search || url.hash || url.pathname !== '/internal/ai/responses'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw Object.assign(new Error('AI 中继配置不完整，请检查服务器设置'), { status: 503 });
  return { url: url.href, token: relayToken, timeout: 50_000 };
}

export async function openaiJSON(name, schema, instructions, input) {
  const body = {
    model: openaiModel, store: false, instructions, input,
    max_output_tokens: 1400,
    text: { format: { type: 'json_schema', name, strict: true, schema: { ...schema, additionalProperties: false } } },
  };
  if (/^gpt-[56]/.test(openaiModel)) body.reasoning = { effort: 'low' };
  const target = endpoint();
  const res = await fetch(target.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(target.timeout),
    headers: { Authorization: 'Bearer ' + target.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) {
    console.error('OpenAI request failed:', res.status, String(result.error?.code || 'unknown'));
    const message = result.error?.code === 'insufficient_quota' ? '模型账户额度不足，请检查 OpenAI API 额度' : 'AI 裁判暂时无法连接，请稍后重试';
    throw Object.assign(new Error(message), { status: 502 });
  }
  const text = (result.output || []).flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('');
  if (!text || result.status === 'incomplete') throw Object.assign(new Error('裁判没有返回完整结果，请重试'), { status: 502 });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('裁判返回格式异常，请重试'), { status: 502 }); }
}
