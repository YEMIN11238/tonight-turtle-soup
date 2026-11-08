export class RoomClient {
  constructor(onChange, onError) { this.data = null; this.source = null; this.onChange = onChange; this.onError = onError; this.onSignal = () => {}; }
  get active() { return Boolean(this.data); }
  get host() { return this.data?.meId === this.data?.hostId; }
  async request(path, body = {}) {
    const r = await fetch('/api/rooms' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || '房间连接失败'); return j;
  }
  apply(data) { if (!data.code || (this.data?.code === data.code && this.data?.epoch === data.epoch && data.revision < this.data.revision)) return; const old = this.data; this.data = data; this.onChange(data, old); }
  connect(data, name) {
    this.source?.close(); this.apply(data);
    localStorage.setItem('ts_room', JSON.stringify({ code: data.code, name }));
    const source = this.source = new EventSource('/api/rooms/' + data.code + '/events');
    source.addEventListener('room', (e) => { this.apply(JSON.parse(e.data)); document.body.classList.remove('room-reconnecting'); });
    source.addEventListener('signal', (e) => this.onSignal(JSON.parse(e.data)));
    source.onerror = () => document.body.classList.add('room-reconnecting');
    source.onopen = () => document.body.classList.remove('room-reconnecting');
  }
  async create(body) { const d = await this.request('', body); this.connect(d, body.name); return d; }
  async join(code, name) { const d = await this.request('/' + code.toUpperCase() + '/join', { name }); this.connect(d, name); return d; }
  async action(action, body = {}) { const d = await this.request('/' + this.data.code + '/' + action, body); if (d.code) this.apply(d); if (d.notice) this.onError(d.notice); return d; }
  async leave() {
    const code = this.data?.code; this.source?.close(); this.source = null;
    if (code) { try { await this.request('/' + code + '/leave'); } catch {} }
    const old = this.data; this.data = null; localStorage.removeItem('ts_room'); document.body.classList.remove('room-reconnecting'); this.onChange(null, old);
  }
}
