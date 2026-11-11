// 今晚喝什么汤 · 前端。所有展示数据来自服务端真实状态，不硬编码任何线索。
import { artOf, imgSrc } from './cases.js';
import { openingParts, openingDelay, revealParts } from './opening-flow.js';
import { gameSound } from './sound.js';
import { Narrator } from './narrator.js';
import { RoomClient } from './room-client.js';
import { RoomVoice } from './room-voice.js';
import { turnBookPage } from './book-turn.js';
import { readRecords, saveRecord, challengeText, makeShareCard } from './case-records.js';
import { buildReview, recommendNext } from './case-review.js';
import { createCaseAtmosphere, atmosphereArt } from './case-atmosphere.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stars = (n) => '★'.repeat(n);
const pad2 = (n) => String(n).padStart(2, '0');
const VERDICT_SUB = { yes: '已确认', no: '已记入排除记录', irrelevant: '与真相无关', unknown: '故事没有交代 · 未扣次数', invalid: '未扣次数' };
const STATUS = {
  won: { badge: '成功结案', head: '真相浮出水面。', lead: '你的推理说中了核心真相。下面是完整汤底，以及本局确认过的每一项事实。' },
  lost: { badge: '尚未还原', head: '真相仍在雾里。', lead: '三次提交机会已经用完。完整汤底在这里，对照看看是哪一步没有想通。' },
  gaveup: { badge: '主动揭晓', head: '卷宗已经翻开。', lead: '你选择直接揭晓。下面是完整汤底，以及本局已经确认的事实。' },
};

let META = null;
let S = null; // 当前公开状态
let busy = false;
let view = 'lobby';
let selectedId = '';
let introParts = [];
let introCursor = 0;
let introAuto = true;
let introTimer = null;
let introFinishing = false;
let cinematicMode = 'opening';
let introNarrated = false;
let bookOpening = false;
let bookTurnController = null;
let archiveFilter = 'horror';
let bookCollection = 'horror';
const atmosphere = createCaseAtmosphere({ sound: gameSound });
const seenOpenings = () => { try { return JSON.parse(localStorage.getItem('ts_seen_openings') || '{}') || {}; } catch { return {}; } };
const horrorPuzzles = () => META.puzzles.filter((p) => p.collection !== 'archive');
const bookPuzzles = () => bookCollection === 'all' ? META.puzzles : horrorPuzzles();

async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const r = await fetch('/api/' + path, opt);
  const j = await r.json().catch(() => ({ error: '网络异常，请稍后再试' }));
  if (!r.ok) throw Object.assign(new Error(j.error || '出错了'), { status: r.status });
  // 展示标题只交代谜面，避免把身份与心理设定提前当作线索送给玩家。
  if (Array.isArray(j.puzzles)) j.puzzles = j.puzzles.map((p) => ({ ...p, title: artOf(p.id).displayTitle || p.title }));
  if (j.puzzle) j.puzzle = { ...j.puzzle, title: artOf(j.puzzle.id).displayTitle || j.puzzle.title };
  return j;
}
function toast(msg, ms = 2600, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const room = new RoomClient(onRoom, (msg) => toast(msg));
const roomVoice = new RoomVoice(room, { notify: (msg) => toast(msg, 4500), duck: (value) => gameSound.setConversation(value) });
let chatCollapsed = matchMedia('(max-width:760px)').matches;
matchMedia('(max-width:760px)').addEventListener('change', (e) => { if (e.matches) { chatCollapsed = true; paintRoom(); } });
let chatVersion = '', chatUnread = 0;
function paintRoom() {
  const d = room.data;
  paintSavePolicy();
  document.body.classList.toggle('room-connected', Boolean(d));
  document.body.classList.toggle('chat-collapsed', chatCollapsed);
  $('#roomDock').classList.toggle('hidden', !d);
  $('#roomChat').classList.toggle('hidden', !d || chatCollapsed);
  $('#btnCoopHeader').classList.toggle('hidden', !d);
  $('#btnCoop').classList.toggle('hidden', !META?.rooms || Boolean(d));
  if (!d) return;
  $('#btnCoopHeader').textContent = '房间 ' + d.code;
  const me = d.players.find((p) => p.id === d.meId);
  const present = d.players.filter((p) => p.connected);
  $('#entryReady').textContent = d.phase === 'lobby' ? `${present.filter((p) => p.ready).length} / ${present.length} 已准备 · ${room.host ? '你是房主' : '等待房主开局'}` : '同伴正在推理，随时可以回到本局';
  $('#roomMembers').innerHTML = Array.from({ length: 8 }, (_, i) => {
    const p = d.players[i];
    if (!p) return '<div class="room-member empty"><span class="member-icon">+</span><span class="member-name">空位</span><small>等待同伴</small></div>';
    const state = !p.connected ? '暂时离线' : p.voiceJoined ? p.muted ? '已静音' : p.speaking ? '正在说话' : '语音已连' : d.phase === 'lobby' ? p.ready ? '已准备' : '未准备' : '推理中';
    return `<div class="room-member ${p.id === d.meId ? 'me' : ''} ${p.speaking ? 'speaking' : ''} ${!p.connected ? 'offline' : ''}"><span class="member-icon">${esc(Array.from(p.name)[0])}</span>${p.id === d.hostId ? '<span class="crown" title="房主">♛</span>' : ''}<span class="member-name" title="${esc(p.name)}">${esc(p.name)}${p.id === d.meId ? ' · 我' : ''}</span><small>${state}</small></div>`;
  }).join('');
  $('#btnRoomMic').classList.toggle('live', Boolean(me?.voiceJoined && !me?.muted));
  $('#btnRoomMic span').textContent = me?.voiceJoined ? me.muted ? '取消静音' : '麦克风开' : '加入语音';
  $('#btnRoomMic').setAttribute('aria-pressed', String(Boolean(me?.voiceJoined && !me?.muted)));
  $('#btnRoomChat').setAttribute('aria-expanded', String(!chatCollapsed));
  const last = d.chat.at(-1)?.id || '';
  if (chatVersion !== last) {
    if (chatCollapsed && chatVersion) chatUnread++;
    $('#chatMessages').innerHTML = d.chat.map((c) => `<p class="chat-line ${c.system ? 'system' : ''}">${c.system ? '' : `<b>${esc(c.name)}</b>`}${esc(c.text)}</p>`).join('');
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight; chatVersion = last;
  }
  if (!chatCollapsed) chatUnread = 0;
  $('#chatUnread').textContent = chatUnread ? `(${chatUnread})` : '';
  updateLobbyControls();
}
function onRoom(d, old) {
  if (!d) { roomVoice.stop(); S = null; stopSpeech(); paintRoom(); showLobby(selectedId).catch((e) => toast(e.message)); return; }
  paintRoom(); roomVoice.sync(d);
  if (d.phase === 'lobby') {
    if (!old || old.phase !== 'lobby' || selectedId !== d.puzzleId) { S = null; showLobby(d.puzzleId).catch((e) => toast(e.message)); }
    return;
  }
  if (!d.game) return;
  const st = d.game; st.puzzle.title = artOf(st.puzzle.id).displayTitle || st.puzzle.title;
  if (!old?.game || old.game.sid !== st.sid) {
    stopSpeech(); S = st;
    if (st.status !== 'playing') showEnd(st);
    else if (st.log.length) enterRoom(st);
    else startIntro(st);
    return;
  }
  if (d.gameRevision !== old.gameRevision) {
    const known = new Set((S?.clues || []).map((c) => c.id));
    const fresh = st.clues.filter((c) => !known.has(c.id)).map((c) => c.id);
    const last = st.log.at(-1), newQuestion = st.log.length > old.game.log.length;
    render(st, { newIds: fresh, flashIds: newQuestion ? last?.reClues || [] : [] });
    if (st.status !== 'playing' && old.game.status === 'playing') {
      if ($('#submitDlg').open) $('#submitDlg').close(); startReveal(st);
    } else if (view === 'room') {
      renderJudge(last ? { ...last, no: countedNo(st, st.log.length - 1) } : null);
      if (newQuestion) { speak(last.label); if (fresh.length) toast(`已收录 ${fresh.length} 项关键事实`, 2200, 'good'); }
    }
    if (d.result && JSON.stringify(d.result) !== JSON.stringify(old.result) && st.status === 'playing') toast(`推理得分 ${d.result.score}%，还剩 ${st.submitsLeft} 次提交机会`, 4500);
  } else S = st;
  if (view === 'room') {
    renderControls(S);
    if (d.busy) renderJudge(null, d.busy.q, d.busy.by);
    else if (old.busy && d.gameRevision === old.gameRevision) {
      const last = S.log.at(-1); renderJudge(last ? { ...last, no: countedNo(S, S.log.length - 1) } : null);
    }
  }
}
async function chooseCase(id) {
  if (room.active) { await room.action('select', { puzzleId: id }); return showLobby(id); }
  return showLobby(id);
}
function openRoomDialog(code = '') {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('ts_room') || '{}'); } catch {}
  $('#playerName').value = saved.name || localStorage.getItem('ts_player_name') || '';
  $('#joinCode').value = code; $('#roomFormError').textContent = '';
  $('#roomDlg').showModal(); $('#playerName').focus();
}
$('#btnCoop').addEventListener('click', () => openRoomDialog());
$('#btnRoomDlgClose').addEventListener('click', () => $('#roomDlg').close());
$('#roomForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const name = $('#playerName').value.trim(), code = $('#joinCode').value.trim().toUpperCase();
  if (!name) return;
  if (e.submitter?.value === 'join' && !/^[A-F0-9]{8}$/.test(code)) { $('#roomFormError').textContent = '请填写 8 位房间号'; return; }
  $('#btnJoinRoom').disabled = $('#btnCreateRoom').disabled = true; gameSound.unlock();
  try {
    localStorage.setItem('ts_player_name', name);
    if (e.submitter?.value === 'join') await room.join(code, name);
    else await room.create({ name, puzzleId: selectedId, code: $('#code').value.trim() });
    $('#roomDlg').close();
  } catch (err) { $('#roomFormError').textContent = err.message; }
  finally { $('#btnJoinRoom').disabled = $('#btnCreateRoom').disabled = false; }
});
async function inviteRoom() {
  if (!room.active) return;
  const origin = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && META.lanUrl ? META.lanUrl : location.origin;
  const url = new URL('/', origin); url.searchParams.set('room', room.data.code);
  try { await navigator.clipboard.writeText(url.href); toast('邀请链接已复制，同伴打开后即可加入'); }
  catch { prompt('把这个链接发给同伴：', url.href); }
}
$('#btnInvite').addEventListener('click', inviteRoom); $('#btnCoopHeader').addEventListener('click', inviteRoom);
$('#btnLeaveCoop').addEventListener('click', async () => { if (room.active) { roomVoice.stop(); await room.leave(); } });
$('#btnRoomMic').addEventListener('click', () => roomVoice.toggle());
$('#btnRoomChat').addEventListener('click', () => { chatCollapsed = !chatCollapsed; paintRoom(); });
$('#btnChatClose').addEventListener('click', () => { chatCollapsed = true; paintRoom(); });
$('#chatForm').addEventListener('submit', async (e) => { e.preventDefault(); const text = $('#chatText').value.trim(); if (!text || !room.active) return; try { await room.action('chat', { text }); $('#chatText').value = ''; } catch (err) { toast(err.message); } });
const played = () => JSON.parse(localStorage.getItem('ts_played') || '{}');
function markPlayed(id, status) {
  const p = played();
  p[id] = status;
  localStorage.setItem('ts_played', JSON.stringify(p));
}

