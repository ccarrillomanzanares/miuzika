/**
 * Limitador de picos con look-ahead real: la señal se retrasa unos milisegundos
 * para que la reducción de ganancia ya esté aplicada cuando llega el pico.
 */

export function limitBuffer(
  buffer: AudioBuffer,
  ceilingDb = -1,
  lookaheadMs = 5,
  releaseMs = 120,
): void {
  const sampleRate = buffer.sampleRate;
  const ceiling = 10 ** (ceilingDb / 20);
  const channels = Math.min(2, buffer.numberOfChannels);
  const length = buffer.length;
  if (length === 0) return;

  const lookahead = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  const original = data.map((channel) => channel.slice());

  const peaks = new Float32Array(length);
  for (const channel of original) {
    for (let index = 0; index < length; index++) {
      const value = Math.abs(channel[index]!);
      if (value > peaks[index]!) peaks[index] = value;
    }
  }

  // Máximo deslizante en [i, i + lookahead] → ganancia objetivo.
  const target = new Float32Array(length);
  const deque: number[] = [];
  let cursor = 0;
  for (let index = 0; index < length; index++) {
    const end = Math.min(length, index + lookahead);
    while (cursor < end) {
      while (deque.length > 0 && peaks[deque[deque.length - 1]!]! <= peaks[cursor]!) deque.pop();
      deque.push(cursor);
      cursor++;
    }
    while (deque.length > 0 && deque[0]! < index) deque.shift();
    const peak = peaks[deque[0]!] ?? 0;
    target[index] = peak > ceiling ? ceiling / peak : 1;
  }

  // Suavizado: ataque rápido, release lento.
  const attack = 1 - Math.exp(-1 / (0.0008 * sampleRate));
  const release = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  const gain = new Float32Array(length);
  let envelope = target[0] ?? 1;
  for (let index = 0; index < length; index++) {
    const goal = target[index]!;
    const coefficient = goal < envelope ? attack : release;
    envelope += (goal - envelope) * coefficient;
    gain[index] = Math.min(1, envelope);
  }

  // Aplicar con retardo: la ganancia calculada en i se aplica a la muestra i-delay.
  for (let channel = 0; channel < channels; channel++) {
    const source = original[channel]!;
    const destination = data[channel]!;
    for (let index = 0; index < length; index++) {
      const delayed = index - lookahead;
      destination[index] = delayed >= 0 ? source[delayed]! * gain[delayed]! : 0;
    }
  }
}
