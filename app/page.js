'use client';

import { useEffect, useRef, useState } from 'react';
import { ReadAloud, ShortAnswer } from './speech';
import { analogyInterests } from '../lib/coaching';
import { shouldSuggestBreak } from '../lib/breaks';
import { lectures } from '../lib/catalog';
import { access } from '../lib/storage';
import { clock, cueAt, parseTranscript } from '../lib/lecture';

async function loadLectureCues(path, signal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('Transcript could not load.');
  const cues = parseTranscript(await response.text());
  if (!cues.length) throw new Error('No timestamped lines found.');
  return cues;
}

function getRecoveryClip(lecture, anchor, earlierThan) {
  const boundary = Math.max(0, Math.min(anchor, earlierThan ?? anchor));
  if (boundary === 0) {
    const previous = lectures.filter((item) => item.course === lecture.course && item.created < lecture.created)
      .sort((a, b) => b.created - a.created)[0];
    if (previous) return { lecture: previous.id, time: 0, fallback: 'previous' };
  }
  const leadUp = Math.max(0, boundary - 25);
  const cue = lecture.cues[cueAt(lecture.cues, leadUp)];
  return { lecture: lecture.id, time: cue?.time ?? leadUp, fallback: boundary > 0 ? 'lead-up' : 'start' };
}

const formats = { clip: 'Replay clip', analogy: 'Explanation & analogy', visual: 'Step through' };

