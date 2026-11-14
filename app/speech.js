'use client';

import { useEffect, useRef, useState } from 'react';

async function requestVoice(code, body, isJson, signal) {
  const response = await fetch('/api/voice', {
    method: 'POST', signal, body,
    headers: { 'x-coach-code': code, ...(isJson ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Voice request failed.');
  return response;
}

export function ReadAloud({ code, children }) {
  const region = useRef(null);
  const request = useRef(null);
  const [selection, setSelection] = useState(null);
  const [audio, setAudio] = useState('');
  const [status, setStatus] = useState('');
  const audioPlayer = useRef(null);

  useEffect(() => {
    function updateSelection() {
      const selected = window.getSelection();
      const text = selected?.toString().trim();
      if (!text || selected.isCollapsed || !region.current?.contains(selected.anchorNode) ||
          !region.current?.contains(selected.focusNode)) {
        setSelection(null);
        return;
      }
      const rect = selected.getRangeAt(0).getBoundingClientRect();
      setSelection({ text, top: Math.max(8, rect.top - 53), left: Math.max(8, Math.min(rect.left, window.innerWidth - 135)) });
    }
    document.addEventListener('selectionchange', updateSelection);
    window.addEventListener('scroll', updateSelection, true);
    window.addEventListener('resize', updateSelection);
    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      window.removeEventListener('scroll', updateSelection, true);
      window.removeEventListener('resize', updateSelection);
      request.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!audio) return;
    audioPlayer.current?.play().catch(() => {});
    return () => URL.revokeObjectURL(audio);
  }, [audio]);

  async function read() {
    const text = selection?.text;
    if (!text) return;
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setAudio('');
    setStatus('Preparing audio…');
    try {
      const response = await requestVoice(code, JSON.stringify({ text }), true, controller.signal);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      setAudio(URL.createObjectURL(blob));
      setStatus('');
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error.message);
    }
  }

  return <div className="read-aloud-region" ref={region}>
    {children}
    {selection && <button className="primary read-aloud-popup" style={{ top: selection.top, left: selection.left }}
      onMouseDown={(event) => event.preventDefault()} onClick={read}>Read aloud</button>}
    {status && <p role="status">{status}</p>}
    {audio && <div className="actions"><audio ref={audioPlayer} controls src={audio} aria-label="Selected text audio" />
      <button onClick={() => setAudio('')}>Dismiss audio</button></div>}
  </div>;
}

export function ShortAnswer({ question, code }) {
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const recorder = useRef(null);
  const stream = useRef(null);
  const timeout = useRef(null);
  const request = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timeout.current);
      request.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function record() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setMessage('Microphone recording needs a supported browser on localhost or HTTPS. You can type your answer.');
      return;
    }
    setMessage('');
    setState('requesting');
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = microphone;
      const capture = new MediaRecorder(microphone);
      recorder.current = capture;
      const chunks = [];
      capture.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      capture.onstop = async () => {
        clearTimeout(timeout.current);
        microphone.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        setState('transcribing');
        const controller = new AbortController();
        request.current = controller;
        try {
          const form = new FormData();
          form.append('audio', new Blob(chunks, { type: capture.mimeType }), 'answer');
          const response = await requestVoice(code, form, false, controller.signal);
          const { text } = await response.json();
          if (controller.signal.aborted) return;
          if (text) setAnswer((previous) => [previous.trim(), text].filter(Boolean).join(' ').slice(0, 2000));
          else setMessage('No speech detected. Try again or type your answer.');
        } catch (error) {
          if (!controller.signal.aborted) setMessage(error.message);
        } finally {
          if (!controller.signal.aborted) setState('idle');
        }
      };
      capture.start();
      setState('recording');
      timeout.current = setTimeout(() => { if (capture.state === 'recording') capture.stop(); }, 30000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) {
        setMessage('Could not start the microphone. Check browser permission or type your answer.');
        setState('idle');
      }
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!answer.trim() || state !== 'idle') return;
    setState('grading');
    setMessage('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/coach', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-coach-code': code },
        body: JSON.stringify({ mode: 'grade', prompt: question.shortPrompt, reference: question.why, answer }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!controller.signal.aborted) setMessage(result.explanation);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error.message || 'Could not check your answer.');
    } finally {
      if (!controller.signal.aborted) setState('idle');
    }
  }

  return <form className="short-answer" onSubmit={submit}>
    <p className="question">{question.shortPrompt}</p>
    <label>Your answer<textarea rows={3} maxLength={2000} value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
    <p className="subtle">Record up to 30 seconds. ElevenLabs transcribes your recording so you can edit it before submitting.</p>
    <div className="actions">
      {state === 'recording' ? <button type="button" onClick={() => recorder.current?.stop()}>Stop & transcribe</button>
        : <button type="button" disabled={state !== 'idle'} onClick={record}>Record answer</button>}
      <button className="primary" disabled={state !== 'idle' || !answer.trim()}>Check answer</button>
    </div>
    {state !== 'idle' && <p role="status">{{ requesting: 'Opening microphone…', recording: 'Recording…', transcribing: 'Transcribing…', grading: 'Checking your answer…' }[state]}</p>}
    {message && <p role="status" className="feedback">{message}</p>}
  </form>;
}