// 图片：稳定占位比例；加载完成再淡入；失败时保留“编号 + 标题”替代界面
function artBox(id, title, { small = false, eager = false, pos, source } = {}) {
  const a = artOf(id);
  const src = source || atmosphereArt({ puzzle: { id }, status: 'playing', sceneStage: 'quiet' })?.src || imgSrc(id, small);
  return `<div class="art-box">
    ${src ? `<img src="${src}" alt="${esc(a.alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" style="object-position:${pos || a.pos}" onload="this.classList.add('loaded');this.parentNode.classList.add('has-img')" onerror="this.remove()">` : ''}
    <div class="art-fallback"><span>CASE ${a.no}</span><b>${esc(title)}</b></div>
  </div>`;
}

function show(v) {
  if (v !== 'lobby') {
    bookTurnController?.abort(); bookTurnController = null; bookOpening = false;
    $('.entry-stage').classList.remove('is-opening');
  }
  if (v !== 'intro') {
    clearTimeout(introTimer);
    if (view === 'intro') stopSpeech();
  }
  view = v;
  document.body.dataset.view = v;
  atmosphere.setView(v === 'intro' && cinematicMode === 'reveal' ? 'reveal' : v);
  gameSound.setPhase(v === 'intro' && cinematicMode === 'reveal' ? 'reveal' : v);
  for (const id of ['viewLobby', 'viewIntro', 'viewHome', 'viewRoom', 'viewEnd']) $('#' + id).classList.add('hidden');
  $({ lobby: '#viewLobby', intro: '#viewIntro', home: '#viewHome', room: '#viewRoom', end: '#viewEnd' }[v]).classList.remove('hidden');
  $('#navLobby').classList.toggle('active', v === 'lobby');
  $('#navHome').classList.toggle('active', v === 'home');
  $('#navRoom').classList.toggle('active', v === 'room');
  $('#navRoom').classList.toggle('hidden', !S || S.status !== 'playing');
  $('#notebook').classList.remove('open');
  window.scrollTo({ top: 0 });
}
function setMode() {
  const offline = META?.mode === 'offline';
  const label = offline ? '离线演示' : 'AI 裁判在线';
  $('#mode').textContent = label;
  $('#footMode').textContent = offline ? '离线演示模式 · 判定为关键词匹配，仅供预览界面' : '';
  $('#entryMode').textContent = offline ? '离线演示 · 裁判采用关键词匹配' : 'AI 裁判在线 · 40 次提问机会';
  paintSavePolicy();
}
function paintSavePolicy() {
  $('#savePolicy').textContent = room.active ? '多人房间内共同保存进度' : META?.storage?.durable ? `进度自动保存 · 继续游玩后保留 ${META.storage.retentionDays} 天` : '本局自动保存';
}

// ================= 房间入口 =================
async function showLobby(id = selectedId) {
  META ??= await api('meta');
  setMode();
  const puzzle = META.puzzles.find((p) => p.id === id)
    || horrorPuzzles().find((p) => !played()[p.id]) || horrorPuzzles()[0];
  selectedId = puzzle.id;
  if (puzzle.collection === 'archive') bookCollection = 'all';
  localStorage.setItem('ts_case', selectedId);
  const art = artOf(selectedId);
  const chapters = bookPuzzles(), chapter = chapters.findIndex((p) => p.id === selectedId);
  $('#entryTag').textContent = `第 ${chapter + 1} 章 · ${puzzle.tag}`;
  $('#entryPage').textContent = `${pad2(chapter + 1)} / ${pad2(chapters.length)}`;
  $('#entryTitle').textContent = puzzle.title;
  $('#entrySurface').textContent = art.tagline || puzzle.surface;
  $('#entrySummary').textContent = art.tagline || puzzle.surface;
  if (!room.active) $('#entryReady').textContent = '单人推理 · 已就绪';
  $('#codeBox').classList.toggle('hidden', !META.needCode);
  if (META.needCode && !$('#code').value) $('#code').value = localStorage.getItem('ts_code') || '';
  const resumable = S?.status === 'playing';
  $('#btnResume').classList.toggle('hidden', !resumable);
  $('#resumeCase').textContent = resumable ? `· ${S.puzzle.title}` : '';
  updateLobbyControls();
  const url = new URL(location.href);
  url.searchParams.set('case', selectedId);
  if (room.active) url.searchParams.set('room', room.data.code); else url.searchParams.delete('room');
  url.hash = '';
  history.replaceState(null, '', url);
  show('lobby');
  paintRoom();
}

