'use strict';

const byId = id => document.getElementById(id);
const progressKey = 'last-witness.progress.v1';
const notesFontKey = 'last-witness.notes-font.v1';
const vocabularyFilterKey = 'last-witness.vocabulary-filter.v1';
const warning = 'No confíe en él. La llave no es suya.';
const key = text => text.normalize('NFC').trim().toLowerCase();
const alternatives = text => text.split(' / ');
let book;
let recordings;
let section = 'spanish';
const progress = readStore(progressKey);
let useSansSerif = readStore(notesFontKey).sansSerif === true;
let hideMastered = readStore(vocabularyFilterKey).hideMastered === true;
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
  player.onerror = null;
  window.speechSynthesis?.cancel();
}

async function play(phrase, rate = 1) {
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
    speech.onerror = () => { if (attempt === playback) status('The Spanish system voice could not play.'); };
    status('Using system voice · ' + voice.lang);
    window.speechSynthesis.speak(speech);
  };
  status();
  if (!recording) return fallback();
  player.src = recording.file;
  player.playbackRate = rate;
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
  const filter = byId('hide-mastered');
  const empty = node('p', 'All entries in this chapter are mastered. Uncheck Hide mastered to see them again.', 'muted');
  const ids = [...new Set(book.chapters.flatMap(item => item.vocabulary.map(row => key(row[0]))))];
  const update = () => {
    const count = rows => rows.filter(id => progress[id] === 'Mastered').length;
    totals.textContent = count(chapter.vocabulary.map(row => key(row[0]))) + ' of ' + chapter.vocabulary.length
      + ' mastered in this chapter · ' + count(ids) + ' of ' + ids.length + ' overall';
    for (const entry of list.children) entry.hidden = hideMastered && entry.classList.contains('mastered');
    empty.hidden = !hideMastered || Boolean(list.querySelector('.entry:not([hidden])'));
  };
  totals.setAttribute('aria-live', 'polite');
  target.append(totals, list, empty);
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
      if (hideMastered && mastered.checked && document.activeElement === mastered) {
        const remaining = [...list.querySelectorAll('.entry:not(.mastered) input')];
        const next = remaining.find(input => mastered.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
        (next ?? remaining.at(-1) ?? filter).focus();
      }
      update();
    });
    const phrases = alternatives(spanish);
    for (const phrase of phrases) controls.append(playbackControls(phrase, phrases.length > 1));
    entry.append(meanings, label, controls);
    list.append(entry);
  }
  update();
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
  target.append(notes);
}

function setNotesFont(sansSerif) {
  useSansSerif = sansSerif;
  byId('notebook').classList.toggle('standard-notes', sansSerif);
  byId('handwritten').setAttribute('aria-pressed', String(!sansSerif));
  byId('standard-font').setAttribute('aria-pressed', String(sansSerif));
}

function render() {
  stopAudio();
  status();
  const chapter = selectedChapter();
  const target = byId('notebook');
  target.classList.toggle('case-page', section === 'case');
  byId('selected-chapter-title').textContent = chapter.title;
  const margin = node('header', '', 'chapter-margin');
  margin.append(node('p', 'Chapter ' + chapter.number, 'chapter-number'), node('h2', chapter.title));
  const page = node('div', '', 'chapter-page');
  page.append(node('p', chapter.intro, 'chapter-intro'));
  target.replaceChildren(margin, page);
  byId('spanish').setAttribute('aria-pressed', section === 'spanish');
  byId('case').setAttribute('aria-pressed', section === 'case');
  if (section === 'spanish') renderVocabulary(chapter, page);
  else renderNotes(chapter, page);
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
    chapter.add(new Option('Chapter ' + item.number, item.number));
  }
  chapter.disabled = false;
  chapter.addEventListener('change', render);
  for (const id of ['spanish', 'case']) byId(id).addEventListener('click', () => { section = id; render(); });
  const filter = byId('hide-mastered');
  filter.checked = hideMastered;
  filter.addEventListener('change', () => {
    hideMastered = filter.checked;
    if (section === 'spanish') render();
    saveStore(vocabularyFilterKey, {hideMastered});
  });
  for (const [id, sansSerif] of [['handwritten', false], ['standard-font', true]]) {
    byId(id).addEventListener('click', () => {
      setNotesFont(sansSerif);
      status();
      saveStore(notesFontKey, {sansSerif});
    });
  }
  setNotesFont(useSansSerif);
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
