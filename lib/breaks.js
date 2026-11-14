const transition = /^(?:now|next|so now|let[’']?s (?:move|try|look)|moving on)\b/i;
const sentenceEnd = /[.!?]["')\]]*$/;

export function shouldSuggestBreak({ watched, previousTime, time, duration, cues }) {
  if (watched < 18 * 60 || !Number.isFinite(duration) || duration - time < 90) return false;
  const index = cues.findLastIndex((cue) => cue.time <= time);
  const cue = cues[index];
  const previous = cues[index - 1];
  if (!previous || cue.time <= previousTime) return false;
  return sentenceEnd.test(previous.text.trim()) &&
    (transition.test(cue.text.trim()) || watched >= 20 * 60);
}