function updateLobbyControls() {
  const chapters = META ? bookPuzzles() : [], chapter = chapters.findIndex((p) => p.id === selectedId);
  const chapterLocked = busy || bookOpening || !META || (room.active && (!room.host || room.data.phase !== 'lobby'));
  $('#btnBookPrev').disabled = chapterLocked || chapter <= 0;
  $('#btnBookNext').disabled = chapterLocked || chapter >= chapters.length - 1;
  if (META) {
    $('#btnBookPrev').title = chapter > 0 ? `上一章 · ${chapters[chapter - 1].title}` : '已经是第一章';
    $('#btnBookNext').title = chapter < chapters.length - 1 ? `下一章 · ${chapters[chapter + 1].title}` : '已经是最后一章';
  }
  if (room.active) {
    const d = room.data, me = d.players.find((p) => p.id === d.meId), playing = d.phase !== 'lobby';
    $('#btnStart').disabled = busy || bookOpening || (room.host && !playing && !d.canStart);
    $('#btnStart').textContent = bookOpening ? '正在翻开故事…' : playing ? '返回本局推理 →' : room.host ? d.canStart ? '翻开故事 →' : '等待同伴准备' : me?.ready ? '已准备 · 取消' : '准备好了';
    for (const id of ['#btnArchive', '#btnRandom']) $(id).disabled = busy || !room.host || playing;
    $('#btnResume').disabled = busy; return;
  }
  $('#btnStart').disabled = busy || bookOpening;
  $('#btnStart').innerHTML = busy || bookOpening ? '正在翻开故事…' : `${seenOpenings()[selectedId] ? '开始推理' : '翻开故事'} <svg class="arrow"><use href="#i-arrow"/></svg>`;
  for (const id of ['#btnArchive', '#btnRandom', '#btnResume']) $(id).disabled = busy || bookOpening || !META;
}

async function turnChapter(step) {
  if (!META || busy || bookOpening || view !== 'lobby') return;
  if (room.active && (!room.host || room.data.phase !== 'lobby')) return;
  const chapters = bookPuzzles(), chapter = chapters.findIndex((p) => p.id === selectedId), next = chapters[chapter + step];
  if (!next) return;
  gameSound.unlock();
  bookTurnController?.abort();
  const controller = bookTurnController = new AbortController();
  bookOpening = true; $('.entry-stage').classList.add('is-opening'); updateLobbyControls();
  try {
    await turnBookPage($('.book-prop'), { signal: controller.signal, direction: step < 0 ? 'previous' : 'next', onReveal: () => chooseCase(next.id) });
  } catch (err) { toast(err.message || '这一页没能翻开，请重试'); }
  finally {
    if (!controller.signal.aborted) { bookOpening = false; $('.entry-stage').classList.remove('is-opening'); updateLobbyControls(); }
  }
}
$('#btnBookPrev').addEventListener('click', () => turnChapter(-1));
$('#btnBookNext').addEventListener('click', () => turnChapter(1));

$('#btnStart').addEventListener('click', async () => {
  if (!room.active) return META ? openCase(selectedId) : boot();
  gameSound.unlock();
  try {
    if (room.data.phase !== 'lobby' && S) return enterRoom(S);
    if (room.host) await room.action('start');
    else { const me = room.data.players.find((p) => p.id === room.data.meId); await room.action('ready', { ready: !me.ready }); }
  } catch (err) { toast(err.message); }
});
$('#btnArchive').addEventListener('click', () => { if (!busy) showHome().catch((e) => toast(e.message)); });
$('#btnRandom').addEventListener('click', () => {
  if (busy || !META) return;
  const other = horrorPuzzles().filter((p) => p.id !== selectedId);
  if (other.length) chooseCase(other[Math.floor(Math.random() * other.length)].id).catch((e) => toast(e.message));
});
$('#btnResume').addEventListener('click', async () => {
  if (busy || !S) return;
  gameSound.unlock();
  if (room.active) return enterRoom(S);
  busy = true;
  updateLobbyControls();
  try { enterRoom(await api('state?sid=' + encodeURIComponent(S.sid))); }
  catch (err) {
    if (err.status === 404 || err.status === 410) {
      S = null; localStorage.removeItem('ts_sid'); await showLobby();
    }
    toast(err.message);
  } finally {
    busy = false;
    updateLobbyControls();
    if (S && view === 'room') renderControls(S);
  }
});

// ================= 汤面开场 =================
function startIntro(st) {
  S = st;
  atmosphere.update(st);
  if (!room.active && seenOpenings()[st.puzzle.id]) return enterRoom(st);
  if (view === 'lobby' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    bookTurnController?.abort();
    const controller = bookTurnController = new AbortController();
    bookOpening = true;
    $('.entry-stage').classList.add('is-opening'); updateLobbyControls();
    turnBookPage($('.book-prop'), { signal: controller.signal }).catch(() => {}).then(() => {
      if (controller.signal.aborted) return;
      bookOpening = false;
      $('.entry-stage').classList.remove('is-opening');
      if (view === 'lobby' && S?.sid === st.sid) presentIntro(S);
    });
    return;
  }
  presentIntro(st);
}
function presentIntro(st) {
  S = st;
  cinematicMode = 'opening';
  $('#introText').classList.remove('reveal-text');
  $('#btnIntroBack').textContent = '← 返回房间';
  $('#btnIntroEnter').innerHTML = '进入推理室 <svg><use href="#i-arrow"/></svg>';
  introParts = openingParts(st.puzzle.surface);
  introCursor = 0;
  introAuto = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  introFinishing = false;
  $('#introTitle').textContent = `${st.puzzle.title} / 今晚喝什么汤`;
  $('#q').value = '';
  $('#answer').value = '';
  switchTab('clues');
  show('intro');
  renderIntro();
  $('#btnIntroNext').focus({ preventScroll: true });
}

function renderIntro() {
  stopSpeech();
  introNarrated = false;
  if (cinematicMode === 'reveal') {
    $('#btnIntroReplay').disabled = false;
    $('#btnIntroReplay').textContent = '重播';
    const last = introCursor >= introParts.length - 1;
    $('#introText').innerHTML = `<span class="reveal-kicker">${last ? '最后一块拼图' : '汤底揭晓'}</span><p class="opening-line">${esc(introParts[introCursor] || '')}</p>`;
    $('#introCount').textContent = `${introCursor + 1} / ${introParts.length}`;
    $('#btnIntroNext').textContent = last ? '查看完整汤底 / 空格' : '点击继续 / 空格';
    $('#btnIntroAuto').textContent = last ? '真相已揭晓' : introAuto ? '暂停自动' : '自动播放';
    $('#btnIntroAuto').disabled = last;
    $('#btnIntroAuto').setAttribute('aria-pressed', String(introAuto));
    $('#introStage').scrollTop = 0;
    if (voiceOn) speak(introParts[introCursor]);
    queueIntro();
    return;
  }
  const last = introCursor >= introParts.length - 1;
  $('#btnIntroReplay').disabled = false;
  $('#btnIntroReplay').textContent = '重播';
  $('#introText').innerHTML = `<p class="opening-line">${esc(introParts[introCursor] || '')}</p>${last ? '<p class="opening-guide">用「是 / 否」问题还原真相 · 40 次机会</p>' : ''}`;
  $('#introCount').textContent = `${introCursor + 1} / ${introParts.length}`;
  $('#btnIntroNext').textContent = last ? '开始推理 / 空格' : '点击继续 / 空格';
  $('#btnIntroAuto').textContent = last ? '汤面已读完' : introAuto ? '暂停自动' : '自动播放';
  $('#btnIntroAuto').disabled = last;
  $('#btnIntroAuto').setAttribute('aria-pressed', String(introAuto));
  $('#introStage').scrollTop = 0;
  if (voiceOn) speak(introParts[introCursor]);
  queueIntro();
}

