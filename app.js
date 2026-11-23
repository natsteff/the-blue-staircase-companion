'use strict';

const byId = id => document.getElementById(id);
const progressKey = 'last-witness.progress.v1';
const notesFontKey = 'last-witness.notes-font.v1';
const vocabularyFilterKey = 'last-witness.vocabulary-filter.v1';
const warning = 'No confíe en él. La llave no es suya.';
const key = text => text.normalize('NFC').trim().toLowerCase();
const speechKey = text => key(text).replace(/(?<!\.)\.$/, "");
const alphabetical = new Intl.Collator("es-MX", {ignorePunctuation: true});
const alternatives = text => text.split(' / ');
let book;
let recordings;
let section = 'spanish';
const progress = readStore(progressKey);
let useSansSerif = readStore(notesFontKey).sansSerif === true;
let hideMastered = readStore(vocabularyFilterKey).hideMastered === true;
let sortAlphabetically = false;
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
  const recording = recordings.get(speechKey(phrase));
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
  const control = button(text, () => play(phrase, slow ? 0.5 : 1), 'audio' + (slow ? ' slow' : ''));
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

function vocabularyEntries(chapters) {
  const entries = new Map();
  for (const chapter of chapters) {
    for (const row of chapter.vocabulary) {
      const id = speechKey(row[0]);
      if (!entries.has(id)) entries.set(id, {row, chapters: []});
      if (chapter.number) entries.get(id).chapters.push(chapter.number);
    }
  }
  const result = [...entries.values()];
  if (section === 'spanish' && sortAlphabetically) {
    result.sort((left, right) => alphabetical.compare(left.row[0], right.row[0]));
  }
  return result;
}

function wordRow([spanish, english, context], chapters = []) {
  const entry = node('li', '', 'entry');
  const meanings = node('div');
  const term = node('strong', spanish);
  term.lang = 'es-MX';
  const translation = node('p');
  addInline(translation, english ?? 'Unknown');
  meanings.append(term, translation);
  if (context) {
    const note = node('small');
    addInline(note, context);
    meanings.append(note);
  }
  if (chapters.length) {
    const label = chapters.length === 1 ? 'Chapter ' : 'Chapters ';
    meanings.append(node('p', label + chapters.join(', '), 'entry-chapters'));
  }
  const controls = node('div', '', 'controls entry-audio');
  const phrases = alternatives(spanish);
  for (const phrase of phrases) controls.append(playbackControls(phrase, phrases.length > 1));
  entry.append(meanings, controls);
  return {entry, controls};
}

function renderVocabulary(chapters, target, cumulative) {
  const entries = vocabularyEntries(chapters);
  const chapter = chapters[0];
  const evidenceBefore = !cumulative && !sortAlphabetically && chapter.evidenceBefore;
  const storyEvidence = evidenceBefore
    ? new Map(chapterEvidence(chapter).map(row => [row[0], row]))
    : new Map();
  const list = node('ul', '', 'entries');
  const totals = node('p', '', 'muted');
  const empty = node('p', 'All vocabulary in this list is mastered. Switch to Show All to see them again.', 'muted');
  const update = () => {
    const count = entries.filter(({row}) => progress[speechKey(row[0])] === 'Mastered').length;
    totals.textContent = count + ' of ' + entries.length + ' mastered'
      + (cumulative ? ' through Chapter ' + chapters.at(-1).number : '');
    for (const entry of list.children) entry.hidden = hideMastered && entry.classList.contains('mastered');
    empty.hidden = !hideMastered || count < entries.length;
  };
  totals.setAttribute('aria-live', 'polite');
  target.append(totals, list, empty);

  for (const {row, chapters: references} of entries) {
    const id = speechKey(row[0]);
    for (const phrase of evidenceBefore?.[row[0]] ?? []) {
      const [spanish, english, context] = storyEvidence.get(phrase);
      list.append(wordRow([spanish, english ?? 'Untranslated', context]).entry);
    }
    const {entry, controls} = wordRow(row, cumulative ? references : []);
    const mastered = node('input');
    mastered.type = 'checkbox';
    mastered.checked = progress[id] === 'Mastered';
    mastered.setAttribute('aria-label', 'Mastered: ' + row[0]);
    const label = node('label', '', 'mastery');
    label.append(mastered, ' Mastered');
    entry.insertBefore(label, controls);
    entry.classList.toggle('mastered', mastered.checked);
    mastered.addEventListener('change', () => {
      progress[id] = mastered.checked ? 'Mastered' : 'Learning';
      entry.classList.toggle('mastered', mastered.checked);
      status();
      saveStore(progressKey, progress);
      if (hideMastered && mastered.checked && document.activeElement === mastered) {
        const remaining = [...list.querySelectorAll('.entry:not(.mastered) input')];
        const next = remaining.find(input => mastered.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
        (next ?? remaining.at(-1) ?? byId('hide-mastered')).focus();
      }
      update();
    });
    list.append(entry);
  }
  update();
  return Boolean(evidenceBefore);
}

function renderEvidence(chapters, target, cumulative) {
  const entries = new Map();
  for (const chapter of chapters) {
    for (const row of chapterEvidence(chapter)) {
      const id = speechKey(row[0]);
      if (!entries.has(id)) entries.set(id, {row, references: []});
      const evidence = entries.get(id);
      if (row[1]) evidence.row = row;
      evidence.references.push(chapter.number);
    }
  }
  for (const [title, translated] of [['Untranslated', false], ['Translated Evidence', true]]) {
    const matching = [...entries.values()].filter(({row}) => Boolean(row[1]) === translated);
    if (!matching.length) continue;
    if (sortAlphabetically) {
      matching.sort((left, right) => alphabetical.compare(left.row[0], right.row[0]));
    }
    const section = node('section', '', 'evidence-audio');
    const heading = node('h3', title);
    heading.id = translated ? 'translated-heading' : 'untranslated-heading';
    section.setAttribute('aria-labelledby', heading.id);
    const list = node('ul', '', 'entries');
    for (const {row, references} of matching) list.append(wordRow(row, cumulative ? references : []).entry);
    section.append(heading, list);
    target.append(section);
  }
}

function chapterEvidence(chapter) {
  if (chapter.evidence) return chapter.evidence;
  if (!chapter.notes.includes(warning)) return [];
  const translation = chapter.notes.split(/\n\s*\n/)
    .find(block => block.startsWith('>') && block.includes(warning))
    ?.match(/^> \*\*(.+)\*\*$/m)?.[1];
  return [[warning, translation]];
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
  }
  if (chapter.evidence) {
    const full = chapter.evidence.find(([spanish]) => speechKey(spanish) === speechKey(warning));
    if (full) {
      const quote = node('blockquote', '', 'evidence');
      const spanish = node('p', full[0]);
      spanish.lang = 'es-MX';
      quote.append(spanish);
      if (full[1]) quote.append(node('p', full[1]));
      notes.prepend(quote);
    }
  }
  target.append(notes);
}

