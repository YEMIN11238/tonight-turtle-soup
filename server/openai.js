// API key 仅从服务端环境读取，始终请求 OpenAI 官方端点。
export const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
export const openaiModel = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

export async function openaiJSON(name, schema, instructions, input) {
  const body = {
    model: openaiModel, store: false, instructions, input,
    max_output_tokens: 1400,
    text: { format: { type: 'json_schema', name, strict: true, schema: { ...schema, additionalProperties: false } } },
  };
  if (/^gpt-[56]/.test(openaiModel)) body.reasoning = { effort: 'low' };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(40_000),
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
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