function queueIntro() {
  clearTimeout(introTimer);
  if (view !== 'intro' || !introAuto || document.hidden || speechPending || !$('#audioPanel').classList.contains('hidden') || introCursor >= introParts.length) return;
  if (introCursor >= introParts.length - 1) return;
  introTimer = setTimeout(advanceIntro, voiceOn && introNarrated ? 1100 : openingDelay(introParts[introCursor]));
}

function advanceIntro() {
  if (view !== 'intro' || introFinishing) return;
  if (introCursor >= introParts.length - 1) return finishIntro();
  introCursor++;
  renderIntro();
}

function finishIntro() {
  if (view !== 'intro' || introFinishing || !S) return;
  introFinishing = true;
  clearTimeout(introTimer);
  if (cinematicMode === 'reveal') showEnd(S);
  else enterRoom(S); // 复用开始时创建的同一局；进入与跳过均不重复开局、也不扣提问次数。
}

$('#introStage').addEventListener('click', advanceIntro);
$('#btnIntroNext').addEventListener('click', advanceIntro);
$('#btnIntroEnter').addEventListener('click', finishIntro);
$('#btnIntroBack').addEventListener('click', () => cinematicMode === 'reveal' ? finishIntro() : showLobby(S?.puzzle.id).catch((e) => toast(e.message)));
$('#btnIntroAuto').addEventListener('click', () => {
  introAuto = !introAuto;
  $('#btnIntroAuto').textContent = introAuto ? '暂停自动' : '自动播放';
  $('#btnIntroAuto').setAttribute('aria-pressed', String(introAuto));
  queueIntro();
});
document.addEventListener('visibilitychange', queueIntro);
document.addEventListener('keydown', (e) => {
  if (view !== 'intro' || e.repeat) return;
  if (!$('#audioPanel').classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); finishIntro(); }
  else if (e.key === 'ArrowRight' || (e.code === 'Space' && !e.target.closest('button'))) {
    e.preventDefault(); advanceIntro();
  }
});

// ================= 卷宗库 =================
async function showHome() {
  META ??= await api('meta');
  setMode();
  $('#codeBox').classList.toggle('hidden', !META.needCode);
  if (META.needCode && !$('#code').value) $('#code').value = localStorage.getItem('ts_code') || '';
  const pl = played();
  const list = archiveFilter === 'all' ? META.puzzles : horrorPuzzles();
  document.querySelectorAll('[data-collection]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.collection === archiveFilter)));
  // 主推：第一宗未结卷宗；都玩过则第一宗
  const feat = list.find((p) => !pl[p.id]) || list[0];
  const rest = list.filter((p) => p !== feat);
  const fa = artOf(feat.id);
  $('#featured').innerHTML = `
    <button class="featured" data-id="${esc(feat.id)}" type="button">
      <div class="feature-image">${artBox(feat.id, feat.title, { eager: true })}<span class="image-label">CASE ${fa.no} · 今夜卷宗</span></div>
      <div class="feature-copy">
 <div class="eyebrow">${esc(feat.tag)} · 难度 ${stars(feat.difficulty)}</div>
        <h2>${esc(feat.title)}</h2>
        <p>${esc(feat.surface)}</p>
        <div class="case-meta"><span>40 次提问机会</span><span>单人推理</span>${pl[feat.id] ? `<span class="played">${pl[feat.id] === 'won' ? '已结案' : '已揭晓'}</span>` : ''}</div>
        <span class="button dark">翻开卷宗 <svg class="arrow"><use href="#i-arrow"/></svg></span>
      </div>
    </button>`;
  $('#caseGrid').innerHTML = rest
    .map((p) => {
      const a = artOf(p.id);
      return `<button class="case-card" data-id="${esc(p.id)}" type="button" aria-label="${esc(p.title)}：${esc(p.surface)}">
        ${pl[p.id] ? `<span class="played">${pl[p.id] === 'won' ? '已结案' : '已揭晓'}</span>` : ''}
        ${artBox(p.id, p.title, { small: true })}
        <div class="case-card-body"><h3>${esc(p.title)}</h3><div class="case-meta"><span>${esc(p.tag)} · ${stars(p.difficulty)}</span><span>${a.no} ↗</span></div>${readRecords(localStorage)[p.id]?.best ? `<small class="case-best">本机最佳 ${readRecords(localStorage)[p.id].best.used} 问结案</small>` : ''}</div>
      </button>`;
    })
    .join('');
  const open = rest.filter((p) => !pl[p.id]).length;
  $('#restCount').textContent = open ? `还有 ${open} 段故事，等待你的解释` : '所有卷宗都已翻开过';
  history.replaceState(null, '', location.pathname + (room.active ? '?room=' + room.data.code : ''));
  show('home');
}
document.querySelectorAll('[data-collection]').forEach((button) => button.addEventListener('click', () => { archiveFilter = button.dataset.collection; showHome().catch((err) => toast(err.message)); }));

async function openCase(id) {
  if (busy) return;
  gameSound.unlock();
  const code = $('#code').value.trim();
  busy = true;
  updateLobbyControls();
  let st;
  try {
    st = await api('new', { puzzleId: id, code });
    if (META.needCode) localStorage.setItem('ts_code', code);
    localStorage.setItem('ts_sid', st.sid);
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
    updateLobbyControls();
  }
  if (st) startIntro(st);
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('.featured, .case-card');
  if (c && !busy) { bookCollection = archiveFilter; chooseCase(c.dataset.id).catch((err) => toast(err.message)); }
});

// ================= 推理室 =================
let sceneFor = null;
function setScene(st) {
  const id = st.puzzle.id;
  const a = artOf(id);
  $('#crumbCase').textContent = st.puzzle.title;
  $('#fbNo').textContent = `CASE ${a.no}`;
  $('#fbTitle').textContent = st.puzzle.title;
  const phaseArt = atmosphereArt(st), sceneKey = `${id}:${st.sceneStage || ''}`;
  if (sceneFor === sceneKey) return;
  sceneFor = sceneKey;
  // 新图加载完成后再替换，旧图保持到那时；标题淡入
  const scene = $('#scene');
  const old = $('#sceneImg');
  const src = phaseArt?.src || imgSrc(id);
  const copy = $('#sceneCopy');
  copy.style.animation = 'none';
  void copy.offsetWidth;
  copy.style.animation = '';
  $('#sceneTag').textContent = `CASE ${a.no} · ${st.puzzle.tag}`;
  $('#sceneTitle').textContent = st.puzzle.title;
  $('#sceneTagline').textContent = a.tagline;
  if (!src) {
    old.removeAttribute('src');
    old.classList.remove('loaded');
    scene.classList.remove('has-img');
    return;
  }
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (sceneFor !== sceneKey) return;
    old.src = src;
    old.alt = phaseArt?.alt || a.alt;
    old.style.objectPosition = phaseArt?.pos || a.pos;
    old.classList.add('loaded');
    scene.classList.add('has-img');
  };
  img.onerror = () => {
    if (sceneFor !== sceneKey) return;
    old.classList.remove('loaded');
    scene.classList.remove('has-img');
  };
  img.src = src;
}

