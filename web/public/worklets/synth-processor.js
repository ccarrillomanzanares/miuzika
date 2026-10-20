/**
 * Sintetizador polifónico para AudioWorklet.
 * Osciladores PolyBLEP + sub + filtro SVF + ADSR. Salida estéreo.
 *
 * Protocolo:
 *   { type: "note", note, velocity, startAt, duration }
 *   { type: "allOff" }
 *
 * Para render offline se pueden pasar todas las notas en processorOptions.notes:
 * así no dependemos de la entrega asíncrona de mensajes.
 */

const PRESETS = {
  bass: {
    wave: "saw", detune: 6, sub: 0.55, cutoff: 520, env: 650, q: 3.5,
    attack: 0.006, decay: 0.12, sustain: 0.72, release: 0.09, gain: 0.42, pan: 0,
  },
  lead: {
    wave: "saw", detune: 9, sub: 0.18, cutoff: 2600, env: 1200, q: 1.2,
    attack: 0.008, decay: 0.14, sustain: 0.75, release: 0.16, gain: 0.24, pan: 0,
  },
  pad: {
    wave: "saw", detune: 12, sub: 0.05, cutoff: 1000, env: 550, q: 0.9,
    attack: 0.28, decay: 0.35, sustain: 0.9, release: 0.9, gain: 0.14, pan: 0,
  },
  arp: {
    wave: "square", detune: 4, sub: 0.12, cutoff: 2800, env: 1000, q: 1.1,
    attack: 0.003, decay: 0.1, sustain: 0.35, release: 0.12, gain: 0.2, pan: 0,
  },
  synth: {
    wave: "saw", detune: 7, sub: 0.22, cutoff: 2000, env: 900, q: 1.1,
    attack: 0.006, decay: 0.12, sustain: 0.7, release: 0.13, gain: 0.26, pan: 0,
  },
};

