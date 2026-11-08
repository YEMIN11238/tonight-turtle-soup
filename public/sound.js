// 背景音乐独立于裁判语音。两路媒体交叉淡入，避免切曲与循环时突兀中断。
export const MUSIC = Object.freeze([
  { id: 'user-bgm-20261108', label: '自选背景音乐', title: '自选背景音乐', src: 'audio/user-bgm-20261108.mp3', author: '', source: 'audio/CREDITS.txt' },
]);
const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
class GameSound {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ts_music') || '{}'); } catch {}
    this.enabled = saved.enabled !== false;
    this.volume = Number.isFinite(saved.volume) ? clamp(saved.volume) : .22;
    this.trackId = MUSIC.some((t) => t.id === saved.track) ? saved.track : MUSIC[0].id;
    this.phase = 'lobby'; this.ducked = false; this.conversation = false; this.unlocked = false;
    this.active = 0; this.sequence = 0; this.fading = false; this.frame = 0; this.error = '';
    this.decks = [0, 1].map((i) => {
      const a = document.createElement('audio');
      a.id = 'bgm' + i; a.preload = 'none'; a.loop = true; a.volume = 0;
      a.setAttribute('aria-hidden', 'true'); a.hidden = true; document.body.append(a);
      a.addEventListener('timeupdate', () => {
        if (this.decks[this.active] === a && !this.fading && this.enabled && !document.hidden && a.duration > 6 && a.currentTime >= a.duration - 1.7) this.crossfade(this.trackId, 1600);
      });
      for (const event of ['playing', 'pause', 'waiting', 'canplay', 'error']) a.addEventListener(event, () => this.notify());
      return a;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.sequence++; cancelAnimationFrame(this.frame); this.fading = false;
        for (const a of this.decks) { a.pause(); a.volume = 0; }
      } else if (this.enabled && this.unlocked) this.play();
      this.notify();
    });
  }
  get track() { return MUSIC.find((t) => t.id === this.trackId); }
  get target() {
    const phase = { lobby: .65, home: .55, intro: .72, room: 1, reveal: .85, end: .45 }[this.phase] ?? 1;
    return this.enabled && !document.hidden ? this.volume * phase * (this.ducked || this.conversation ? .23 : 1) : 0;
  }
  get playing() { const a = this.decks[this.active]; return this.enabled && !a.paused && !a.ended && !document.hidden; }
  save() { localStorage.setItem('ts_music', JSON.stringify({ enabled: this.enabled, volume: this.volume, track: this.trackId })); }
  notify() { document.dispatchEvent(new CustomEvent('game-sound-change')); }
  ramp(targets, ms, done = () => {}) {
    cancelAnimationFrame(this.frame);
    const start = this.decks.map((a) => a.volume), began = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - began) / Math.max(ms, 1));
      const eased = p * p * (3 - 2 * p), values = targets();
      this.decks.forEach((a, i) => { a.volume = clamp(start[i] + (values[i] - start[i]) * eased); });
      if (p < 1) this.frame = requestAnimationFrame(tick); else { done(); this.notify(); }
    };
    this.frame = requestAnimationFrame(tick);
  }
  mix() {
    if (this.fading) return; // 交叉淡入过程实时读取 target，避免打断切曲。
    this.ramp(() => this.decks.map((_, i) => i === this.active ? this.target : 0), 450, () => {
      this.decks.forEach((a, i) => { if (i !== this.active || !this.enabled) a.pause(); });
    });
  }
  async unlock() { this.unlocked = true; return this.play(); }
  async play() {
    if (!this.enabled || !this.unlocked || document.hidden) return false;
    const a = this.decks[this.active];
    if (a.getAttribute('src') && a.dataset.track !== this.trackId) return this.crossfade(this.trackId, 750);
    if (!a.getAttribute('src')) { a.src = this.track.src; a.dataset.track = this.trackId; }
    try { await a.play(); this.error = ''; this.mix(); this.notify(); return true; }
    catch (err) { this.error = err.name === 'NotAllowedError' ? '点击播放背景音乐' : '音乐暂未加载成功，请重试'; this.notify(); return false; }
  }
  setEnabled(value) {
    this.enabled = Boolean(value); this.save();
    if (this.enabled) this.unlock(); else this.mix();
    this.notify();
  }
  setVolume(value) { this.volume = clamp(value); this.save(); this.mix(); this.notify(); }
  setPhase(value) { this.phase = value; this.mix(); }
  setDucked(value) { this.ducked = Boolean(value); this.mix(); }
  setConversation(value) { this.conversation = Boolean(value); this.mix(); }
  setTrack(id) {
    if (!MUSIC.some((t) => t.id === id) || id === this.trackId) return;
    this.trackId = id; this.save(); this.error = '';
    if (this.enabled && this.unlocked && !document.hidden) this.crossfade(id, 1100);
    else {
      this.sequence++; cancelAnimationFrame(this.frame); this.fading = false;
      for (const a of this.decks) { a.pause(); a.removeAttribute('src'); a.load(); }
    }
    this.notify();
  }
  async crossfade(id, ms) {
    const token = ++this.sequence, old = this.active, next = 1 - old;
    const a = this.decks[next], track = MUSIC.find((t) => t.id === id);
    cancelAnimationFrame(this.frame); this.fading = true;
    a.pause(); a.src = track.src; a.dataset.track = id; a.volume = 0;
    try {
      await a.play();
      if (token !== this.sequence) return;
      this.active = next; this.error = '';
      this.ramp(() => this.decks.map((_, i) => i === next ? this.target : 0), ms, () => {
        this.decks[old].pause();
        if (!this.enabled) a.pause();
        this.fading = false; this.notify();
      });
    } catch {
      if (token !== this.sequence) return;
      this.fading = false; // 原路媒体保留原生循环，自动播放限制下仍可继续播放。
      this.error = id === this.decks[old].dataset.track ? '' : '切曲未成功，点击播放重试';
      this.mix(); this.notify();
    }
  }
}
export const gameSound = new GameSound();