function enterRoom(st) {
  try { localStorage.setItem('ts_seen_openings', JSON.stringify({ ...seenOpenings(), [st.puzzle.id]: true })); } catch {}
  sceneFor = null;
  render(st);
  setScene(st);
  renderJudge(st.log.at(-1) ? { ...st.log.at(-1), no: countedNo(st, st.log.length - 1) } : null);
  show('room');
  setupFold();
  if (st.status !== 'playing') return showEnd(st);
  if (matchMedia('(min-width:761px)').matches) $('#q').focus();
}
$('#btnStoryReplay').addEventListener('click', () => { if (S && !busy && S.status === 'playing') { gameSound.unlock(); presentIntro(S); } });
const countedNo = (st, idx) => st.log.slice(0, idx + 1).filter((l) => l.counted).length;

function renderControls(st) {
  if (!st) return;
  const over = st.status !== 'playing', noQ = st.remaining <= 0, waiting = busy || Boolean(room.data?.busy);
  $('#q').disabled = over || noQ;
  $('#btnAsk').disabled = over || noQ || waiting;
  $('#btnMic').disabled = over || noQ;
  $('#btnHint').disabled = over || st.hintsLeft <= 0 || waiting;
  $('#btnSubmit').disabled = over || waiting;
  $('#btnGiveup').disabled = waiting || (room.active && !room.host);
  $('#btnSwap').disabled = waiting || (room.active && !room.host);
  $('#q').placeholder = noQ ? '提问次数已用完，请提交推理' : waiting && room.data?.busy ? `${room.data.busy.by} 正在提问…` : '你想确认什么？';
}

// 推理室数据渲染（只用真实状态）
function render(st, { flashIds = [], newIds = [] } = {}) {
  S = st;
  atmosphere.update(st);
  setScene(st);
  $('#surface').textContent = st.puzzle.surface;
  $('#qleft').textContent = st.remaining;
  $('#qmax').textContent = st.maxQ;
  $('#counter').classList.toggle('low', st.remaining <= 8);
  $('#hleft').textContent = `${st.hintsLeft} / 3`;
  $('#sleft').textContent = `剩 ${st.submitsLeft}`;
  $('#noteCount').textContent = st.clues.length + (st.exclusions?.length || 0);
  const over = st.status !== 'playing';
  $('.room-live').innerHTML = `<span></span>${over ? '本局已结案' : '推理进行中'}`;
  renderControls(st);

  // 提示（真实已用提示）
  $('#hintList').innerHTML = st.hints.map((h, i) => `<div class="hint-item"><b>提示 ${i + 1}</b><span>${esc(h)}</span></div>`).join('');

  // 进度（400ms 过渡，只跟随真实值）
  $('#prog').textContent = st.progress + '%';
  $('#progFill').style.width = st.progress + '%';
  $('#noteCaption').textContent = st.clues.length || st.exclusions?.length ? `已确认 ${st.clues.length} 项关键事实 · 已排除 ${st.exclusions?.length || 0} 个方向` : '从一个问题开始，确认与排除都会留下记录。';
  $('#dims').innerHTML = st.dims.filter((d) => d.got > 0).map((d) => `<span class="dim ${d.got === d.total ? 'full' : ''}">${esc(d.name)} ${d.got}/${d.total}</span>`).join('');
  $('#dims').classList.toggle('hidden', !st.clues.length);

  // 线索卡：仅已解锁事实
  $('#clues').innerHTML = st.clues
    .map((c, i) => `
      <article class="evidence-card ${newIds.includes(c.id) ? 'new' : ''} ${flashIds.includes(c.id) ? 'flash' : ''}" data-fid="${esc(c.id)}">
 <div class="evidence-top"><span>${pad2(i + 1)} / ${esc(c.dim)}</span><span>+${c.weight}%</span></div>
        <p>${esc(c.card)}</p><span class="evidence-verdict">${c.source === 'submission' ? '推理中已确认' : `裁判确认：${esc(c.label || '是')}`}</span>
        <div class="evidence-source">${c.no ? `第 ${pad2(c.no)} 次提问` : '来自已提交的推理'}</div>
      </article>`)
    .join('');
  if (flashIds.length) setTimeout(() => document.querySelectorAll('.evidence-card.flash').forEach((e) => e.classList.remove('flash')), 1200);
  const exclusions = st.exclusions || [];
  $('#excludedSection').classList.toggle('hidden', !exclusions.length);
  $('#excludedCount').textContent = exclusions.length;
  $('#exclusions').innerHTML = exclusions.map((e) => `<article class="exclusion-card"><span>第 ${pad2(e.no || 0)} 问 · 已排除</span><p>${esc(e.q)}</p><b>裁判回答：否</b></article>`).join('');

  $('#gapBox').innerHTML = st.gaps
    ? `<div class="gap-box">上次推理得分 <b>${st.gaps.score}%</b>${st.gaps.comment ? '。' + esc(st.gaps.comment) : ''}<br>还差：<b>${st.gaps.dims.map(esc).join('、')}</b> 方面</div>`
    : '';
  $('#noteEmpty p').innerHTML = st.clues.length
    ? '下一项事实，藏在你的问题里。<br>已确认的线索会继续收录在这里。'
    : '排除错误方向，也是推理的一部分。<br>接着确认故事里的异常。';
  $('#noteEmpty').classList.toggle('hidden', st.progress >= 100 || exclusions.length > 0);
  $('#noteEmpty').classList.toggle('has-facts', st.clues.length > 0);
  $('#nudges').innerHTML = st.progress < 100 ? st.nudges.map((n) => `<div class="nudge">${esc(n)}</div>`).join('') : '';

  // 提问记录（真实历史，最新在上）
  $('#logCount').textContent = st.log.length ? `(${st.log.length})` : '';
  let n = 0;
  const rows = st.log.map((l) => {
    if (l.counted) n++;
    const star = l.newClues?.length ? '<span class="star" title="收录了关键事实">✦</span>' : '';
    return `<li data-q="${esc(l.q)}"><span class="n">${l.counted ? pad2(n) : '—'}</span><span class="q">${star}${esc(l.q)}${room.active ? `<span class="player-by">${esc(l.by || '玩家')}</span>` : ''}${l.reason ? `<span class="r">${esc(l.reason)}${l.counted ? '' : ' · 未扣次数'}</span>` : ''}</span><button type="button" class="a a-${l.verdict}" data-replay="${esc(l.label)}" title="重播裁判回答">${esc(l.label)}</button></li>`;
  });
  $('#log').innerHTML = rows.length ? rows.reverse().join('') : '<li class="log-empty">还没有提问。</li>';
}

function hostBadge(status = '主持人') {
  return `<figure class="host-presence"><div class="host-portrait"><span aria-hidden="true">汤</span><img src="img/judge.jpg" alt="推理室主持人" onerror="this.remove()" /></div><figcaption><span class="host-name">主持人</span><span class="host-status">${esc(status === '主持人' ? '裁判在线' : status)}</span></figcaption></figure>`;
}

