/**
 * Interruptor de transición. El código MIDI se conserva, pero con `false`
 * no se muestra en la UI ni se expone al LLM.
 */
export const MIDI_ENABLED = false;
export const AUDIO_ONLY = !MIDI_ENABLED;