export default function Home() {
  const [viewMode, setViewMode] = useState('view-1');
  const [active, setActive] = useState(null);
  const [selectedTranscript, setSelectedTranscript] = useState('');
  const [loadedTranscript, setLoadedTranscript] = useState(null);
  const [transcriptStatus, setTranscriptStatus] = useState('');
  const [picker, setPicker] = useState('video');
  const selectionDialog = useRef(null);
  const [time, setTime] = useState(0);
  const viewing = Boolean(active);
  const [railHeight, setRailHeight] = useState(null);
  const preview = useRef(null);
  const playerActions = useRef(null);
  const transcriptLines = useRef(null);
  const lineHelpButton = useRef(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState(null);
  const rangeStart = useRef(null);
  const recoveryMenu = useRef(null);
  const coachRegion = useRef(null);
  const [profile, setProfile] = useState({ marks: [], progress: {}, preference: 'clip', choices: {} });
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null);
  const [coachOpen, setCoachOpen] = useState(false);

  const [origin, setOrigin] = useState(null);
  const [format, setFormat] = useState('clip');
  const [step, setStep] = useState(0);
  const [answerFormat, setAnswerFormat] = useState('choice');
  const [answer, setAnswer] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [resume, setResume] = useState(false);
  const [term, setTerm] = useState('');
  const [breakState, setBreakState] = useState('idle');
  const watchSession = useRef({ seconds: 0, sample: null, pausedAt: null });
  const [dismissedCheck, setDismissedCheck] = useState(null);
  const [focus, setFocus] = useState(null);
  const [askDefinition, setAskDefinition] = useState(false);
  const player = useRef(null);
  const pendingSeek = useRef(null);
  const latestTime = useRef(0);
  const lastSaved = useRef(0);
  const requestID = useRef(0);

  useEffect(() => {
    let alive = true;
    access('notes', 'get', 'profile')
      .then((saved) => {
        if (!alive) return;
        if (saved) {
          setProfile(saved);
        }
      })
      .catch(() => { if (alive) setNotice('Browser storage is unavailable.'); })
      .finally(() => { if (alive) setReady(true); });
    setCode(sessionStorage.getItem('coach-code') || '');
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (ready) access('notes', 'put', [profile, 'profile']).catch(() => setNotice('Could not save your progress in this browser.'));
  }, [profile, ready]);

  const transcriptPath = active?.transcript;
  useEffect(() => {
    if (!transcriptPath) return;
    const controller = new AbortController();
    setTranscriptStatus('Loading transcript…');
    loadLectureCues(transcriptPath, controller.signal)
      .then((cues) => {
        setLoadedTranscript({ path: transcriptPath, cues });
        setTranscriptStatus('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTranscriptStatus(error.message);
      });
    return () => controller.abort();
  }, [transcriptPath]);

  const courseGroups = new Map();
  for (const lecture of [...lectures].sort((a, b) =>
    a.course.localeCompare(b.course, undefined, { numeric: true }) || a.title.localeCompare(b.title, undefined, { numeric: true }))) {
    if (!courseGroups.has(lecture.course)) courseGroups.set(lecture.course, []);
    courseGroups.get(lecture.course).push(lecture);
  }
  const lectureCues = loadedTranscript && loadedTranscript.path === transcriptPath ? loadedTranscript.cues : [];
  const cues = selectedTranscript === transcriptPath ? lectureCues : [];
  const currentCue = cueAt(cues, time);

  useEffect(() => {
    if (focus) return;
    const list = transcriptLines.current;
    const line = list?.children[currentCue];
    if (!line) return;
    const bounds = list.getBoundingClientRect();
    const cueBounds = line.getBoundingClientRect();
    const inset = 4;
    if (cueBounds.top < bounds.top + inset) {
      list.scrollTop += cueBounds.top - bounds.top - inset;
    } else if (cueBounds.bottom > bounds.bottom - inset) {
      list.scrollTop += cueBounds.bottom - bounds.bottom + inset;
    }
  }, [currentCue, active, focus]);

  useEffect(() => {
    if (focus) lineHelpButton.current?.focus({ preventScroll: true });
  }, [focus]);
  const preferred = profile.preference === 'auto'
    ? Object.keys(formats).sort((a, b) => (profile.choices[b] || 0) - (profile.choices[a] || 0))[0]
    : profile.preference;

  useEffect(() => {
    if (coachOpen) coachRegion.current?.scrollIntoView({ block: 'nearest' });
  }, [coachOpen]);

  function jump(id) {
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function openPicker(type) {
    setPicker(type);
    selectionDialog.current?.showModal();
  }

  function selectRange() {
    player.current?.pause();
    rangeStart.current = null;
    const start = Math.min(duration, latestTime.current);
    setRange([start, start]);
    setCoachOpen(false);
  }

  function timelinePosition(event) {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (event.clientX - left) / width * duration));
  }

  function updateRange(event) {
    if (rangeStart.current == null) return;
    const end = timelinePosition(event);
    setRange([Math.min(rangeStart.current, end), Math.max(rangeStart.current, end)]);
  }

  function saveProgress(id, position) {
    if (!ready || !Number.isFinite(position)) return;
    setProfile((state) => state.progress[id] === position ? state : {
      ...state, progress: { ...state.progress, [id]: position },
    });
  }

  useEffect(() => {
    const element = viewing ? player.current : preview.current;
    if (!element) return;
    const actions = playerActions.current;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setRailHeight(actions ? actions.getBoundingClientRect().bottom - bounds.top + 1 : bounds.height);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (actions) observer.observe(actions);
    measure();
    return () => observer.disconnect();
  }, [viewing, active?.id]);

  function goTo(lecture, position = null) {
    if (lecture.id === active?.id) {
      if (position != null) {
        if (player.current?.readyState) player.current.currentTime = position;
        else pendingSeek.current = position;
      }
    } else {
      setDuration(0);
      pendingSeek.current = position;
      latestTime.current = position || 0;
      lastSaved.current = position || 0;
      setTime(position || 0);
      setFocus(null);
      setSelectedTranscript(position == null ? '' : lecture.transcript);
      setTranscriptStatus('');
      setActive(lecture);
    }
    setResume(position == null && (profile.progress[lecture.id] || 0) > 2);
  }

  function openLecture(lecture, position = null) {
    requestID.current++;
    setBreakState('idle');
    watchSession.current = { seconds: 0, sample: null, pausedAt: null };
    setBusy(false);
    setPanel(null);
    setCoachOpen(false);
    setOrigin(null);
    setAnswer(null);
    setAnswerFormat('choice');
    setFocus(null);
    setDismissedCheck(null);
    setRange(null);
    recoveryMenu.current = null;
    goTo(lecture, position);
    jump('learn');
  }

  async function coach(mode, options = {}) {
    const isRecovery = mode === 'recover';
    const selectedRange = options.range;
    const anchor = options.anchor ?? latestTime.current;
    const target = options.lecture ?? active;
    const lecture = target && { ...target, cues: target.transcript === transcriptPath && lectureCues.length ? lectureCues : target.cues ?? [] };
    const previousQuestions = options.previousQuestions || [];
    const reviewSource = mode === 'practice' ? (panel?.reviewSource || panel?.source) : null;
    const contextTime = options.contextTime ?? (reviewSource && reviewSource.lecture === lecture?.id ? reviewSource.time : anchor);
    const previous = options.previous ?? (mode === 'practice' || mode === 'transfer' ? panel?.reviewExplanation || panel?.explanation : '');
    if (!lecture || (!isRecovery && !lecture.cues.length)) {
      setNotice('The lecture transcript is unavailable right now.');
      return;
    }
    if (isRecovery && (!origin || !options.lecture)) setOrigin({ lecture, time: options.returnTime ?? anchor });
    const id = ++requestID.current;
    player.current?.pause();
    setBusy(true);
    setCoachOpen(true);
    setNotice('');
    setFormat('clip');
    setRange(null);
    setStep(0);
    setAnswer(null);
    setAnswerFormat('choice');
    setShowHint(false);
    setShowReasoning(false);
    setResume(false);
    setFocus(null);
    setPanel(null);
    const panelDetails = { mode, anchor, lecture, reviewSource, reviewExplanation: previous, previousQuestions, selectedRange };
    const fallback = isRecovery ? getRecoveryClip(lecture, anchor, options.earlierThan) : null;
    try {
      if (!lecture.cues.length) throw new Error('The transcript is still unavailable for AI help.');
      const cueIndex = Math.max(0, cueAt(lecture.cues, contextTime));
      const prior = lectures
        .filter((item) => item.course === lecture.course && item.created < lecture.created)
        .sort((a, b) => b.created - a.created)
        .slice(0, 2);
      const reviewedItem = lectures.find((item) => item.id === reviewSource?.lecture && item.id !== lecture.id);
      const related = [...new Set([...prior, ...(reviewedItem ? [reviewedItem] : [])])];
      const relatedCues = new Map(await Promise.all(related.map(async (item) => {
        try {
          return [item.id, await loadLectureCues(item.transcript, AbortSignal.timeout(5000))];
        } catch {
          return [item.id, []];
        }
      })));
      if (id !== requestID.current) return;
      const reviewedLecture = reviewedItem && { ...reviewedItem, cues: relatedCues.get(reviewedItem.id) };
      const reviewedIndex = reviewedLecture ? cueAt(reviewedLecture.cues, reviewSource.time) : -1;
      const reviewedCues = reviewedIndex < 0 ? [] : reviewedLecture.cues.slice(Math.max(0, reviewedIndex - 1), reviewedIndex + 2)
        .map((cue) => ({ ...cue, lecture: reviewedLecture.id, title: reviewedLecture.title, current: false }));
      const selectedCues = selectedRange
        ? lecture.cues.slice(Math.max(0, cueAt(lecture.cues, selectedRange[0])), cueAt(lecture.cues, selectedRange[1]) + 1)
        : [];
      const stride = Math.max(1, Math.ceil(selectedCues.length / 16));
      const rangeCues = selectedCues.filter((_, index) => index % stride === 0);
      if (selectedCues.length && !rangeCues.includes(selectedCues.at(-1))) rangeCues.push(selectedCues.at(-1));
      const currentCues = [...new Set([
        ...lecture.cues.slice(Math.max(0, cueIndex - 21), cueIndex + 4), ...rangeCues,
      ])].sort((a,b) => a.time - b.time);
      const cues = [
        ...currentCues
          .map((cue) => ({ ...cue, lecture: lecture.id, title: lecture.title, current: true })),
        ...reviewedCues,
        ...prior.flatMap((item) => {
          const lines = relatedCues.get(item.id);
          const interval = Math.max(1, Math.ceil(lines.length / 16));
          return lines.filter((_, index) => index % interval === 0).slice(0, 16)
            .map((cue) => ({ ...cue, lecture: item.id, title: item.title, current: false }));
        }),
      ].map((cue) => ({ ...cue, text: cue.text.slice(0, 450) }));
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-coach-code': code },
        body: JSON.stringify({
          mode, anchor, cues, selection: [selectedRange && 'Confusing segment from ' + selectedRange[0] + ' to ' + selectedRange[1] + ' seconds. Use transcript lines within this segment to identify the missing idea.', options.selection].filter(Boolean).join(' ').slice(0, 700), previous: previous?.slice(0, 1500),
          analogyInterest: profile.analogyInterest || undefined,
          earlierThan: options.earlierThan, previousQuestions: previousQuestions.slice(-5).map((prompt) => prompt.slice(0, 500)),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The coach is unavailable.');
      if (id !== requestID.current) return;
      const next = { ...result, ...panelDetails, source: result.source ?? fallback };
      if (isRecovery) recoveryMenu.current = next;
      setPanel(next);
    } catch (error) {
      if (id !== requestID.current) return;
      if (fallback) {
        const next = { ...panelDetails, source: fallback, unavailable: error.message };
        recoveryMenu.current = next;
        setPanel(next);
      } else {
        setPanel({ mode: 'error', message: error.message });
      }
    } finally {
      if (id === requestID.current) setBusy(false);
    }
  }

  function chooseFormat(value) {
    setFormat(value);
    setProfile((state) => ({
      ...state, choices: { ...state.choices, [value]: (state.choices[value] || 0) + 1 },
    }));
  }

  function returnToLecture() {
    const place = origin;
    if (!place) return;
    const previous = recoveryMenu.current?.explanation || panel?.reviewExplanation || panel?.explanation;
    player.current?.pause();
    requestID.current++;
    setBusy(false);
    setCoachOpen(true);
    setPanel({ mode: 'returned', previous, anchor: place.time, lecture: place.lecture });
    setOrigin(null);
    setRange(null);
    recoveryMenu.current = null;
    goTo(place.lecture, place.time);
  }

  function mark(lecture, position, question) {
    setProfile((state) => {
      const id = question?.id || lecture.id + ':' + Math.floor(position);
      if (state.marks.some((item) => item.id === id)) return state;
      return { ...state, marks: [...state.marks, { id, lecture: lecture.id, time: position, question }] };
    });
    setNotice(question ? 'Question saved for review.' : 'Timestamp saved for review.');
  }

  function pauseWatch(event) {
    watchSession.current.sample = null;
    watchSession.current.pausedAt = performance.now();
    saveProgress(active.id, event.currentTarget.currentTime);
  }

  function resumeWatch() {
    const session = watchSession.current;
    if (session.pausedAt != null && performance.now() - session.pausedAt >= 120000) {
      session.seconds = 0;
      setBreakState('idle');
    }
    session.pausedAt = null;
    setBreakState((state) => state === 'paused' ? 'idle' : state);
    setResume(false);
  }

  function dismissBreak(takeBreak) {
    watchSession.current.seconds = takeBreak ? 0 : 13 * 60;
    setBreakState(takeBreak ? 'paused' : 'idle');
    if (takeBreak) player.current?.pause();
  }

  function tick(event) {
    const video = event.currentTarget;
    const position = video.currentTime;
    const session = watchSession.current;
    const now = performance.now();
    const sample = session.sample;
    session.sample = video.paused || video.seeking || document.hidden ? null : { time: position, now };
    if (sample && session.sample) {
      const seconds = (now - sample.now) / 1000;
      const delta = position - sample.time;
      if (seconds > 0 && seconds <= 2 && delta > 0 && delta <= seconds * video.playbackRate + 0.25) {
        session.seconds += seconds;
        if (profile.breakReminders !== false && breakState === 'idle' && !coachOpen && !busy &&
            !range && !origin && !resume && !focus && !showCheck && shouldSuggestBreak({
              watched: session.seconds, previousTime: sample.time, time: position,
              duration: video.duration, cues: lectureCues,
            })) setBreakState('suggested');
      }
    }
    latestTime.current = position;
    setTime(position);
    if (Math.abs(position - lastSaved.current) >= 2) {
      lastSaved.current = position;
      saveProgress(active.id, position);
    }
  }

  const playlist = (
    <aside className="playlist card" aria-label="Lecture playlist">
      <h2>Lecture library</h2>
      {!lectures.length && <p className="subtle">Lectures will appear here when added to the catalog.</p>}
      {[...courseGroups].map(([course, items]) => <div className="course" key={course}>
        <h3>{course}</h3>
        {items.map((lecture) => <button key={lecture.id}
          aria-current={viewing && active.id === lecture.id ? 'true' : undefined}
          className={'lecture ' + (viewing && active.id === lecture.id ? 'selected' : '')}
          onClick={() => openLecture(lecture)}>
          <span aria-hidden="true">▷</span><span>{lecture.title}<small>{lecture.instructor}</small></span>
        </button>)}
      </div>)}
    </aside>
  );
  const checkCue = cues[currentCue];
  const checkKey = active?.id + ':' + currentCue;
  const showCheck = breakState === 'idle' && profile.periodic !== false && !resume && !coachOpen && !range && !busy && !origin &&
    currentCue > 0 && currentCue % 2 === 0 && time - checkCue.time < 8 && dismissedCheck !== checkKey;
  const resumeTime = profile.progress[active?.id] || 0;
  const resumeIndex = cueAt(cues, resumeTime);
  const sourceLecture = lectures.find((lecture) => lecture.id === panel?.source?.lecture);
  const sourceText = panel?.source && sourceLecture
    ? sourceLecture.title + ' · ' + clock(panel.source.time) : '';

  return (
    <>
      <header className="top" id="top"><a className="brand" href="#top"><span className="logo" aria-hidden="true">↶</span> Catch Me Up</a>
        <label className="mode-picker">
          <span>Mode</span>
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
            <option value="view-1">View 1</option>
            <option value="view-2">View 2</option>
          </select>
        </label>
      </header>
      <main className="home-main" data-view={viewMode}>
        <section className="welcome">
          <div className="welcome-copy">
            <h1>Find your place.<br /><span>Keep learning.</span></h1>
            <p>Watching a lecture but randomly get lost? Catch Me Up, your personal AI-prof, puts you back on track and removes the guess work.</p>
            <div className="actions">
              <a className="hero-cta" href="#learn">Start learning <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <div className="welcome-guide"><ol className="welcome-steps" aria-label="Three steps to get unstuck">
            <li><span className="step-number" aria-hidden="true">1</span><div><h2>Select a lecture</h2><p>Choose a video and its matching transcript from the library.</p></div></li>
            <li><span className="step-number" aria-hidden="true">2</span><div><h2>Flag where you got lost</h2><p>Mark a moment so AI can find an earlier explanation.</p></div></li>
            <li><span className="step-number" aria-hidden="true">3</span><div><h2>Pick up where you left off</h2><p>Review the missing idea, then resume and check your understanding.</p></div></li>
          </ol></div>
        </section>
        <section className="learning" id="learn" aria-label="Learn">
          {notice && <p role="status" className="notice">{notice} <button className="quiet" onClick={() => setNotice('')}>Dismiss</button></p>}
          <div className="lecture-area" style={railHeight ? { '--rail-height': railHeight + 'px' } : undefined}>
            <div className="heading"><div>{viewing && <p className="eyebrow">{active.course}</p>}<h2>{viewing ? active.title : 'Learn with a lecture'}</h2></div>
              {viewing && <div className="actions"><button onClick={() => openPicker('video')}>Select video</button><button onClick={() => mark(active, latestTime.current)}>☆ Save timestamp</button></div>}
            </div>
            {!viewing ?
            <button ref={preview} className="dropzone" onClick={() => openPicker('video')}>
              <span className="drop-plus" aria-hidden="true">▷</span>
              <strong>Select video</strong><span>Browse the lecture library</span>
            </button>
            : <div className="watch-column">
            <div className="player">
              <video key={active.id} ref={player} src={active.source} controls playsInline preload="metadata"
                onTimeUpdate={tick}
                onPause={pauseWatch}
                onSeeked={(event) => saveProgress(active.id, event.currentTarget.currentTime)}
                onPlay={resumeWatch}
                onSeeking={() => { watchSession.current.sample = null; }}
                onEnded={() => { setBreakState('idle'); }}
                onError={() => setNotice('This video could not play. Try an H.264 MP4 or a WebM file.')}
                onLoadedMetadata={(event) => {
                  const length = event.currentTarget.duration;
                  setDuration(Number.isFinite(length) ? length : 0);
                  if (pendingSeek.current != null) event.currentTarget.currentTime = pendingSeek.current;
                  pendingSeek.current = null;
                }}>

                <track kind="captions" src={active.transcript} srcLang="en" label="English" />
              </video>
              <div ref={playerActions} className="toolbar player-actions">
                <button className="primary" disabled={busy} onClick={() => coach('recover', { anchor: player.current?.currentTime ?? latestTime.current })}>↶ I lost the thread</button>
                <button disabled={busy || !duration} onClick={selectRange}>Flag a segment</button>
                <button disabled={busy} onClick={() => coach('check')}>Check my understanding</button>
              </div>
              {origin && !coachOpen && <div className="toolbar recovery-actions">
                {panel && <button onClick={() => { player.current?.pause(); setCoachOpen(true); }}>Open recovery options</button>}
                <button className="return" onClick={returnToLecture}>Return to {clock(origin.time)}</button>
              </div>}
              {range && <div className="range-picker">
                <p><strong>Select the confusing part</strong> · Drag across the timeline or adjust the start and end.</p>
                <div className="range-track" aria-hidden="true"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    rangeStart.current = timelinePosition(event);
                    updateRange(event);
                  }}
                  onPointerMove={updateRange}
                  onPointerUp={(event) => { updateRange(event); rangeStart.current = null; }}
                  onPointerCancel={() => { rangeStart.current = null; }}>
                  <span style={{ left: (range[0] / duration * 100) + '%', width: ((range[1] - range[0]) / duration * 100) + '%' }} />
                </div>
                <div className="range-fields">
                  <label>Start · {clock(range[0])}<input type="range" min="0" max={duration} step="0.1" value={range[0]} onChange={(event) => {
                    const start = Number(event.target.value);
                    setRange([start, Math.max(start, range[1])]);
                  }} /></label>
                  <label>End · {clock(range[1])}<input type="range" min="0" max={duration} step="0.1" value={range[1]} onChange={(event) => {
                    const end = Number(event.target.value);
                    setRange([Math.min(range[0], end), end]);
                  }} /></label>
                </div>
                <div className="actions">
                  <button className="primary" disabled={range[1] - range[0] < 0.25 || busy} onClick={() => {
                    const selected = range;
                    setRange(null);
                    coach('recover', { anchor: selected[0], returnTime: latestTime.current, range: selected });
                  }}>Help with {clock(range[0])}–{clock(range[1])}</button>
                  <button onClick={() => setRange(null)}>Cancel</button>
                </div>
              </div>}
              {breakState !== 'idle' && !coachOpen && !busy && !range && !origin && !focus &&
                profile.breakReminders !== false && <div className="toolbar checkpoint" aria-label="Break reminder">
                  {breakState === 'suggested' ? <>
                    <span role="status">Good spot for a short break?</span>
                    <button onClick={() => dismissBreak(true)}>Take a break</button>
                    <button className="quiet" onClick={() => dismissBreak(false)}>Keep watching</button>
                  </> : <>
                    <span role="status">Your lecture is paused. Come back when you’re ready.</span>
                    <button onClick={() => player.current?.play().catch(() => {})}>Resume lecture</button>
                  </>}
                </div>}
              {showCheck && <div className="toolbar checkpoint">
                <span>Ready to check this concept?</span>
                <button onClick={() => { setDismissedCheck(checkKey); coach('check'); }}>Try a quick check</button>
                <button className="quiet" onClick={() => setDismissedCheck(checkKey)}>Skip</button>
              </div>}
            </div>
            </div>}
            <div className="lecture-rail">
            <section className={cues.length ? "card content transcript" : "transcript transcript-empty"} aria-label="Transcript">
              {cues.length > 0 && !focus && <div className="side-title"><h3>Transcript</h3><button onClick={() => openPicker('transcript')}>Select transcript</button></div>}
              {!cues.length && <button className="dropzone caption-drop" onClick={() => openPicker('transcript')}>
                <span className="drop-plus" aria-hidden="true">≡</span>
                <strong>Select transcript</strong>
                <small>{selectedTranscript ? transcriptStatus || 'Loading transcript…' : 'Choose the matching lecture transcript'}</small>
              </button>}
              <div ref={transcriptLines} hidden={Boolean(focus)} className="cue-list" aria-label="Transcript lines" role="region" tabIndex={cues.length ? 0 : undefined}>
              {cues.map((cue, index) => <button className={'cue ' + (index === currentCue ? 'current ' : '') + (panel?.source?.lecture === active?.id && panel?.source && panel.source.time === cue.time ? 'recommended' : '')}
                key={index} onClick={() => { setFocus(cue); setTerm(''); setAskDefinition(false); }}>
                <time>{clock(cue.time)}</time><span>{cue.text}</span>
              </button>)}
              </div>
              {focus && <div className="selection">
                <button className="quiet back-to-transcript" onClick={() => {
                  const index = cues.indexOf(focus);
                  setFocus(null);
                  requestAnimationFrame(() => transcriptLines.current?.children[index]?.focus({ preventScroll: true }));
                }}>← Back to transcript</button>
                <h3>Selected line · {clock(focus.time)}</h3>
                <div className="line-actions">
                  <button ref={lineHelpButton} className="primary" disabled={busy} onClick={() => coach('recover', { anchor: focus.time, returnTime: latestTime.current, selection: focus.text })}>Help with this line</button>
                  <button onClick={() => goTo(active, focus.time)}>Jump to {clock(focus.time)}</button>
                  <button disabled={busy} aria-expanded={askDefinition} onClick={() => setAskDefinition(!askDefinition)}>Define a term</button>
                </div>
                {askDefinition && <form className="actions" onSubmit={(event) => { event.preventDefault(); coach('define', { anchor: focus.time, selection: term }); }}>
                  <label>Term from this line<input required value={term} onChange={(event) => setTerm(event.target.value)} maxLength={80} /></label>
                  <button disabled={busy || !term.trim()}>Explain term</button>
                </form>}
              </div>}
            </section>
        <details id="settings" className="settings-panel card"><summary>Settings</summary><section className="card content settings">
          <label>First help format<select value={profile.preference} onChange={(event) => setProfile({ ...profile, preference: event.target.value })}>
            {Object.entries(formats).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="auto">Use my most selected format</option>
          </select></label>
          <label>Analogy interest<select value={profile.analogyInterest || ''} onChange={(event) =>
            setProfile((state) => ({ ...state, analogyInterest: event.target.value }))}>
            <option value="">No preference</option>
            {Object.entries(analogyInterests).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="checkbox"><input type="checkbox" checked={profile.breakReminders !== false}
            onChange={(event) => {
              const enabled = event.target.checked;
              setProfile((state) => ({ ...state, breakReminders: enabled }));
              if (!enabled) setBreakState('idle');
            }} /> Suggest study breaks</label>
          <label>Coach access code<input type="password" value={code} onChange={(event) => { setCode(event.target.value); sessionStorage.setItem('coach-code', event.target.value); }} /></label>
          <p>Coaching sends selected transcript excerpts, check responses, and your analogy preference to Gemini.</p>
        </section></details>
            </div>
            {coachOpen && <section ref={coachRegion} className="coach-inline card" aria-labelledby="coach-title">
              <div className="coach-sheet">
              <ReadAloud key={panel?.question?.id || panel?.mode || "loading"} code={code}>
              {busy && <><h2 id="coach-title">Finding the right help</h2><p role="status">Looking through the lecture transcript…</p><button onClick={() => setCoachOpen(false)}>Back to video</button></>}
              {panel && <>
                <div className="side-title"><h2 id="coach-title">{panel.mode === 'returned' ? 'You’re back at ' + clock(panel.anchor) : panel.mode === 'recover' ? 'Let’s find what you missed' : panel.mode === 'define' ? 'In this lecture' : panel.mode === 'error' ? 'Coach unavailable' : 'Check your understanding'}</h2>
                  <button className="quiet" onClick={() => setCoachOpen(false)}>Close</button></div>
              {panel.mode === 'error' ? <p>{panel.message}</p> : panel.mode === 'returned' ? <>
                <p>Want to see how the idea you reviewed connects to what comes next?</p>
                <div className="actions"><button className="primary" onClick={() => coach('transfer', panel)}>Try a connection check</button>
                <button onClick={() => { setCoachOpen(false); player.current?.play().catch(() => {}); }}>Continue watching</button></div>
              </> : <>
                {panel.mode === 'recover' && <>
                  {panel.selectedRange && <p className="subtle">Selected segment · {clock(panel.selectedRange[0])}–{clock(panel.selectedRange[1])}</p>}
                  {origin && <p className="subtle">Your place is saved at {clock(origin.time)}.</p>}
                  {format === 'clip' && <>{sourceText && <button className="source recovery-source" onClick={() => {
                    chooseFormat('clip');
                    setCoachOpen(false);
                    goTo(sourceLecture, panel.source.time);
                  }}><strong>{panel.source.fallback === 'lead-up' ? 'Replay the lead-up'
                    : panel.source.fallback === 'start' ? 'Replay from the start'
                    : panel.source.fallback === 'previous' ? 'Open the previous lecture'
                    : 'Go to the earlier clip'}</strong><span>{sourceText}</span></button>}
                  {panel.unavailable && <p className="subtle">{panel.unavailable}</p>}
                  {!panel.unavailable && <div className="actions recovery-formats">{Object.entries(formats).filter(([value]) => value !== 'clip').sort(([a], [b]) => Number(b === preferred) - Number(a === preferred)).map(([value, label]) =>
                    <button key={value} aria-pressed={format === value} onClick={() => chooseFormat(value)}>{label}</button>)}
                    <button onClick={() => coach('practice', { anchor: panel.anchor, lecture: panel.lecture })}>Try a practice question →</button>
                  </div>}</>}
                  {format !== 'clip' && <button className="quiet" onClick={() => setFormat('clip')}>← Back to help options</button>}
                  {format === 'analogy' && <div className="explanation">
                    <p>{panel.explanation}</p>
                    {panel.analogy && <div className="analogy">
                      <h4>Think of it this way</h4>
                      <p>{panel.analogy.scenario}</p>
                      <ul>{panel.analogy.connections.map((connection, index) => <li key={index}>{connection}</li>)}</ul>
                    </div>}
                  </div>}
                  {format === 'visual' && (panel.steps.length ? <div className="diagram">
                    {panel.steps.slice(0, step + 1).map((item, index) => <div key={index}><span>{index + 1}</span>{item}</div>)}
                    {step < panel.steps.length - 1 && <button onClick={() => setStep(step + 1)}>Next step →</button>}
                  </div> : <p>{panel.explanation}</p>)}
                </>}
                {panel.mode === 'define' && <p>{panel.explanation}</p>}
                {panel.question && ['practice', 'check', 'transfer'].includes(panel.mode) ? <>
                  {panel.question.shortPrompt && <div className="actions" aria-label="Answer format">
                    <button aria-pressed={answerFormat === 'choice'} onClick={() => setAnswerFormat('choice')}>Multiple choice</button>
                    <button aria-pressed={answerFormat === 'short'} onClick={() => setAnswerFormat('short')}>Short answer</button>
                  </div>}
                  {answerFormat === 'short' && panel.question.shortPrompt
                    ? <ShortAnswer question={panel.question} code={code} />
                    : <>
                  <p className="question">{panel.question.prompt}</p>
                  <div className="answers">{panel.question.options.map((option, index) =>
                    <button key={index} aria-pressed={answer === index} onClick={() => {
                      setAnswer(index);
                      setShowReasoning(false);
                    }}>{option}</button>)}</div>
                  <div className="actions">
                    {panel.question.hint && answer !== panel.question.correct &&
                      <button aria-pressed={showHint} onClick={() => setShowHint(!showHint)}>Get a hint</button>}
                    <button aria-pressed={answer === 3} onClick={() => { setAnswer(3); setShowHint(true); setShowReasoning(false); }}>I don’t know</button>
                  </div>
                  {showHint && answer !== panel.question.correct && panel.question.hint && <p className="feedback">{panel.question.hint}</p>}
                  {answer === panel.question.correct && <p className="feedback"><strong>Correct.</strong> {panel.question.why}</p>}
                  {answer != null && answer !== panel.question.correct && <>
                    {answer !== 3 && <p className="feedback">{panel.question.feedback?.[answer] || 'Try again, or reveal the reasoning below.'}</p>}
                    <button aria-pressed={showReasoning} onClick={() => setShowReasoning(!showReasoning)}>Show reasoning</button>
                    {showReasoning && <p>{panel.question.why}</p>}
                  </>}
                  <div className="actions">
                    {answer != null && answer !== panel.question.correct && <button className="primary" onClick={() => coach('recover', {
                      lecture: origin?.lecture || panel.lecture, anchor: recoveryMenu.current?.anchor ?? origin?.time ?? panel.anchor,
                      range: recoveryMenu.current?.selectedRange,
                      earlierThan: panel.mode === 'practice' && panel.reviewSource?.lecture === panel.lecture.id ? panel.reviewSource.time : undefined,
                      selection: panel.question.prompt + ' Student response: ' + (panel.question.options[answer] || 'I don’t know'),
                    })}>Find an earlier explanation</button>}
                    {panel.mode === 'practice' && answer === panel.question.correct &&
                      <button onClick={() => coach('practice', { anchor: panel.anchor, lecture: panel.lecture, previousQuestions: [...(panel.previousQuestions || []), panel.question.prompt] })}>Try another</button>}
                  </div>
                  </>}
                  <button onClick={() => mark(panel.lecture, panel.anchor, panel.question)}>☆ Save question</button>
                </> : ['practice', 'check', 'transfer'].includes(panel.mode) && <p>A question couldn’t be generated. Try again with a more specific point in the lecture.</p>}
              </>}
              {panel.mode !== 'recover' && recoveryMenu.current && origin && <button className="quiet" onClick={() => { setPanel(recoveryMenu.current); setFormat('clip'); }}>← Back to help options</button>}
              {origin && <div className="sheet-footer"><button className="return" onClick={returnToLecture}>Return to {clock(origin.time)}</button></div>}
              </>}
              </ReadAloud>
              </div>
            </section>}
            {resume && <section className="card content resume-card">
              <h3>Pick up at {clock(resumeTime)}</h3>
              {cues[resumeIndex] && <p>{cues[resumeIndex].text}</p>}
              {cues[resumeIndex + 1] && <p><strong>Up next</strong> · {cues[resumeIndex + 1].text}</p>}
              <div className="actions">
                <button className="primary" onClick={() => goTo(active, resumeTime)}>Resume at {clock(resumeTime)}</button>
                {cues.slice(Math.max(0, resumeIndex - 2), resumeIndex + 1).map((cue, index) =>
                  <button key={index} onClick={() => goTo(active, cue.time)}>Replay {clock(cue.time)}</button>)}
                {cues.length > 0 && <button onClick={() => coach('check', { anchor: resumeTime })}>Try a refresher check</button>}
              </div>
            </section>}
          </div>
        <section id="library" className="library-below" aria-labelledby="review-heading">
          <h2 id="review-heading">Review your lectures</h2>
          <div className="review-grid">
          {playlist}
          <div className="card content review">
          <h2>Saved questions &amp; clips</h2>
          {!profile.marks.length && <p>Save a lecture timestamp or practice question to find it here.</p>}
          {profile.marks.map((item) => {
            const lecture = lectures.find((entry) => entry.id === item.lecture);
            if (!lecture) return null;
            return <div className="review-item" key={item.id}><div><h3>{item.question?.prompt || lecture.title}</h3><p>{lecture.course} · {clock(item.time)}</p></div>
              <div className="actions">
                <button onClick={() => {
                  openLecture(lecture, item.time);
                  if (item.question) {
                    setShowHint(false);
                    setShowReasoning(false);
                    setCoachOpen(true);
                    setPanel({ mode: 'check', question: item.question, anchor: item.time, lecture });
                  }
                }}>{item.question ? 'Try question' : 'Open clip'}</button>
                <button onClick={() => setProfile((state) => ({ ...state, marks: state.marks.filter((mark) => mark.id !== item.id) }))}>Remove</button>
              </div>
            </div>;
          })}
        </div>
        </div>
        </section>
        </section>
        <dialog ref={selectionDialog} className="coach-dialog" aria-labelledby="picker-title">
          <div className="coach-sheet">
            <div className="side-title"><h2 id="picker-title">{picker === 'video' ? 'Select video' : 'Select transcript'}</h2>
              <button className="quiet" onClick={() => selectionDialog.current?.close()}>Cancel</button></div>
            {(picker === 'transcript' && active ? [active] : lectures).map((lecture) => <button key={lecture.id} className="lecture"
                onClick={() => {
                  selectionDialog.current?.close();
                  if (picker === 'video') openLecture(lecture);
                  else {
                    if (!active) openLecture(lecture);
                    setSelectedTranscript(lecture.transcript);
                  }
                }}>
                <span aria-hidden="true">{picker === 'video' ? '▷' : '≡'}</span>
                <span>{lecture.title}<small>{lecture.course} · {picker === 'video' ? lecture.instructor : 'English · timestamped'}</small></span>
              </button>)}
          </div>
        </dialog>
      </main>
    </>
  );
}