// 当前回合是主舞台：主持人、玩家的问题、明确的裁判回应。
function renderJudge(l, thinkingQ, thinkingBy = '你') {
  const j = $('#judge');
  if (thinkingQ) {
    j.className = 'judge thinking-scene';
    j.innerHTML = `
      ${hostBadge('正在判断')}
      <div class="turn-question"><div class="question-meta"><span class="tiny-dot"></span><span>第 ${pad2(((S && S.maxQ - S.remaining) || 0) + 1)} 次提问 · ${esc(thinkingBy)}</span></div>
      <h2 class="question-text">${esc(withQ(thinkingQ))}</h2></div>
      <div class="answer"><div class="thinking">正在判断<span class="dots"></span></div></div>`;
    return;
  }
  if (!l) {
    j.className = 'judge empty';
    j.innerHTML = `<div class="judge-empty">${hostBadge('轮到你提问')}<h2>这件事，哪里说不通？</h2><p>从一个「是 / 否」问题开始。</p><span class="idle-caption">真相，藏在下一问。</span></div>`;
    return;
  }
  const label = l.label;
  const long = label.length > 2;
  const fresh = l.newClues?.length;
  const again = !fresh && l.reClues?.length;
  const notice = fresh
    ? `<button type="button" class="fact-notice" data-go="clues"><span>✦</span><span>已收录 ${l.newClues.length} 项关键事实</span><span>→</span></button>`
    : again
      ? `<button type="button" class="fact-notice again" data-go="clues"><span>◇</span><span>这项事实已在卷宗中</span><span>→</span></button>`
      : l.verdict === 'no' ? '<button type="button" class="fact-notice excluded" data-go="clues"><span>◇</span><span>已记入排除记录</span><span>→</span></button>' : '';
  j.className = 'judge answer-scene';
  j.innerHTML = `
    ${hostBadge('主持人')}
    <div class="turn-question"><div class="question-meta"><span class="tiny-dot"></span><span>${l.counted ? `第 ${pad2(l.no)} 次提问` : '未计入次数'} · ${esc(l.by || '你')}</span></div>
    <h2 class="question-text">${esc(withQ(l.q))}</h2>
    </div>
    <div class="answer reveal"><strong class="v-${l.verdict} ${long ? 'long' : ''}">${esc(label)}</strong><div class="subtle">${l.verdict === 'unknown' && l.counted ? '故事没有交代' : VERDICT_SUB[l.verdict] || ''}</div></div>
    ${l.reason && l.verdict !== 'unknown' ? `<div class="reason-line">${esc(l.reason)}</div>` : ''}${notice}`;
}
const withQ = (q) => (/[?？]$/.test(q) ? q : q + '？');

// 长汤面折叠
function setupFold() {
  const strip = $('.story-strip');
  strip.classList.remove('folded');
  const p = $('#surface');
  const lh = parseFloat(getComputedStyle(p).lineHeight) || 29;
  const long = p.scrollHeight > lh * 4.2;
  $('#btnFold').classList.toggle('hidden', !long);
  if (long) {
    strip.classList.add('folded');
    $('#btnFold').firstChild.textContent = '展开全文';
  }
}
$('#btnFold').addEventListener('click', () => {
  const strip = $('.story-strip');
  const folded = strip.classList.toggle('folded');
  $('#btnFold').firstChild.textContent = folded ? '展开全文' : '收起';
});

// ================= 事件：提问 / 提示 / 提交 / 放弃 / 换题 =================
$('#askForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q || busy || !S || room.data?.busy) return;
  if (room.active) {
    busy = true; renderControls(S);
    try { await room.action('ask', { q }); $('#q').value = ''; }
    catch (err) { toast(err.message); }
    finally { busy = false; renderControls(S); } return;
  }
  busy = true;
  $('#btnAsk').disabled = true;
  renderJudge(null, q);
  try {
    const st = await api('ask', { sid: S.sid, q });
    $('#q').value = '';
    if (st.notice) {
      render(st);
      const j = $('#judge');
      j.className = 'judge empty';
      j.innerHTML = `<div class="judge-empty">${hostBadge('重复提问 · 不扣次数')}<h2>${esc(withQ(q))}</h2><p>${esc(st.notice)}</p></div>`;
    } else {
      const l = st.last;
      render(st, { newIds: l.newClues || [], flashIds: l.reClues || [] });
      renderJudge({ ...l, no: countedNo(st, st.log.length - 1) });
      speak(l.label);
      if (l.newClues?.length) {
        toast('已收录一项关键事实', 2200, 'good');
        flashLog(l.q);
      }
    }
  } catch (err) {
    toast(err.message);
    const last = S.log.at(-1);
    renderJudge(last ? { ...last, no: countedNo(S, S.log.length - 1) } : null);
  } finally {
    busy = false;
    renderControls(S);
    if (S.status === 'playing' && matchMedia('(min-width:761px)').matches) $('#q').focus();
  }
});
function flashLog(q) {
  const li = [...document.querySelectorAll('#log li')].find((x) => x.dataset.q === q);
  if (!li) return;
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 1400);
}
$('#judge').addEventListener('click', (e) => {
  if (!e.target.closest('[data-go="clues"]')) return;
  switchTab('clues');
  if (matchMedia('(max-width:760px)').matches) $('#notebook').classList.add('open');
  const card = S?.log.at(-1)?.verdict === 'no' ? document.querySelector('.exclusion-card:last-child') : document.querySelector('.evidence-card:last-child');
  card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#btnHint').addEventListener('click', async () => {
  if (busy || !S) return;
  try {
    if (room.active) { await room.action('hint'); toast('共享提示已出现在汤面下方'); return; }
    render(await api('hint', { sid: S.sid }));
    toast('提示已出现在汤面下方');
  } catch (err) {
    toast(err.message);
  }
});

$('#btnSubmit').addEventListener('click', () => {
  $('#ansCount').textContent = $('#answer').value.length;
  $('#submitDlg').showModal();
});
$('#answer').addEventListener('input', () => ($('#ansCount').textContent = $('#answer').value.length));
$('#submitForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const answer = $('#answer').value.trim();
  if (!answer) return toast('先写下你的推理');
  const btn = $('#btnDoSubmit');
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.textContent = '裁判审阅中…';
  try {
    if (room.active) { await room.action('submit', { answer }); $('#submitDlg').close(); return; }
    const st = await api('submit', { sid: S.sid, answer });
    $('#submitDlg').close();
    render(st);
    if (st.status !== 'playing') startReveal(st);
    else toast(`还差一点：得分 ${st.result.score}%，还剩 ${st.submitsLeft} 次提交机会`, 4500);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
});

$('#btnGiveup').addEventListener('click', async () => {
  if (!S) return;
  if (S.status === 'playing' && !confirm('确定放弃？汤底会直接揭晓。')) return;
  try {
    if (room.active) { await room.action('giveup'); return; }
    const st = await api('giveup', { sid: S.sid });
    render(st);
    startReveal(st);
  } catch (err) {
    toast(err.message);
  }
});
function leaveRoom(target = 'home') {
  if (busy) { toast('裁判正在处理，请稍等片刻'); return false; }
  (target === 'lobby' ? showLobby() : showHome()).catch((err) => toast(err.message));
  return true;
}
$('#btnSwap').addEventListener('click', async () => { if (room.active) { try { await room.action('reset'); await showHome(); } catch (err) { toast(err.message); } } else leaveRoom(); });
for (const id of ['#navHome', '#crumbHome'])
  $(id).addEventListener('click', (e) => {
    e.preventDefault();
    if (view === 'room') leaveRoom();
    else showHome();
  });
for (const id of ['#toHome', '#navLobby']) $(id).addEventListener('click', (e) => {
  e.preventDefault();
  leaveRoom('lobby');
});
$('#navRoom').addEventListener('click', (e) => {
  e.preventDefault();
  if (!busy && S?.status === 'playing') enterRoom(S);
});

