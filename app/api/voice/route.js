import { timingSafeEqual } from 'node:crypto';

export const maxDuration = 30;

export async function POST(request) {
  const key = process.env.ELEVENLABS_API_KEY;
  const code = process.env.COACH_ACCESS_CODE;
  if (!key || !code) return Response.json({ error: 'Set ELEVENLABS_API_KEY and COACH_ACCESS_CODE in the server environment.' }, { status: 503 });
  const provided = Buffer.from(request.headers.get('x-coach-code') || '');
  const expected = Buffer.from(code);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return Response.json({ error: 'Enter the coach access code in Settings.' }, { status: 401 });
  }

  const maxRecordingBytes = 3 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > maxRecordingBytes) {
    return Response.json({ error: 'Recording is too large. Try a shorter answer.' }, { status: 413 });
  }

  try {
    const headers = { 'xi-api-key': key };
    const signal = AbortSignal.timeout(24000);
    const transcribe = request.headers.get('content-type')?.startsWith('multipart/form-data');
    const base = 'https://api.elevenlabs.io/v1';
    let response;
    if (transcribe) {
      const recording = (await request.formData()).get('audio');
      if (!(recording instanceof File) || !recording.size || recording.size > maxRecordingBytes ||
          !/^(audio\/(webm|ogg|mp4|wav)|video\/webm)(;|$)/i.test(recording.type)) {
        return Response.json({ error: 'Record a short audio answer and try again.' }, { status: 400 });
      }
      const body = new FormData();
      const extension = recording.type.includes('mp4') ? 'm4a' : recording.type.split('/')[1].split(';')[0];
      body.append('file', recording, 'answer.' + extension);
      body.append('model_id', 'scribe_v2');
      response = await fetch(base + '/speech-to-text', { method: 'POST', headers, body, signal });
    } else {
      const { text } = await request.json();
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
        return Response.json({ error: 'Highlight between 1 and 2,000 characters.' }, { status: 400 });
      }
      const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
      response = await fetch(base + '/text-to-speech/' + encodeURIComponent(voice) + '?output_format=mp3_44100_128', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      });
    }
    if (!response.ok) return Response.json({ error: 'ElevenLabs could not process this request. Check the key permissions and credits.' }, { status: response.status === 429 ? 429 : 502 });
    if (!transcribe) return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
    const { text } = await response.json();
    return Response.json({ text: typeof text === 'string' ? text.trim() : '' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'The voice request failed. Try again.' }, { status: 502 });
  }
}