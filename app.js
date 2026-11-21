'use strict';

const byId = id => document.getElementById(id);
const progressKey = 'last-witness.progress.v1';
const reviewKey = 'last-witness.audio-review.v1';
const notesFontKey = 'last-witness.notes-font.v1';
const backupStates = ['Learning', 'Practicing', 'Mastered'];
const warning = 'No confíe en él. La llave no es suya.';
const key = text => text.normalize('NFC').trim().toLowerCase();
const alternatives = text => text.split(' / ');
let book;
let recordings;
let section = 'spanish';
let progress = readStore(progressKey);
let flags = readStore(reviewKey);
let useSansSerif = readStore(notesFontKey).sansSerif === true;
let playback = 0;
const player = new Audio();

function readStore(name) {
  try {
    const value = JSON.parse(localStorage.getItem(name));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function saveStore(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    status('Storage is unavailable. Changes will last until you close this page.');
  }
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function status(message = '') {
  byId('status').textContent = message;
}

function button(text, action, className) {
  const element = node('button', text, className);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function stopAudio() {
  playback += 1;
  player.pause();
  player.onended = null;
  player.onerror = null;
  window.speechSynthesis?.cancel();
}

async function play(phrase, rate = 1, ended = () => {}) {
  stopAudio();
  const attempt = playback;
  const recording = recordings.get(key(phrase));
  const fallback = () => {
    if (attempt !== playback) return;
    player.onerror = null;
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const voice = voices.find(item => item.lang.replace('_', '-').toLowerCase() === 'es-mx')
      ?? voices.find(item => /^es(?:[-_]|$)/i.test(item.lang));
    if (!voice) {
      status('Audio could not play. Try again after a Spanish system voice loads.');
      return;
    }
    const speech = new SpeechSynthesisUtterance(phrase);
    speech.voice = voice;
    speech.lang = voice.lang;
    speech.rate = rate;
    speech.onend = () => { if (attempt === playback) ended(); };
    speech.onerror = () => { if (attempt === playback) status('The Spanish system voice could not play.'); };
    status('Using system voice · ' + voice.lang);
    window.speechSynthesis.speak(speech);
  };
  status();
  if (!recording) return fallback();
  player.src = recording.file;
  player.playbackRate = rate;
  player.onended = () => { if (attempt === playback) ended(); };
  try {
    await player.play();
    if (attempt === playback) player.onerror = fallback;
  } catch {
    fallback();
  }
}

function playButton(phrase, distinguish = false, slow = false) {
  const text = slow ? 'Slow' : '▶ Listen';
  const control = button(text, () => play(phrase, slow ? 0.75 : 1), 'audio' + (slow ? ' slow' : ''));
  control.setAttribute('aria-label', (slow ? 'Listen slowly to ' : 'Listen to ') + phrase);
  if (distinguish && !slow) {
    const label = node('span', phrase);
    label.lang = 'es-MX';
    control.replaceChildren('▶ ', label);
  }
  return control;
}

function playbackControls(phrase, distinguish = false) {
  const group = node('div', '', 'playback');
  group.append(playButton(phrase, distinguish), playButton(phrase, false, true));
  return group;
}

function selectedChapter() {
  return book.chapters.find(item => String(item.number) === byId('chapter').value);
}

function renderVocabulary(chapter, target) {
  const list = node('ul', '', 'entries');
  const totals = node('p', '', 'muted');
  const ids = [...new Set(book.chapters.flatMap(item => item.vocabulary.map(row => key(row[0]))))];
  const update = () => {
    const count = rows => rows.filter(id => progress[id] === 'Mastered').length;
    totals.textContent = count(chapter.vocabulary.map(row => key(row[0]))) + ' of ' + chapter.vocabulary.length
      + ' mastered in this chapter · ' + count(ids) + ' of ' + ids.length + ' overall';
  };
  totals.setAttribute('aria-live', 'polite');
  update();
  target.append(totals, list);
  for (const [spanish, english, context] of chapter.vocabulary) {
    const id = key(spanish);
    const meanings = node('div');
    const term = node('strong', spanish);
    term.lang = 'es-MX';
    meanings.append(term, node('p', english));
    if (context) {
      const note = node('small');
      addInline(note, context);
      meanings.append(note);
    }
    const controls = node('div', '', 'controls entry-audio');
    const mastered = node('input');
    mastered.type = 'checkbox';
    mastered.checked = progress[id] === 'Mastered';
    mastered.setAttribute('aria-label', 'Mastered: ' + spanish);
    const label = node('label', '', 'mastery');
    label.append(mastered, ' Mastered');
    const entry = node('li', '', 'entry');
    entry.classList.toggle('mastered', mastered.checked);
    mastered.addEventListener('change', () => {
      if (mastered.checked) progress[id] = 'Mastered';
      else delete progress[id];
      entry.classList.toggle('mastered', mastered.checked);
      status();
      saveStore(progressKey, progress);
      update();
    });
    const phrases = alternatives(spanish);
    for (const phrase of phrases) controls.append(playbackControls(phrase, phrases.length > 1));
    entry.append(meanings, label, controls);
    list.append(entry);
  }
}

function addInline(target, text) {
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
    if (part.startsWith('**') && part.endsWith('**')) target.append(node('strong', part.slice(2, -2)));
    else if (part.startsWith('*') && part.endsWith('*')) {
      const emphasis = node('em', part.slice(1, -1));
      if (part.includes(warning)) emphasis.lang = 'es-MX';
      target.append(emphasis);
    }
    else target.append(part);
  }
}

function renderNotes(chapter, target) {
  const notes = node('div', '', 'case-notes');
  const fontSetting = node('div', '', 'notes-font-setting');
  fontSetting.setAttribute('role', 'group');
  fontSetting.setAttribute('aria-label', 'Case Notes font');
  const setFont = (sansSerif, persist = false) => {
    useSansSerif = sansSerif;
    notes.classList.toggle('sans-serif', sansSerif);
    handwritten.setAttribute('aria-pressed', String(!sansSerif));
    standard.setAttribute('aria-pressed', String(sansSerif));
    if (persist) saveStore(notesFontKey, {sansSerif});
  };
  const handwritten = button('Handwritten', () => setFont(false, true));
  const standard = button('Standard Font', () => setFont(true, true));
  fontSetting.append(handwritten, standard);
  setFont(useSansSerif);
  for (const block of chapter.notes.split(/\n\s*\n/)) {
    if (block.startsWith('### ')) {
      notes.append(node('h3', block.slice(4)));
    } else if (/^(?:- |1\. )/.test(block)) {
      const list = node(block.startsWith('- ') ? 'ul' : 'ol');
      for (const line of block.split('\n')) {
        const item = node('li');
        addInline(item, line.replace(/^(?:- |\d+\. )/, ''));
        list.append(item);
      }
      notes.append(list);
    } else if (block.startsWith('>')) {
      const quote = node('blockquote', '', 'evidence');
      for (const line of block.split('\n').map(item => item.replace(/^>\s*/, '')).filter(Boolean)) {
        const paragraph = node('p');
        addInline(paragraph, line);
        quote.append(paragraph);
      }
      notes.append(quote);
    } else {
      const paragraph = node('p', '', block.includes(warning) ? 'evidence' : '');
      addInline(paragraph, block);
      notes.append(paragraph);
    }
    if (block.includes(warning)) notes.append(playbackControls(warning));
  }
  target.append(fontSetting, notes);
}

function renderReview(chapter) {
  const phrases = [...new Set(book.chapters.filter(item => item.number <= chapter.number)
    .flatMap(item => item.vocabulary.flatMap(row => alternatives(row[0])))), warning];
  const list = node('ul', '', 'recording-list');
  let sequence = 0;
  const sequenceStatus = node('p', '', 'muted');
  sequenceStatus.setAttribute('role', 'status');
  const next = () => {
    if (sequence >= phrases.length) {
      sequenceStatus.textContent = 'Playback complete.';
      return;
    }
    const phrase = phrases[sequence++];
    sequenceStatus.textContent = sequence + ' of ' + phrases.length + ' · ' + phrase;
    play(phrase, 1, next);
  };
  const controls = node('div', '', 'controls');
  controls.append(button('Play in order', () => { sequence = 0; next(); }), button('Stop', () => {
    stopAudio();
    sequenceStatus.textContent = 'Playback stopped.';
  }));
  const voice = recordings.get(key(warning));
  for (const phrase of phrases) {
    const id = key(phrase);
    const line = node('li', '', 'controls');
    const label = node('label');
    const flag = node('input');
    flag.type = 'checkbox';
    flag.checked = flags[id] === true;
    flag.addEventListener('change', () => {
      flags[id] = flag.checked;
      saveStore(reviewKey, flags);
    });
    label.append(flag, ' Flag ' + phrase);
    line.append(playButton(phrase, true), button('Slow', () => play(phrase, 0.75)), label);
    list.append(line);
  }
  byId('recordings').replaceChildren(node('p', voice.voice + ' · Mexican Spanish (es-MX)'), controls, sequenceStatus, list);
}

function render() {
  stopAudio();
  status();
  const chapter = selectedChapter();
  const target = byId('notebook');
  const margin = node('header', '', 'chapter-margin');
  margin.append(node('p', 'Chapter ' + chapter.number, 'chapter-number'), node('h2', chapter.title));
  const page = node('div', '', 'chapter-page');
  page.append(node('p', chapter.intro, 'chapter-intro'));
  target.replaceChildren(margin, page);
  byId('spanish').setAttribute('aria-pressed', section === 'spanish');
  byId('case').setAttribute('aria-pressed', section === 'case');
  if (section === 'spanish') renderVocabulary(chapter, page);
  else renderNotes(chapter, page);
  renderReview(chapter);
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

async function start() {
  const [data, audio] = await Promise.all([loadJSON('data/notebooks.json'), loadJSON('audio/manifest.json')]);
  book = data;
  recordings = new Map(Object.values(audio.recordings).map(record => [key(record.text), record]));
  const chapter = byId('chapter');
  for (const item of book.chapters.filter(item => item.number <= book.latestReleasedChapter)) {
    chapter.add(new Option('Chapter ' + item.number + ' · ' + item.title, item.number));
  }
  chapter.disabled = false;
  chapter.addEventListener('change', render);
  for (const id of ['spanish', 'case']) byId(id).addEventListener('click', () => { section = id; render(); });
  byId('reset').onclick = () => {
    if (!confirm('Reset all vocabulary progress on this device?')) return;
    progress = {};
    render();
    saveStore(progressKey, progress);
  };
  byId('export').onclick = () => {
    const file = new Blob([JSON.stringify({version: 1, progress}, null, 2)], {type: 'application/json'});
    const link = node('a');
    link.href = URL.createObjectURL(file);
    link.download = 'last-witness-progress.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const backup = byId('backup');
  byId('import').onclick = () => backup.click();
  backup.onchange = async () => {
    const file = backup.files[0];
    backup.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !data.progress || Array.isArray(data.progress) || typeof data.progress !== 'object') throw new Error();
      const entries = Object.entries(data.progress);
      if (entries.some(([, state]) => !backupStates.includes(state))) throw new Error();
      if (!confirm('Merge this backup into your progress? Matching entries will use the backup state.')) return;
      progress = {...progress, ...Object.fromEntries(entries)};
      render();
      status('Progress imported.');
      saveStore(progressKey, progress);
    } catch {
      status('This file is not a valid notebook progress backup.');
    }
  };
  render();
  if ('serviceWorker' in navigator) {
    try {
      let previousController = navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (previousController && !reloading) {
          reloading = true;
          location.reload();
        }
        previousController = navigator.serviceWorker.controller;
      });
      const registration = await navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'});
      const checkForUpdate = () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      checkForUpdate();
      await navigator.serviceWorker.ready;
      byId('offline').textContent = 'Notebook and recordings ready for offline use.';
    } catch {
      byId('offline').textContent = 'Offline setup was unavailable.';
    }
  }
}

start().catch(() => status('The notebook could not open. Reload the page to try again.'));
