export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.beat = 0;
    this.clock = 0;
    this.mode = "menu";
  }
  init() {
    try {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.engine = this.ctx.createOscillator();
        this.engine.type = "sawtooth";
        this.engineGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 450;
        this.engine.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engineGain.gain.value = 0;
        this.engine.start();
        const buffer = this.ctx.createBuffer(
          1,
          this.ctx.sampleRate,
          this.ctx.sampleRate,
        );
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = this.ctx.createBufferSource();
        this.noise.buffer = buffer;
        this.noise.loop = true;
        this.noiseGain = this.ctx.createGain();
        const nf = this.ctx.createBiquadFilter();
        nf.type = "highpass";
        nf.frequency.value = 1800;
        this.noise.connect(nf);
        nf.connect(this.noiseGain);
        this.noiseGain.connect(this.master);
        this.noiseGain.gain.value = 0;
        this.noise.start();
      }
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }
  tone(
    freq = 700,
    length = 0.08,
    volume = 0.1,
    type = "square",
    music = false,
  ) {
    if (!this.ctx || !(music ? this.settings.music : this.settings.sfx)) return;
    const t = this.ctx.currentTime,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(
      volume * (music ? this.settings.musicVolume : this.settings.sfxVolume),
      t,
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    o.start(t);
    o.stop(t + length);
  }
  click() {
    this.init();
    this.tone(540, 0.05, 0.06);
  }
  update(
    dt,
    speed = 0,
    throttle = 0,
    drift = false,
    active = false,
    boost = false,
  ) {
    if (!this.ctx) return;
    const s = this.settings,
      t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    const rpm = ((Math.abs(speed) * 3.6) % 48) / 48;
    this.engine.frequency.setTargetAtTime(
      40 + rpm * 90 + throttle * 20 + (boost ? 35 : 0),
      t,
      0.1,
    );
    this.engineGain.gain.setTargetAtTime(
      s.sfx && active ? s.sfxVolume * (0.025 + throttle * 0.028) : 0,
      t,
      0.08,
    );
    this.noiseGain.gain.setTargetAtTime(
      s.sfx && drift && active ? s.sfxVolume * 0.028 : 0,
      t,
      0.1,
    );
    this.clock += dt;
    const interval = this.mode === "race" ? 0.19 : 0.29;
    if (this.clock > interval) {
      this.clock = 0;
      const melody = [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 3, 10, 7, -2];
      const b = this.beat++ % 16;
      this.tone(
        130.81 * Math.pow(2, melody[b] / 12),
        interval * 0.8,
        0.04,
        "triangle",
        true,
      );
      if (b % 4 === 0)
        this.tone(
          65.4 * Math.pow(2, melody[b] / 12),
          interval * 3,
          0.08,
          "sine",
          true,
        );
    }
  }
  finish() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.3, 0.1, "triangle"), i * 140),
    );
  }
}