function polyBlep(t, dt) {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function saw(phase, inc) {
  return 2 * phase - 1 - polyBlep(phase, inc);
}

function square(phase, inc) {
  let value = phase < 0.5 ? 1 : -1;
  value += polyBlep(phase, inc);
  value -= polyBlep((phase + 0.5) % 1, inc);
  return value;
}

class Voice {
  constructor(sampleRate, preset) {
    this.sr = sampleRate;
    this.p = preset;
    this.phase1 = 0;
    this.phase2 = 0;
    this.subPhase = 0;
    this.env = 0;
    this.released = false;
    this.done = true;
    this.ic1 = 0;
    this.ic2 = 0;
    this.startFrame = 0;
    this.releaseFrame = 0;
    this.freq = 440;
    this.velocity = 1;
    this.detune = 2 ** (preset.detune / 1200);
    this.attackInc = 1 / Math.max(0.001, preset.attack * sampleRate);
    this.decayCoeff = 1 - Math.exp(-1 / Math.max(0.001, preset.decay * sampleRate));
    this.releaseCoeff = Math.exp(-1 / Math.max(0.01, preset.release * sampleRate));
  }

  setNote(note, velocity, startFrame, durationSeconds) {
    this.freq = 440 * 2 ** ((note - 69) / 12);
    this.velocity = Math.max(0.02, Math.min(1, velocity));
    this.startFrame = startFrame;
    this.releaseFrame = startFrame + Math.max(0.02, durationSeconds) * this.sr;
    this.env = 0;
    this.released = false;
    this.done = false;
    this.ic1 = 0;
    this.ic2 = 0;
    this.phase1 = 0;
    this.phase2 = 0;
    this.subPhase = 0;
  }

  render(left, right, frame, length, sr) {
    if (this.done) return;
    const p = this.p;
    const inc1 = this.freq / sr;
    const inc2 = (this.freq * this.detune) / sr;
    const subInc = this.freq / 2 / sr;
    const isSquare = p.wave === "square";

    const cutoff = Math.max(40, Math.min(sr * 0.45, p.cutoff + p.env * this.env));
    const g = Math.tan((Math.PI * cutoff) / sr);
    const k = 1 / p.q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;

    const panLeft = Math.cos(((p.pan + 1) * Math.PI) / 4);
    const panRight = Math.sin(((p.pan + 1) * Math.PI) / 4);

    for (let index = 0; index < length; index++) {
      const f = frame + index;
      if (f < this.startFrame) continue;
      if (!this.released && f >= this.releaseFrame) this.released = true;

      if (!this.released) {
        if (this.env < 1) {
          this.env = Math.min(1, this.env + this.attackInc);
        } else {
          this.env += (p.sustain - this.env) * this.decayCoeff;
        }
      } else {
        this.env *= this.releaseCoeff;
        if (this.env < 0.0004) {
          this.done = true;
          break;
        }
      }

      const osc1 = isSquare ? square(this.phase1, inc1) : saw(this.phase1, inc1);
      const osc2 = isSquare ? square(this.phase2, inc2) : saw(this.phase2, inc2);
      const sub = Math.sin(this.subPhase * Math.PI * 2);

      let sample = (osc1 + osc2) * 0.5 + sub * p.sub;

      const v3 = sample - this.ic2;
      const v1 = a1 * this.ic1 + a2 * v3;
      const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
      this.ic1 = 2 * v1 - this.ic1;
      this.ic2 = 2 * v2 - this.ic2;
      sample = v2 * this.env * this.velocity * p.gain;

      left[index] += sample * panLeft;
      right[index] += sample * panRight;

      this.phase1 += inc1;
      if (this.phase1 >= 1) this.phase1 -= 1;
      this.phase2 += inc2;
      if (this.phase2 >= 1) this.phase2 -= 1;
      this.subPhase += subInc;
      if (this.subPhase >= 1) this.subPhase -= 1;
    }
  }
}

class SynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const name = options?.processorOptions?.preset ?? "lead";
    this.preset = PRESETS[name] ?? PRESETS.synth;
    this.voices = Array.from({ length: 64 }, () => new Voice(sampleRate, this.preset));
    this.queue = [];
    this.fallbackFrame = 0;

    const notes = options?.processorOptions?.notes;
    if (Array.isArray(notes)) {
      for (const note of notes) {
        this.queue.push({
          note: note.note,
          velocity: note.velocity ?? 0.8,
          duration: note.duration ?? 0.5,
          startFrame: Math.max(0, Math.round((note.startAt ?? 0) * sampleRate)),
        });
      }
      this.queue.sort((a, b) => a.startFrame - b.startFrame);
    }

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === "note") this.enqueue(data);
      else if (data?.type === "allOff") {
        this.queue.length = 0;
        this.voices.forEach((voice) => (voice.done = true));
      }
    };
  }

  enqueue(data) {
    const now = typeof currentTime === "number" ? currentTime : 0;
    const frameNow = typeof currentFrame === "number" ? currentFrame : this.fallbackFrame;
    const delay = Math.max(0, (data.startAt ?? 0) - now);
    const item = {
      note: data.note,
      velocity: data.velocity ?? 0.8,
      duration: data.duration ?? 0.5,
      startFrame: frameNow + Math.round(delay * sampleRate),
    };
    const index = this.queue.findIndex((queued) => queued.startFrame > item.startFrame);
    if (index === -1) this.queue.push(item);
    else this.queue.splice(index, 0, item);
  }

  startVoice(item) {
    let voice = this.voices.find((candidate) => candidate.done);
    if (!voice) {
      voice = this.voices[0];
      for (const candidate of this.voices) {
        if (candidate.startFrame < voice.startFrame) voice = candidate;
      }
    }
    voice.setNote(item.note, item.velocity, item.startFrame, item.duration);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] ?? output[0];
    left.fill(0);
    if (right !== left) right.fill(0);

    const frame = typeof currentFrame === "number" ? currentFrame : this.fallbackFrame;
    const blockEnd = frame + left.length;

    while (this.queue.length > 0 && this.queue[0].startFrame < blockEnd) {
      this.startVoice(this.queue.shift());
    }

    for (const voice of this.voices) voice.render(left, right, frame, left.length, sampleRate);
    this.fallbackFrame = blockEnd;
    return true;
  }
}

registerProcessor("miuzika-synth", SynthProcessor);