// 卷宗栏：标签页 + 手机抽屉
function switchTab(name) {
  document.querySelectorAll('.note-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $('#tab-clues').classList.toggle('hidden', name !== 'clues');
  $('#tab-log').classList.toggle('hidden', name !== 'log');
}
document.querySelectorAll('.note-tabs .tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('#btnNotes').addEventListener('click', () => $('#notebook').classList.add('open'));
$('#noteClose').addEventListener('click', () => $('#notebook').classList.remove('open'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#notebook').classList.remove('open');
});

// ================= 结案 =================
function startReveal(st) {
  if (st.status === 'playing' || !st.reveal?.truth) return;
  S = st; stopSpeech();
  atmosphere.update(st);
  cinematicMode = 'reveal';
  introParts = revealParts(st.reveal.truth);
  introCursor = 0; introFinishing = false;
  introAuto = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  markPlayed(st.puzzle.id, st.status);
  $('#introTitle').textContent = `${st.puzzle.title} / 真相揭晓`;
  $('#introText').classList.add('reveal-text');
  $('#btnIntroBack').textContent = '← 查看卷宗';
  $('#btnIntroEnter').innerHTML = '直接看汤底 <svg><use href="#i-arrow"/></svg>';
  show('intro'); renderIntro(); $('#btnIntroNext').focus({ preventScroll: true });
}
function showEnd(st) {
  S = st;
  atmosphere.update(st);
  markPlayed(st.puzzle.id, st.status);
  const record = saveRecord(localStorage, st);
  const a = artOf(st.puzzle.id);
  const meta = STATUS[st.status] || STATUS.gaveup;
  const r = st.reveal;
  const review = buildReview(st);
  const recommendation = recommendNext(META.puzzles, st, played());
  const recommended = recommendation?.puzzle;
  const scoreCell = st.stats.score != null ? `<div><strong>${st.stats.score}%</strong><span>推理得分</span></div>` : `<div><strong>${st.stats.submits}</strong><span>提交次数</span></div>`;
  $('#endCase').innerHTML = `
    <div class="end-art">${artBox(st.puzzle.id, st.puzzle.title, { eager: true, pos: a.endPos, source: atmosphereArt(st)?.src })}
      <div class="end-art-copy"><div class="eyebrow">CASE ${a.no} / 案件归档</div><h2>${esc(st.puzzle.title)}</h2></div></div>
    <div class="end-paper">
      <div class="eyebrow">THE CASE FILE · 结案</div>
      <h1>${meta.head}</h1>
      <span class="verdict-badge ${esc(st.status)}">${meta.badge}</span>
      <p class="end-lead">${meta.lead}</p>
      <div class="end-stats">
        <div><strong>${st.stats.used}</strong><span>本局提问</span></div>
 <div><strong>${st.stats.hints}</strong><span>使用提示</span></div>
        <div><strong>${st.progress}%</strong><span>真相还原度</span></div>
        ${scoreCell}
      </div>
      <div class="record-summary">${record?.best ? `<strong>本机最佳：${record.best.used} 问结案 · 使用 ${record.best.hints} 次提示</strong>` : '本局已经归档，下一次试着用更少的问题还原真相。'}${recommended ? `<p>下一宗 · ${esc(recommended.title)}<br><span>${esc(recommendation.reason)}</span></p>` : '<p>当前卷宗已全部翻开，可以回档案库重温。</p>'}</div>
      ${review ? `<section class="end-review"><h2>你的推理路线</h2><p class="review-summary">${esc(review.summary)}</p>${review.breakthroughs.length ? `<ol class="review-breakthroughs">${review.breakthroughs.map((item, i) => `<li><span>${i === 0 ? '首次突破' : '继续接近'} · 第 ${pad2(item.no)} 问</span><p>${esc(item.q)}</p><small>裁判回答「${esc(item.label)}」 · 确认 ${item.count} 项关键事实</small></li>`).join('')}</ol>` : '<p class="review-empty">这次还没有通过提问确认关键事实，可以对照汤底回看问法。</p>'}${review.exclusions.length ? `<details class="review-exclusions"><summary>你排除的猜测 · ${review.exclusions.length} 条</summary>${review.exclusions.map((item) => `<p><span>第 ${pad2(item.no)} 问 · 否</span>${esc(item.q)}</p>`).join('')}</details>` : ''}<p class="review-footnote">${[review.stats.repeatedFact ? `重新确认已知线索 ${review.stats.repeatedFact} 次` : '', review.stats.invalid ? `调整问法 ${review.stats.invalid} 次` : '', review.stats.unknown ? `遇到故事未交代的问题 ${review.stats.unknown} 次` : ''].filter(Boolean).join(' · ') || '每个问题，都是这次推理的一部分。'}</p></section>` : ''}
      <section class="end-section"><h3><span class="step-number">1</span>汤面</h3><p class="truth">${esc(st.puzzle.surface)}</p></section>
      <section class="end-section"><h3><span class="step-number">2</span>完整汤底</h3><p class="truth">${esc(r.truth)}</p></section>
      ${r.found.length ? `<section class="end-section"><h3><span class="step-number">3</span>你已确认的事实</h3><ul class="fact-list found">${r.found.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
      ${r.missed.length ? `<section class="end-section"><h3><span class="step-number">${r.found.length ? 4 : 3}</span>${st.status === 'won' ? '没有问到、但已在推理中补全的部分' : '还没有挖到的部分'}</h3><ul class="fact-list missed">${r.missed.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
      <div class="end-actions">
        <button type="button" class="button dark" id="btnAgain">${recommended ? '下一宗 · ' + esc(recommended.title) : '回到档案库'} <svg class="arrow"><use href="#i-arrow"/></svg></button>
        <button type="button" class="button secondary" id="btnReview">回看问答</button>
        <button type="button" class="button quiet" id="btnShare"><svg><use href="#i-share"/></svg>分享战绩</button>
      </div>
    </div>`;
  show('end');
  $('#btnAgain').onclick = () => {
    if (room.active) { if (!room.host) return toast('等待房主开启下一宗卷宗'); room.action('reset').catch((e) => toast(e.message)); return; }
    localStorage.removeItem('ts_sid');
    S = null;
    if (recommended) showLobby(recommended.id).catch((err) => toast(err.message));
    else showHome().catch((err) => toast(err.message));
  };
  $('#btnReview').onclick = () => {
    sceneFor = null;
    render(st);
    setScene(st);
    const last = st.log.at(-1);
    renderJudge(last ? { ...last, no: countedNo(st, st.log.length - 1) } : null);
    switchTab('log');
    show('room');
    if (matchMedia('(max-width:760px)').matches) $('#notebook').classList.add('open');
  };
  $('#btnShare').onclick = share;
}
async function share() {
  if (!S?.stats) return room.active ? inviteRoom() : undefined;
  const snapshot = structuredClone(S), url = challengeUrl();
  const button = $('#btnShare'); if (button) button.disabled = true;
  try {
    const blob = await makeShareCard(snapshot, atmosphereArt({ ...snapshot, status: 'playing', sceneStage: 'quiet' })?.src || imgSrc(snapshot.puzzle.id), url);
    if (shareBlobUrl) URL.revokeObjectURL(shareBlobUrl);
    shareBlobUrl = URL.createObjectURL(blob);
    shareDetails = { title: snapshot.puzzle.title, text: `${challengeText(snapshot)}\n${url}` };
    $('#shareCardPreview').src = shareBlobUrl;
    $('#shareDlg').showModal();
  } catch (err) { toast(err.message); }
  finally { if (button) button.disabled = false; }
}
let shareBlobUrl = '';
let shareDetails = null;
function challengeUrl() {
  const link = new URL(location.pathname, location.origin);
  if (S?.puzzle.id || selectedId) link.searchParams.set('case', S?.puzzle.id || selectedId);
  return link.href;
}
$('#btnShareClose').addEventListener('click', () => $('#shareDlg').close());
$('#btnCopyChallenge').addEventListener('click', async () => {
  const text = shareDetails?.text; if (!text) return;
  try {
    await navigator.clipboard.writeText(text); toast('无剧透挑战链接已复制');
  } catch { prompt('复制这段挑战邀请：', text); }
});
$('#btnSaveCard').addEventListener('click', () => {
  if (!shareBlobUrl) return;
  const anchor = document.createElement('a'); anchor.href = shareBlobUrl; anchor.download = `今晚喝什么汤-${shareDetails?.title || '案件'}-战绩.png`; anchor.click();
});

// ================= 语音：裁判播报 + 语音输入 =================
let voiceOn = localStorage.getItem('ts_voice') !== '0';
let speechSequence = 0;
let speechPending = false;
const narrator = new Narrator({ context: () => ({ sid: S?.sid, room: room.data?.code, speech: { ...META?.speech, previewSrc: 'audio/welcome-tonight-20261108.mp3' }, code: $('#code').value.trim() }), duck: (v) => { gameSound.setDucked(v); document.body.classList.toggle('host-speaking', v); }, error: (msg) => toast(msg, 4500) });
document.addEventListener('click', () => { if (voiceOn) narrator.unlock(); }, { capture: true });
document.addEventListener('keydown', () => { if (voiceOn) narrator.unlock(); }, { capture: true });
function paintVoice() {
  $('#btnVoice use').setAttribute('href', voiceOn ? '#i-sound' : '#i-mute');
  $('#btnVoice').setAttribute('aria-pressed', String(voiceOn));
  $('#btnVoice').title = voiceOn ? '裁判语音播报：开' : '裁判语音播报：关';
  $('#btnIntroVoice use').setAttribute('href', voiceOn ? '#i-sound' : '#i-mute');
  $('#btnIntroVoice').setAttribute('aria-pressed', String(voiceOn));
  $('#btnIntroVoice').setAttribute('aria-label', voiceOn ? '关闭语音播报' : '开启语音播报');
  $('#voiceSetting').checked = voiceOn;
}
paintVoice();
function toggleVoice() {
  voiceOn = !voiceOn;
  localStorage.setItem('ts_voice', voiceOn ? '1' : '0');
  paintVoice();
  toast(voiceOn ? '裁判语音播报：开' : '裁判语音播报：关');
  if (!voiceOn) { stopSpeech(); queueIntro(); }
  else {
    narrator.unlock();
    if (view === 'intro' && introCursor < introParts.length) speak(introParts[introCursor]);
  }
}
$('#btnVoice').addEventListener('click', toggleVoice);
$('#btnIntroVoice').addEventListener('click', toggleVoice);
function speak(text) {
  if (!voiceOn || document.hidden) return;
  if (view === 'intro') clearTimeout(introTimer);
  const token = ++speechSequence;
  speechPending = true;
  narrator.say(text).then((played) => { if (token === speechSequence) { speechPending = false; introNarrated = played; queueIntro(); } });
}
function stopSpeech() { speechSequence++; speechPending = false; narrator.stop(); }
let resumeNarration = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { resumeNarration = view === 'intro' && voiceOn && speechPending; stopSpeech(); }
  else {
    if (resumeNarration && view === 'intro' && voiceOn && introCursor < introParts.length) { clearTimeout(introTimer); introNarrated = false; speak(introParts[introCursor]); }
    resumeNarration = false;
  }
});

// 音乐和语音是两条独立音轨；只在玩家操作后开始播放。
function paintSound() {
  $('#musicEnabled').checked = gameSound.enabled;
  $('#musicStatus').textContent = !gameSound.enabled ? '音乐已关闭' : gameSound.error ? '点击页面重试播放' : gameSound.playing ? '音乐播放中' : gameSound.unlocked ? '音乐已暂停' : '点击页面后播放';
  $('#btnAudio').classList.toggle('is-playing', gameSound.playing);
}
let audioOpener = null;
function closeSound() {
  $('#audioPanel').classList.add('hidden');
  for (const id of ['#btnAudio', '#btnIntroAudio']) $(id).setAttribute('aria-expanded', 'false');
  queueIntro();
}
for (const id of ['#btnAudio', '#btnIntroAudio']) $(id).addEventListener('click', () => {
  const opening = $('#audioPanel').classList.contains('hidden');
  closeSound();
  if (opening) {
    audioOpener = $(id); $('#audioPanel').classList.remove('hidden');
    clearTimeout(introTimer);
    $(id).setAttribute('aria-expanded', 'true'); paintSound(); $('#musicEnabled').focus();
  }
});
$('#btnAudioClose').addEventListener('click', () => { closeSound(); audioOpener?.focus(); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#audioPanel, #btnAudio, #btnIntroAudio')) closeSound(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#audioPanel').classList.contains('hidden')) { closeSound(); audioOpener?.focus(); } });
$('#musicEnabled').addEventListener('change', (e) => gameSound.setEnabled(e.target.checked));
$('#voiceSetting').addEventListener('change', (e) => { if (e.target.checked !== voiceOn) toggleVoice(); });
$('#log').addEventListener('click', (e) => { const b = e.target.closest('[data-replay]'); if (b) { if (!voiceOn) toggleVoice(); speak(b.dataset.replay); } });
$('#btnIntroReplay').addEventListener('click', () => {
  if (view !== 'intro' || introCursor >= introParts.length) return;
  if (!voiceOn) { voiceOn = true; localStorage.setItem('ts_voice', '1'); paintVoice(); }
  narrator.unlock(); speak(introParts[introCursor]);
});
document.addEventListener('narrator-state-change', (e) => {
  const button = $('#btnIntroReplay');
  button.classList.toggle('needs-replay', e.detail.state === 'error');
  button.title = e.detail.state === 'error' ? '旁白未播放，点击重播本页' : '重新朗读本页';
});
document.addEventListener('game-sound-change', paintSound);
paintSound();
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('#btnMic').classList.add('hidden');
else {
  let rec = null;
  $('#btnMic').addEventListener('click', () => {
    if (rec) return rec.stop();
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.onresult = (e) => ($('#q').value = [...e.results].map((r) => r[0].transcript).join(''));
    rec.onend = () => {
      rec = null;
      $('#btnMic').classList.remove('rec');
    };
    rec.onerror = () => toast('语音识别不可用，请直接输入');
    $('#btnMic').classList.add('rec');
    rec.start();
  });
}

// 手机软键盘：输入框聚焦时保持最新回答与输入区可见
$('#q').addEventListener('focus', () => {
  if (!matchMedia('(max-width:760px)').matches) return;
  setTimeout(() => $('#judge').scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
});

// ================= 启动：始终从房间进入；旧局提供明确的继续入口 =================
async function boot() {
  $('#btnStart').disabled = true;
  try {
    META = await api('meta');
    setMode();
  } catch (err) {
    toast(err.message);
    $('#entryReady').textContent = '暂时连接不上推理室，请重试';
    $('#btnStart').disabled = false;
    $('#btnStart').textContent = '重新连接';
    return;
  }
  const sid = localStorage.getItem('ts_sid');
  if (sid) {
    try {
      const st = await api('state?sid=' + encodeURIComponent(sid));
      if (st.status === 'playing') S = st;
      else localStorage.removeItem('ts_sid');
    } catch (err) {
      if (err.status === 404 || err.status === 410) { localStorage.removeItem('ts_sid'); toast('上次对局已过期或服务器存档已清理，请重新开局', 5500); }
      else toast('暂时无法读取上次对局，稍后刷新可重试', 4500);
    }
  }
  const requested = new URLSearchParams(location.search).get('case');
  const invited = new URLSearchParams(location.search).get('room');
  await showLobby(requested || localStorage.getItem('ts_case') || S?.puzzle.id);
  if (META.rooms) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('ts_room')); } catch {}
    if (invited && invited !== saved?.code) openRoomDialog(invited);
    else if (saved?.code) { try { await room.join(saved.code, saved.name); } catch (e) { localStorage.removeItem('ts_room'); toast(e.message); } }
    paintRoom();
  }
}
boot().catch((err) => toast(err.message));
