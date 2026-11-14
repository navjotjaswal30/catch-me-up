export function clock(time = 0) {
  const seconds = Math.max(0, Math.floor(time));
  return [Math.floor(seconds / 60), String(seconds % 60).padStart(2, '0')].join(':');
}

export function parseTranscript(input) {
  const toSeconds = (stamp) => stamp.replace(',', '.').split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
  const lines = input.replace(/\r/g, '').split('\n');
  const cues = [];
  for (let index = 0; index < lines.length; index++) {
    const timed = lines[index].match(/^\s*((?:\d+:)?\d+:\d{2}(?:[.,]\d+)?)\s+-->/);
    if (timed) {
      const content = [];
      while (lines[index + 1]?.trim() && !lines[index + 1].includes('-->')) {
        content.push(lines[++index].trim());
      }
      if (content.length) cues.push({ time: toSeconds(timed[1]), text: content.join(' ').replace(/<[^>]*>/g, '') });
      continue;
    }
    const plain = lines[index].match(/^\s*\[?((?:\d+:)?\d+:\d{2})\]?\s+(.+)$/);
    if (plain) cues.push({ time: toSeconds(plain[1]), text: plain[2] });
  }
  return cues.sort((a, b) => a.time - b.time);
}

export function cueAt(cues, time) {
  return cues.findLastIndex((cue) => cue.time <= time);
}