// 同房间 WebRTC 语音。只在玩家点击后请求麦克风；信令通过已有房间身份校验。
export class RoomVoice {
  constructor(client, { notify, duck }) {
    this.client = client; this.notify = notify; this.duck = duck; this.stream = null; this.peers = new Map();
    this.muted = true; this.speaking = false; this.pendingICE = new Map(); this.timer = null; this.context = null; this.joining = false;
    client.onSignal = (s) => this.signal(s).catch(() => this.notify('语音连接未成功，可以继续文字讨论'));
  }
  async toggle() {
    if (this.joining) return;
    if (this.stream) { this.muted = !this.muted; this.stream.getAudioTracks().forEach((t) => t.enabled = !this.muted); await this.publish(); return; }
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) return this.notify('语音连麦需要 HTTPS 邀请链接，或在本机 localhost 打开');
    this.joining = true; const roomCode = this.client.data?.code;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!this.client.active || this.client.data.code !== roomCode) { this.stop(); return; }
      this.muted = false;
      await this.publish(); this.sync(this.client.data);
      this.context = new AudioContext(); await this.context.resume();
      const analyser = this.context.createAnalyser(); analyser.fftSize = 512;
      this.context.createMediaStreamSource(this.stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      this.timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((s, x) => s + ((x - 128) / 128) ** 2, 0) / samples.length);
        const talking = !this.muted && rms > .025;
        if (talking !== this.speaking) { this.speaking = talking; this.publish().catch(() => {}); }
      }, 300);
      this.notify('已加入语音，点击麦克风可静音');
    } catch (e) { this.stop(); this.publish().catch(() => {}); this.notify(e.name === 'NotAllowedError' ? '未获得麦克风权限，可继续文字讨论' : '麦克风暂不可用，可继续文字讨论'); }
    finally { this.joining = false; }
  }
  publish() { return this.client.active ? this.client.action('voice', { joined: Boolean(this.stream), muted: this.muted, speaking: this.speaking }) : Promise.resolve(); }
  async send(target, data) { if (this.client.active) await this.client.action('signal', { target, data }); }
  peer(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] });
    const audio = document.createElement('audio'); audio.autoplay = true; audio.hidden = true; audio.dataset.peer = id; document.body.append(audio);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { candidate: e.candidate.toJSON() }).catch(() => {}); };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => this.notify('点击麦克风以开启同伴声音')); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.notify('同伴语音连接失败，文字讨论仍然可用'); };
    const peer = { pc, audio, offered: false }; this.peers.set(id, peer); return peer;
  }
  sync(room) {
    if (!this.stream || !room) return;
    const others = room.players.filter((p) => p.id !== room.meId && p.connected && p.voiceJoined);
    const ids = new Set(others.map((p) => p.id));
    for (const [id, p] of this.peers) if (!ids.has(id)) { p.pc.close(); p.audio.remove(); this.peers.delete(id); }
    for (const player of others) {
      const peer = this.peer(player.id);
      if (room.meId < player.id && !peer.offered) {
        peer.offered = true;
        (async () => { await peer.pc.setLocalDescription(await peer.pc.createOffer()); await this.send(player.id, { description: peer.pc.localDescription }); })().catch(() => { peer.offered = false; });
      }
    }
    this.duck(room.players.some((p) => p.voiceJoined && p.speaking && !p.muted));
  }
  async signal({ from, data }) {
    if (!this.stream || !this.client.data?.players.some((p) => p.id === from)) return;
    const peer = this.peer(from), pc = peer.pc;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const c of this.pendingICE.get(from) || []) await pc.addIceCandidate(c); this.pendingICE.delete(from);
      if (data.description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); await this.send(from, { description: pc.localDescription }); }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else this.pendingICE.set(from, [...(this.pendingICE.get(from) || []), data.candidate]);
    }
  }
  stop() {
    clearInterval(this.timer); this.context?.close(); this.context = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.muted = true; this.speaking = false;
    for (const p of this.peers.values()) { p.pc.close(); p.audio.remove(); } this.peers.clear(); this.pendingICE.clear(); this.duck(false);
  }
}
