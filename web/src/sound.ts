import type { MomentLevel } from './moment.ts';

export const SOUND_KEY = 'deja-boo:sound';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The slice of Web Audio the page uses; the real AudioContext satisfies it, tests pass a stub. */
export interface AudioLike {
  readonly currentTime: number;
  readonly destination: unknown;
  resume?(): Promise<void> | void;
  createOscillator(): { type: string; frequency: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void; start(t: number): void; stop(t: number): void };
  createGain(): { gain: { setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void };
}

/** Saved preference; false unless the visitor saved "on". Invariant: a missing, broken or unreadable store means off. */
export function readSoundPref(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeSoundPref(storage: StorageLike | null, on: boolean): void {
  try {
    storage?.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}

export const soundLabel = (on: boolean): string => `Sound: ${on ? 'on' : 'off'}`;

/** Level of the sound: block is a low swell plus a chime, warn the same, softer and higher. */
export const SOUND_LEVELS: Record<MomentLevel, { swellHz: number; swellGain: number; chimeHz: number; chimeGain: number }> = {
  block: { swellHz: 55, swellGain: 0.22, chimeHz: 880, chimeGain: 0.08 },
  warn: { swellHz: 98, swellGain: 0.09, chimeHz: 1175, chimeGain: 0.035 },
};

export interface Sound {
  enabled(): boolean;
  /** Flip the setting, save it, and return the new state. Call from a click so the browser lets audio start. */
  toggle(): boolean;
  /** Play the sound for a ghost rising; does nothing while off or without Web Audio. Never throws. */
  play(level: MomentLevel): void;
}

/** Opt-in synthesized sound. Invariant: nothing is created or played before the visitor turns it on. */
export function createSound(storage: StorageLike | null, makeAudio: () => AudioLike | null): Sound {
  let on = readSoundPref(storage);
  let ctx: AudioLike | null = null;
  const audio = (): AudioLike | null => {
    if (!ctx) {
      try { ctx = makeAudio(); } catch { ctx = null; }
    }
    return ctx;
  };
  const tone = (a: AudioLike, type: string, hz: number, peak: number, at: number, attack: number, length: number): void => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    gain.connect(a.destination);
    osc.start(at);
    osc.stop(at + length + 0.05);
  };
  return {
    enabled: () => on,
    toggle() {
      on = !on;
      writeSoundPref(storage, on);
      if (on) void audio()?.resume?.();
      return on;
    },
    play(level) {
      if (!on) return;
      const a = audio();
      if (!a) return;
      try {
        void a.resume?.();
        const p = SOUND_LEVELS[level];
        const t = a.currentTime;
        tone(a, 'sine', p.swellHz, p.swellGain, t, 0.55, 1.3);
        tone(a, 'sine', p.chimeHz, p.chimeGain, t + 0.5, 0.02, 0.9);
      } catch { /* sound is garnish; never break the page */ }
    },
  };
}

/** The browser's AudioContext, or null where Web Audio is missing. */
export function browserAudio(): AudioLike | null {
  const w = globalThis as unknown as { AudioContext?: new () => AudioLike; webkitAudioContext?: new () => AudioLike };
  const C = w.AudioContext ?? w.webkitAudioContext;
  return C ? new C() : null;
}