function setNotesFont(sansSerif) {
  useSansSerif = sansSerif;
  byId('notebook').classList.toggle('standard-notes', sansSerif);
  byId('notes-font').setAttribute('aria-checked', String(sansSerif));
}

function renderTravelers(target) {
  const page = node('div', '', 'chapter-page');
  const heading = node('h2', 'Spanish Phrases for Travelers');
  const tips = node('p', '', 'chapter-intro');
  if (book.travelers.tip) addInline(tips, book.travelers.tip.split(' For grammar')[0]);
  const grammar = node('details', '', 'traveler-grammar');
  grammar.append(node('summary', 'Masculine, feminine, and “to be”'),
    node('p', 'Learn the article with the noun. El hotel is masculine and la llave is feminine.'),
    node('p', 'Use ser for identity or origin: Soy Sally. Use estar for location or condition: ¿Dónde está el hotel?'));
  page.append(heading, tips, grammar);
  renderVocabulary([book.travelers], page, false);
  target.append(page);
}

function render() {
  stopAudio();
  status();
  const chapter = selectedChapter();
  const target = byId('notebook');
  const traveler = section === 'travelers';
  const cumulative = byId('scope').value === 'through';
  const chapters = cumulative ? book.chapters.filter(item => item.number <= chapter.number) : [chapter];
  target.classList.toggle('case-page', section === 'case');
  target.classList.toggle('travelers-page', traveler);
  byId('selected-chapter-title').textContent = chapter.title;
  byId('scope').options[1].textContent = 'Through Chapter ' + chapter.number;
  byId('scope').closest('label').hidden = traveler;
  byId('vocabulary-sort').hidden = section !== 'spanish';
  byId('hide-mastered').hidden = section === 'case';
  byId('notes-font').hidden = section !== 'case';
  for (const id of ['travelers', 'spanish', 'case']) byId(id).setAttribute('aria-pressed', String(section === id));
  target.replaceChildren();
  if (traveler) {
    renderTravelers(target);
    return;
  }
  const margin = node('header', '', 'chapter-margin');
  const label = (cumulative ? 'Through Chapter ' : 'Chapter ') + chapter.number;
  margin.append(node('p', label, 'chapter-number'), node('h2', chapter.title));
  const page = node('div', '', 'chapter-page');
  target.append(margin, page);
  if (section === 'spanish') {
    if (!cumulative) page.append(node('p', chapter.intro, 'chapter-intro'));
    if (!renderVocabulary(chapters, page, cumulative)) {
      renderEvidence(chapters, page, cumulative);
    }
  } else {
    for (const item of chapters) {
      if (cumulative) page.append(node('h3', 'Chapter ' + item.number + ' · ' + item.title));
      page.append(node('p', item.intro, 'chapter-intro'));
      renderNotes(item, page);
    }
  }
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

async function start() {
  const [data, audio] = await Promise.all([loadJSON('data/notebooks.json'), loadJSON('audio/manifest.json')]);
  book = data;
  recordings = new Map(Object.values(audio.recordings).map(record => [speechKey(record.text), record]));
  for (const [legacy, parts] of [['sí / no', ['sí', 'no']], ['señora / señor', ['señora', 'señor']]]) {
    if (progress[legacy] === 'Mastered') {
      for (const part of parts) progress[part] ??= 'Mastered';
    }
  }
  const chapter = byId('chapter');
  for (const item of book.chapters.filter(item => item.number <= book.latestReleasedChapter)) {
    chapter.add(new Option('Chapter ' + item.number, item.number));
  }
  chapter.disabled = false;
  chapter.addEventListener('change', render);
  byId('travelers').hidden = !book.travelers;
  byId('scope').addEventListener('change', render);
  const sort = byId('vocabulary-sort');
  sort.addEventListener('click', () => {
    sortAlphabetically = !sortAlphabetically;
    sort.setAttribute('aria-checked', String(sortAlphabetically));
    render();
  });
  for (const id of ['travelers', 'spanish', 'case']) byId(id).addEventListener('click', () => { section = id; render(); });
  const filter = byId('hide-mastered');
  filter.setAttribute('aria-checked', String(hideMastered));
  filter.addEventListener('click', () => {
    hideMastered = !hideMastered;
    filter.setAttribute('aria-checked', String(hideMastered));
    if (section !== 'case') render();
    saveStore(vocabularyFilterKey, {hideMastered});
  });
  byId('notes-font').addEventListener('click', () => {
    setNotesFont(!useSansSerif);
    status();
    saveStore(notesFontKey, {sansSerif: useSansSerif});
  });
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
