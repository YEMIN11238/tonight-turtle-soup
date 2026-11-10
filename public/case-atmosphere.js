// 只消费服务器已经公开的叙事阶段，不从进度百分比猜测隐藏剧情。
const CASE_STAGES = Object.freeze({
  'second-cake': {
    quiet: { src: 'assets/second-cake-quiet.webp', alt: '两只熄灭蜡烛的蛋糕，桌后是一扇普通的旧木门', pos: '64% 50%', title: '', detail: '' },
    presence: { src: 'assets/second-cake-quiet.webp', alt: '昏暗的桌边，视线停在紧闭的旧木门上', pos: '70% 50%', title: '门后，有人。', detail: '你已确认地下室里有活人。' },
    locked: { src: 'assets/second-cake-locked.webp', alt: '灯光照亮旧木门上的外锁，两只蛋糕留在桌边', pos: '66% 50%', title: '有人被困在这里。', detail: '你已确认那个人无法自由离开。' },
    revealed: { src: 'assets/second-cake-revealed.webp', alt: '木门已经打开，门后空椅隐约可见，蛋糕仍在桌上', pos: '70% 50%', title: '门，终于打开了。', detail: '这段故事已经有了答案。' },
  },
  'rainy-elevator': {
    quiet: { src: 'assets/rainy-elevator.webp', alt: '雨夜老楼里关闭的铜色电梯门', pos: '64% 50%', title: '', detail: '' },
    watched: { src: 'assets/rainy-elevator-watched.webp', alt: '铜色电梯门旁的按钮面板与紧闭门缝', pos: '66% 50%', thumbPos: '87% 45%', title: '他知道那个楼层。', detail: '你已确认他早已知道她真实住在哪一层。' },
    followed: { src: 'assets/rainy-elevator-watched.webp', alt: '低光下的电梯按钮与紧闭门缝', pos: '73% 50%', thumbPos: '87% 45%', title: '这次相遇，早有来路。', detail: '你已确认他此前尾随过她。' },
    revealed: { src: 'assets/rainy-elevator-revealed.webp', alt: '同一座老楼里打开的空电梯门', pos: '68% 50%', title: '那声招呼，有了另一种意思。', detail: '这段故事已经有了答案。' },
  },
  'after-curtain': {
    quiet: { src: 'assets/after-curtain.webp', alt: '散场后的空剧院与紧闭的旧幕布', pos: '65% 50%', title: '', detail: '' },
    unpowered: { src: 'assets/after-curtain-unpowered.webp', alt: '空舞台一角，断电的录音设备没有亮灯', pos: '67% 50%', thumbPos: '90% 60%', title: '断电以后，掌声仍在。', detail: '你已确认掌声不来自已关闭的录音设备。' },
    below: { src: 'assets/after-curtain-below.webp', alt: '旧舞台台板与下方紧闭的检修门', pos: '67% 50%', thumbPos: '80% 60%', title: '台板下面，有人。', detail: '你已确认舞台下有活人。' },
    revealed: { src: 'assets/after-curtain-below.webp', alt: '旧舞台下幽深的检修空间与木板门', pos: '73% 50%', thumbPos: '80% 60%', title: '再听一次，已经不同。', detail: '这段故事已经有了答案。' },
  },
});
const stagesFor = (st) => st?.puzzle && Object.hasOwn(CASE_STAGES, st.puzzle.id) ? CASE_STAGES[st.puzzle.id] : null;

export function atmosphereStage(st) {
  const stages = stagesFor(st);
  if (!stages) return null;
  const stage = Object.hasOwn(stages, st.sceneStage) ? st.sceneStage : 'quiet';
  // 对旧会话 / 错误响应也不在正在推理时使用结案画面。
  return stage === 'revealed' && !['won', 'lost', 'gaveup'].includes(st.status) ? 'quiet' : stage;
}

export function atmosphereArt(st) {
  const stage = atmosphereStage(st);
  return stage ? { ...stagesFor(st)[stage] } : null;
}

export function createCaseAtmosphere({ sound } = {}) {
  return new CaseAtmosphere(sound);
}

