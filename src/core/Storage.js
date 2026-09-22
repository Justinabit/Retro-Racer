const defaults = () => ({
  version: 1,
  mode: "classic",
  character: "vex",
  kartTrack: "metropolis",
  tokens: 0,
  kartFinishes: 0,
  car: "gt",
  track: "coast",
  finishes: 0,
  name: "PLAYER",
  paint: {},
  custom: {},
  records: [],
  bestTimes: {},
  highScores: {},
  difficulty: "normal",
  settings: {
    graphics: "high",
    shake: true,
    particles: true,
    crt: false,
    motion: true,
    music: true,
    sfx: true,
    master: 0.55,
    musicVolume: 0.28,
    sfxVolume: 0.65,
  },
});
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const color = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export class Storage {
  constructor() {
    this.available = true;
    this.data = defaults();
    try {
      const raw = JSON.parse(
        localStorage.getItem("pixel-racer-save") || "null",
      );
      if (raw?.version === 1) {
        for (const key of [
          "car",
          "track",
          "difficulty",
          "character",
          "kartTrack",
        ])
          if (typeof raw[key] === "string") this.data[key] = raw[key];
        this.data.mode = raw.mode === "kart" ? "kart" : "classic";
        for (const key of ["tokens", "kartFinishes"])
          if (Number.isFinite(raw[key]))
            this.data[key] = Math.max(0, Math.floor(raw[key]));
        if (typeof raw.name === "string")
          this.data.name = raw.name.trim().slice(0, 16) || "PLAYER";
        const finishes = Number(raw.finishes);
        this.data.finishes = Number.isFinite(finishes)
          ? Math.max(0, Math.floor(finishes))
          : 0;
        if (object(raw.paint))
          for (const [id, value] of Object.entries(raw.paint))
            if (color(value)) this.data.paint[id] = value;
        if (object(raw.custom))
          for (const [id, value] of Object.entries(raw.custom)) {
            if (!object(value)) continue;
            const custom = {};
            if (color(value.wheels)) custom.wheels = value.wheels;
            for (const key of ["spoiler", "decal"])
              if (typeof value[key] === "boolean") custom[key] = value[key];
            if (Number.isFinite(Number(value.number)))
              custom.number = Math.max(
                1,
                Math.min(99, Math.round(Number(value.number))),
              );
            this.data.custom[id] = custom;
          }
        this.data.records = Array.isArray(raw.records)
          ? raw.records
              .filter(
                (r) =>
                  object(r) &&
                  Number.isFinite(r.time) &&
                  r.time > 0 &&
                  Number.isFinite(r.score) &&
                  typeof r.track === "string",
              )
              .slice(0, 100)
          : [];
        for (const key of ["bestTimes", "highScores"]) {
          if (object(raw[key]))
            for (const [track, value] of Object.entries(raw[key]))
              if (Number.isFinite(value) && value > 0)
                Object.defineProperty(this.data[key], track, {
                  value,
                  enumerable: true,
                  writable: true,
                  configurable: true,
                });
        }
        for (const record of this.data.records) this.updateBests(record);
        for (const [key, value] of Object.entries(this.data.settings)) {
          if (typeof raw.settings?.[key] === typeof value)
            this.data.settings[key] =
              typeof value === "number"
                ? Math.max(0, Math.min(1, raw.settings[key]))
                : raw.settings[key];
        }
        if (!["low", "medium", "high"].includes(this.data.settings.graphics))
          this.data.settings.graphics = "high";
        if (
          !["easy", "normal", "hard", "expert"].includes(this.data.difficulty)
        )
          this.data.difficulty = "normal";
      }
    } catch {
      /* Malformed or blocked storage never prevents a race. */
    }
  }
  save() {
    try {
      localStorage.setItem("pixel-racer-save", JSON.stringify(this.data));
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }
  best(track, mode = "classic") {
    if (mode === "kart") track = "kart:" + track;
    return Object.hasOwn(this.data.bestTimes, track)
      ? this.data.bestTimes[track]
      : Infinity;
  }
  updateBests(record) {
    const { time, score } = record;
    const track =
      record.mode === "kart" ? "kart:" + record.track : record.track;
    Object.defineProperty(this.data.bestTimes, track, {
      value: Math.min(this.best(track), time),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(this.data.highScores, track, {
      value: Math.max(
        Object.hasOwn(this.data.highScores, track)
          ? this.data.highScores[track]
          : 0,
        score,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  record(record) {
    this.updateBests(record);
    this.data.records.unshift(record);
    this.data.records = this.data.records.slice(0, 100);
    this.data.finishes++;
    if (record.mode === "kart") {
      this.data.kartFinishes++;
      this.data.tokens += Math.max(0, Math.floor(record.tokens || 0));
    }
    this.save();
  }
}
