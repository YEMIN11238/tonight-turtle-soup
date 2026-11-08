import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDirectory } from './data-directory.js';

export const VOICE_SAMPLE = '今晚喝什么汤？灯已亮起，故事才刚刚开始。请提出你的第一个问题。';
const configured = () => Boolean(process.env.VOLC_SPEECH_API_KEY);
export function speechMeta() {
  return { available: configured(), provider: configured() ? 'doubao' : 'system', name: configured() ? process.env.VOLC_TTS_NAME || '悬疑解说 2.0' : '系统语音' };
}
const fail = (status, message) => Object.assign(new Error(message), { status });
const normalize = (s) => String(s || '').replace(/\s+/g, '');
export function canNarrate(text, state) {
  const value = normalize(text);
  if (!value || !state) return false;
  const sources = [state.puzzle?.surface, ...Object.values({ yes: '是', no: '否', irrelevant: '无关', unknown: '无法判断', invalid: '请换一种问法' }), ...(state.hints || []), ...((state.log || []).map((l) => l.label)), state.reveal?.truth];
  return sources.some((s) => s && normalize(s).includes(value));
}

// 官方 HTTP 单向流协议：每行 JSON 的 data 为 base64 音频，20000000 表示完成。
export async function readSpeechStream(body) {
  const decoder = new TextDecoder(); let pending = '', bytes = 0, finished = false;
  const audio = [];
  function line(raw) {
    if (!raw.trim()) return;
    const part = JSON.parse(raw.replace(/^data:\s*/, ''));
    if (part.code && part.code !== 20000000) throw fail(502, '豆包语音暂时无法合成，请稍后再试');
    if (part.data) { const b = Buffer.from(part.data, 'base64'); bytes += b.length; if (bytes > 12 * 1024 * 1024) throw fail(502, '语音片段过长'); audio.push(b); }
    if (part.code === 20000000) finished = true;
  }
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > 18 * 1024 * 1024) throw fail(502, '语音响应过长');
    let end; while ((end = pending.indexOf('\n')) >= 0) { line(pending.slice(0, end)); pending = pending.slice(end + 1); }
  }
  pending += decoder.decode(); if (pending.trim()) line(pending);
  if (!finished || !bytes) throw fail(502, '语音生成未完成，请重试');
  return Buffer.concat(audio);
}

export function mountSpeech(app, { stateFor, accessCode = '', fetchSpeech = fetch }) {
  const cache = new Map(), inflight = new Map(); let cacheBytes = 0, active = 0;
  const dir = getDataDirectory(), usageFile = join(dir, 'speech-usage.json');
  let usage = { day: '', chars: 0 };
  try { usage = JSON.parse(readFileSync(usageFile, 'utf8')); } catch {}
  function spend(chars) {
    const day = new Date().toISOString().slice(0, 10);
    if (usage.day !== day) usage = { day, chars: 0 };
    if (usage.chars + chars > Number(process.env.DAILY_TTS_CHAR_LIMIT || 20000)) throw fail(429, '今天的语音播报额度已用完，文字推理仍可继续');
    usage.chars += chars;
    mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(usageFile, JSON.stringify(usage), { mode: 0o600 });
  }
  async function synthesize(text) {
    const speaker = process.env.VOLC_TTS_SPEAKER || 'zh_male_xuanyijieshuo_uranus_bigtts';
    const resource = process.env.VOLC_TTS_RESOURCE || 'seed-tts-2.0';
    const key = createHash('sha256').update(resource + speaker + text).digest('hex');
    if (cache.has(key)) return { audio: cache.get(key), cached: true };
    if (inflight.has(key)) return { audio: await inflight.get(key), cached: true };
    if (active >= 3) throw fail(429, '主持人正在准备旁白，请稍后重播');
    spend(Array.from(text).length); active++;
    const job = (async () => {
      const response = await fetchSpeech('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.VOLC_SPEECH_API_KEY, 'X-Api-Resource-Id': resource, 'X-Api-Request-Id': randomUUID() },
        body: JSON.stringify({ user: { uid: 'weiming-game' }, req_params: { text, speaker, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: -8 } } }),
      });
      if (!response.ok) {
        console.error('Doubao speech HTTP:', response.status);
        throw fail(502, response.status === 401 || response.status === 403 ? '豆包语音鉴权或服务权限异常，请检查服务端配置' : '豆包语音连接失败，请稍后再试');
      }
      const audio = await readSpeechStream(response.body);
      while (cacheBytes + audio.length > 32 * 1024 * 1024 && cache.size) { const first = cache.keys().next().value; cacheBytes -= cache.get(first).length; cache.delete(first); }
      cache.set(key, audio); cacheBytes += audio.length;
      return audio;
    })();
    inflight.set(key, job);
    try { return { audio: await job, cached: false }; }
    finally { active--; inflight.delete(key); }
  }
  app.post(['/api/speech', '/api/rooms/:code/speech'], async (req, res) => {
    try {
      if (!configured()) throw fail(503, '尚未配置豆包语音');
      let text;
      if (req.body.preview === true) {
        if (accessCode && req.body.code !== accessCode) throw fail(403, '体验口令不对');
        text = VOICE_SAMPLE;
      } else {
        text = String(req.body.text || '').trim();
        if (Array.from(text).length > 320) throw fail(400, '一次最多播报 320 字');
        if (req.params.code) req.body.room = req.params.code;
        const state = stateFor(req);
        if (!canNarrate(text, state)) throw fail(403, '只能播报本局已经公开的内容');
      }
      const { audio, cached } = await synthesize(text);
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Voice-Cache': cached ? 'hit' : 'miss' }).send(audio);
    } catch (e) {
      if (!e.status) console.error('Speech request failed:', e.name);
      res.status(e.status || 502).json({ error: e.status ? e.message : '语音暂时没有回应，请稍后重播' });
    }
  });
}