class CaseAtmosphere {
  constructor(sound) {
    this.sound = sound;
    this.view = document.body.dataset.view || 'lobby';
    this.state = null;
    this.session = null;
    this.stage = null;
    this.sequence = 0;
    this.audioNodes = new Set();
    this.audioTimers = new Set();
    this.heard = new Set();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.onGesture = (event) => {
      if (!event.isTrusted || !this.sound?.enabled || document.hidden) return;
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (!AudioEngine) return;
      this.context ??= new AudioEngine();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    };
    this.onVisibility = () => { if (document.hidden) this.stopSound(); };
    this.onSoundChange = () => {
      if (!sound?.enabled || document.hidden || sound?.volume === 0) this.stopSound();
      else if (sound?.ducked || sound?.conversation) this.stopAudio();
      else if (this.master && this.context) this.master.gain.setTargetAtTime(Math.min(.24, sound.volume * .55), this.context.currentTime, .08);
    };
    this.onPageHide = () => this.stopSound();
    for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, this.onGesture, { capture: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('game-sound-change', this.onSoundChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  ensureElements() {
    const scene = document.querySelector('#scene');
    const main = document.querySelector('#viewRoom .room-main');
    if (!scene || !main) return false;
    if (!this.layer) {
      this.layer = document.createElement('div');
      this.layer.className = 'case-atmosphere-layer';
      this.layer.setAttribute('aria-hidden', 'true');
      this.layer.innerHTML = '<img alt=""><div class="case-atmosphere-light"></div>';
      scene.append(this.layer);
    }
    if (!this.note) {
      this.note = document.createElement('section');
      this.note.className = 'case-atmosphere-note';
      this.note.hidden = true;
      this.note.setAttribute('aria-label', '现场变化');
      this.note.innerHTML = '<img alt=""><div><span class="case-atmosphere-kicker">现场变化</span><p></p><small></small></div><span class="case-atmosphere-mark" aria-hidden="true">◈</span>';
      // 标签持续可读，现场字幕只在新发现时由无障碍直播区播报。
      this.live = document.createElement('span');
      this.live.className = 'case-atmosphere-sr';
      this.live.setAttribute('role', 'status');
      this.live.setAttribute('aria-live', 'polite');
      this.note.append(this.live);
      main.prepend(this.note);
    }
    const intro = document.querySelector('#viewIntro');
    if (intro && !this.cinematic) {
      this.cinematic = document.createElement('div');
      this.cinematic.className = 'case-atmosphere-cinematic';
      this.cinematic.setAttribute('aria-hidden', 'true');
      this.cinematic.hidden = true;
      intro.prepend(this.cinematic);
    }
    return true;
  }

  update(st) {
    const next = atmosphereStage(st);
    const session = next ? `${st.puzzle.id}:${st.sid}` : null;
    const previous = this.session === session ? this.stage : null;
    const changed = previous !== null && next !== previous;
    if (session !== this.session) {
      this.stopSound();
      this.heard.clear();
    }
    this.state = st;
    this.session = session;
    this.stage = next;
    if (!this.ensureElements()) return;
    const room = document.querySelector('#viewRoom');
    if (!next) {
      this.sequence++;
      this.layer.classList.remove('visible', 'changing');
      this.imageSource = null;
      delete this.layer.dataset.ready;
      this.note.hidden = true;
      if (this.cinematic) this.cinematic.hidden = true;
      delete room.dataset.atmosphere;
      delete room.dataset.atmosphereCase;
      this.stopSound();
      return;
    }
    room.dataset.atmosphere = next;
    room.dataset.atmosphereCase = st.puzzle.id;
    this.paint(next);
    if (changed && next !== 'quiet' && this.view === 'room' && !document.hidden && !this.heard.has(next)) {
      this.heard.add(next);
      this.live.textContent = stagesFor(st)[next].detail;
      this.note.classList.remove('arriving');
      this.layer.classList.remove('changing');
      if (!this.reduced.matches) {
        void this.note.offsetWidth;
        this.note.classList.add('arriving');
        this.layer.classList.add('changing');
      }
      this.queueSound(next);
    }
    this.applyVisibility();
  }

  paint(stage) {
    const art = stagesFor(this.state)[stage];
    if (this.cinematic) this.cinematic.style.backgroundImage = `url("${art.src}")`;
    this.note.hidden = stage === 'quiet';
    this.note.querySelector('p').textContent = art.title;
    this.note.querySelector('small').textContent = art.detail;
    const thumb = this.note.querySelector('img');
    thumb.src = art.src;
    thumb.style.objectPosition = art.thumbPos || (stage === 'locked' ? '73% 47%' : '84% 50%');
    // 初始背景由 setScene 使用 atmosphereArt；这个第二层只负责柔和的交叉淡入。
    if (this.imageSource === art.src) {
      this.layer.querySelector('img').style.objectPosition = art.pos;
      return;
    }
    this.imageSource = art.src;
    const sequence = ++this.sequence;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (sequence !== this.sequence) return;
      const target = this.layer.querySelector('img');
      this.layer.querySelector('.case-atmosphere-previous')?.remove();
      let previous = null;
      if (target.getAttribute('src') && !this.reduced.matches && this.view === 'room') {
        previous = target.cloneNode();
        previous.className = 'case-atmosphere-previous';
        this.layer.insertBefore(previous, this.layer.querySelector('.case-atmosphere-light'));
      }
      target.src = art.src;
      target.style.objectPosition = stagesFor(this.state)?.[this.stage]?.pos || art.pos;
      this.layer.dataset.ready = 'true';
      this.applyVisibility();
      if (previous) {
        void previous.offsetWidth;
        previous.style.opacity = '0';
        previous.addEventListener('transitionend', () => previous.remove(), { once: true });
      }
    };
    image.onerror = () => {
      if (sequence !== this.sequence) return;
      delete this.layer.dataset.ready;
      this.layer.classList.remove('visible');
    };
    image.src = art.src;
  }

  setView(view) {
    this.view = view;
    if (view !== 'room' && view !== 'reveal') this.stopSound();
    if (view === 'reveal' && this.stage === 'revealed' && !this.heard.has('revealed')) {
      this.heard.add('revealed');
      this.queueSound('revealed');
    }
    this.applyVisibility();
  }

  applyVisibility() {
    if (!this.layer) return;
    const visible = this.view === 'room' && Boolean(this.stage);
    if (this.cinematic) this.cinematic.hidden = !this.stage || !['intro', 'reveal'].includes(this.view);
    this.layer.classList.toggle('visible', visible && this.layer.dataset.ready === 'true');
    this.note.hidden = !visible || this.stage === 'quiet';
    if (!visible) this.layer.classList.remove('changing');
  }

  queueSound(stage) {
    this.stopSound();
    const began = performance.now();
    const attempt = () => {
      if (!(this.view === 'room' || this.view === 'reveal' && stage === 'revealed') || document.hidden || !this.sound?.enabled || this.stage !== stage) return;
      if (this.sound.ducked || this.sound.conversation) {
        if (performance.now() - began < 8000) this.delay(attempt, 250);
        return;
      }
      if (!this.context || this.context.state !== 'running' || this.sound.volume <= 0) return;
      this.playSound(stage);
    };
    // 给简短的裁判语音留出位置；后台 / 关闭音乐时不会积压，之后突然补播。
    this.delay(attempt, 650);
  }

  delay(fn, ms) {
    const id = setTimeout(() => { this.audioTimers.delete(id); fn(); }, ms);
    this.audioTimers.add(id);
  }

  playSound(stage) {
    const ctx = this.context;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = Math.min(.24, this.sound.volume * .55);
    this.master.connect(ctx.destination);
    const now = ctx.currentTime;
    const note = (offset, frequency, duration, gain, type = 'sine', endFrequency = frequency) => {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + offset + duration);
      envelope.gain.setValueAtTime(0, now + offset);
      envelope.gain.linearRampToValueAtTime(gain, now + offset + .025);
      envelope.gain.exponentialRampToValueAtTime(.0001, now + offset + duration);
      oscillator.connect(envelope).connect(this.master);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration + .04);
      this.audioNodes.add(oscillator);
      oscillator.onended = () => { this.audioNodes.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    };
    const id = this.state?.puzzle?.id;
    if (id === 'rainy-elevator') {
      // 低频电机余响和短促继电器触点，与木门/舞台声保持区别。
      if (stage === 'watched') {
        note(0, 63, 1.25, .12, 'triangle', 48);
        note(.62, 360, .085, .085, 'triangle', 190);
      } else if (stage === 'followed') {
        note(0, 58, 1.7, .14, 'triangle', 38);
        note(.35, 280, .11, .07, 'sine', 135);
        note(1.03, 230, .15, .065, 'sine', 110);
      } else if (stage === 'revealed') {
        note(0, 117, 1.6, .09, 'triangle', 43);
        note(.38, 245, .45, .04, 'sine', 95);
      }
    } else if (id === 'after-curtain') {
      // 木台板的短、闷敲击；不在声源揭晓前给出人物、方位或求救节奏。
      if (stage === 'unpowered') {
        note(0, 310, .075, .075, 'triangle', 175);
        note(.72, 83, .2, .16, 'sine', 44);
      } else if (stage === 'below') {
        note(0, 92, .24, .2, 'sine', 42);
        note(.48, 86, .27, .15, 'sine', 40);
        note(1.18, 74, .45, .1, 'triangle', 35);
      } else if (stage === 'revealed') {
        note(0, 79, .3, .12, 'sine', 39);
        note(.74, 64, 1.15, .085, 'sine', 31);
      }
    } else if (stage === 'presence') {
      note(0, 92, .28, .32, 'sine', 56);
      note(.52, 86, .34, .23, 'sine', 50);
    } else if (stage === 'locked') {
      note(0, 246, .95, .12, 'triangle', 104);
      note(.06, 373, .7, .07, 'sine', 189);
      note(.7, 84, .32, .26, 'sine', 45);
    } else if (stage === 'revealed') {
      note(0, 112, 1.8, .12, 'triangle', 46);
      note(.2, 158, 1.5, .065, 'sine', 59);
    }
    this.delay(() => this.stopSound(), 2400);
  }

  stopSound() {
    for (const id of this.audioTimers) clearTimeout(id);
    this.audioTimers.clear();
    this.stopAudio();
  }

  stopAudio() {
    for (const node of this.audioNodes) { try { node.stop(); } catch {} node.disconnect(); }
    this.audioNodes.clear();
    this.master?.disconnect();
    this.master = null;
  }

  destroy() {
    this.stopSound();
    this.sequence++;
    for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, this.onGesture, { capture: true });
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('game-sound-change', this.onSoundChange);
    window.removeEventListener('pagehide', this.onPageHide);
    this.context?.close().catch(() => {});
    this.layer?.remove();
    this.note?.remove();
    this.cinematic?.remove();
    const room = document.querySelector('#viewRoom');
    if (room) { delete room.dataset.atmosphere; delete room.dataset.atmosphereCase; }
  }
}
