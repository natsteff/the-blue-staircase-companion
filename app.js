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
  const target = byId('quiz-view').hidden ? 'status' : 'quiz-status';
  byId(target).textContent = message;
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
  const control = button(text, () => play(phrase, slow ? 0.7 : 1), 'audio' + (slow ? ' slow' : ''));
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

function wordRow([spanish, english, context, examples = []], chapters = []) {
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
  const phrases = [...alternatives(spanish), ...examples];
  for (const phrase of phrases) controls.append(playbackControls(phrase, phrases.length > 1));
  entry.append(meanings, controls);
  return {entry, controls};
}

let masteryNoticeTimer;

function showMasteryNotice(phrase, restore) {
  const notice = byId('mastery-notice');
  const message = byId('mastery-message');
  const dismiss = () => {
    clearTimeout(masteryNoticeTimer);
    notice.hidden = true;
    message.replaceChildren();
  };
  clearTimeout(masteryNoticeTimer);
  notice.hidden = false;
  message.replaceChildren(
    node('strong', '“' + phrase + '” marked as mastered.'),
    node('span', 'Hidden because Hide Mastered is on.')
  );
  const undo = button('Undo', () => {
    restore();
    dismiss();
  });
  const expire = () => {
    clearTimeout(masteryNoticeTimer);
    masteryNoticeTimer = setTimeout(dismiss, 5000);
  };
  undo.addEventListener('focus', () => clearTimeout(masteryNoticeTimer));
  undo.addEventListener('blur', expire);
  byId('mastery-action').replaceChildren(undo);
  expire();
}

function renderVocabulary(chapters, target, cumulative, entries = vocabularyEntries(chapters)) {
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
      + (cumulative && chapters.length > 1 ? ' through Chapter ' + chapters.at(-1).number : '');
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
      if (hideMastered && mastered.checked) {
        showMasteryNotice(row[0], () => {
          progress[id] = 'Learning';
          saveStore(progressKey, progress);
          if (entry.isConnected) {
            mastered.checked = false;
            entry.classList.remove('mastered');
            update();
            mastered.focus();
          } else {
            render();
            byId(section).focus();
          }
        });
      }
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
  // A single word can enter regular vocabulary after first appearing as untranslated evidence.
  const learned = new Set(cumulative ? chapters.flatMap(chapter => chapter.vocabulary
    .filter(row => row[1]).map(row => speechKey(row[0]))) : []);
  const evidenceGroups = [['Untranslated', false], ['Translated Evidence', true]];
  if (cumulative) evidenceGroups.reverse();
  for (const [title, translated] of evidenceGroups) {
    const matching = [...entries.values()].filter(({row}) =>
      Boolean(row[1]) === translated && (translated || !learned.has(speechKey(row[0]))));
    if (!matching.length) continue;
    if (cumulative && !translated) {
      byId('scope-evidence-note').hidden = false;
      byId('scope').setAttribute('aria-describedby', 'scope-evidence-note');
    }
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

function quizLauncher(heading) {
  const toolbar = node('div', '', 'quiz-launch');
  if (heading) toolbar.append(heading);
  const launch = button('Quiz Me', openQuiz);
  launch.id = 'quiz-me';
  toolbar.append(launch);
  return toolbar;
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
  page.append(quizLauncher(heading), tips, grammar);
  const {vocabulary, groups = {}} = book.travelers;
  const starts = vocabulary.flatMap(([phrase], index) => groups[phrase] ? [index] : []);
  if (starts[0] !== 0) starts.unshift(0);
  starts.forEach((start, index) => {
    const title = groups[vocabulary[start]?.[0]];
    if (title) page.append(node('h3', title, 'vocabulary-group-heading'));
    renderVocabulary([{vocabulary: vocabulary.slice(start, starts[index + 1])}], page, false);
  });
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
  target.classList.toggle('spanish-page', section === 'spanish');
  target.classList.toggle('travelers-page', traveler);
  byId('selected-chapter-title').textContent = chapter.title;
  byId('scope').options[1].textContent = 'Through Chapter ' + chapter.number;
  byId('scope').closest('label').hidden = traveler;
  byId('scope-evidence-note').hidden = true;
  byId('scope').removeAttribute('aria-describedby');
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
  if (section === 'spanish') target.append(quizLauncher());
  target.append(margin, page);
  if (section === 'spanish') {
    if (!cumulative) page.append(node('p', chapter.intro, 'chapter-intro'));
    if (chapters.length > 1 && !sortAlphabetically) {
      const entries = vocabularyEntries(chapters);
      for (const item of chapters) {
        const firstSeen = entries.filter(entry => entry.chapters[0] === item.number);
        if (!firstSeen.length) continue;
        page.append(node('h3', 'Chapter ' + item.number + ' · ' + item.title, 'vocabulary-group-heading'));
        renderVocabulary([item], page, true, firstSeen);
      }
      renderEvidence(chapters, page, true);
    } else if (!renderVocabulary(chapters, page, cumulative)) {
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

function shuffle(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function quizKey(text) {
  return text.toLowerCase().normalize('NFD').replace(/\u0301/g, '').normalize('NFC')
    .replace(/\p{P}/gu, ' ').trim().replace(/\s+/g, ' ');
}

function quizCards(rows) {
  return rows.filter(([, english]) => english).map(([spanish, english, , examples = []]) => ({
    id: speechKey(spanish),
    meanings: alternatives(english.split(/[;(]/, 1)[0].trim()),
    answers: [...alternatives(spanish), ...examples]
  }));
}

function keyboardHelp() {
  const help = node('details', '', 'quiz-help');
  help.append(
    node('summary', 'Add a Spanish keyboard'),
    node('p', 'Use your keyboard microphone to speak your answer. Your phone can stay set to English.'),
    node('p', 'iPhone: Open Settings → General → Keyboard → Keyboards → Add New Keyboard and choose Spanish. If offered, you can add Spanish to your English keyboard. With separate keyboards, switch with the globe key before tapping the microphone. If the microphone is missing, turn on Enable Dictation in Keyboard settings.'),
    node('p', 'Using a combined English/Spanish keyboard on iPhone? The built-in keyboard and Microsoft SwiftKey can show an EN or ES label near the answer field after you tap the microphone. If you see it, tap the label and choose ES for Spanish or EN for English.'),
    node('p', 'Android with Gboard: Open Gboard Settings → Languages → Add keyboard and choose Spanish. In the quiz, hold the space bar to switch languages, then tap the microphone.')
  );
  return help;
}

function openQuiz() {
  const view = byId('quiz-view');
  const notebook = byId('notebook-view');
  const panel = byId('quiz-panel');
  const scroll = window.scrollY;
  let masteryChanged = false;
  const travel = book.travelers?.vocabulary ?? [];
  const chapters = book.chapters.filter(chapter => chapter.number <= book.latestReleasedChapter);
  const cards = quizCards([...travel, ...chapters.flatMap(chapter => chapter.vocabulary)]);
  const pool = [...new Map(cards.filter(card => progress[card.id] === 'Mastered')
    .reverse().map(card => [card.id, card])).values()];
  const travelCards = quizCards(travel);
  const remaining = shuffle(pool);
  let round = [];
  let missed = [];
  let index = 0;
  let multipleChoice;
  let direction;
  let roundSize;

  function show(title, ...content) {
    const heading = node('h1', title);
    heading.id = 'quiz-title';
    heading.tabIndex = -1;
    status();
    panel.replaceChildren(heading, ...content);
    heading.focus();
  }

  function startRound(cards) {
    round = cards;
    missed = [];
    index = 0;
    question();
  }

  function nextRound() {
    startRound(remaining.splice(0, roundSize));
  }

  function results() {
    const content = [node('p', (round.length - missed.length) + ' of ' + round.length + ' correct.')];
    if (missed.length) {
      const list = node('ul', '', 'quiz-missed');
      for (const card of missed) {
        const item = node('li');
        const label = node('span', card.answers[0]);
        label.lang = 'es-MX';
        const review = button('Move to Learning', () => {
          progress[card.id] = 'Learning';
          saveStore(progressKey, progress);
          masteryChanged = true;
          review.textContent = 'Moved to Learning';
          review.disabled = true;
        });
        if (progress[card.id] !== 'Mastered') review.disabled = true;
        item.append(label, review);
        list.append(item);
      }
      content.push(list, button('Retry Missed Items', () => startRound(shuffle(missed))));
    }
    if (remaining.length) content.push(button('Next Round', nextRound));
    content.push(button('Back to Notebook', close));
    show('Quiz results', ...content);
  }

  function question() {
    stopAudio();
    const card = round[index];
    const intoEnglish = direction === 'english' || (direction === 'mixed' && index % 2 === 0);
    const answerLanguage = intoEnglish ? 'English' : 'Spanish';
    const languageTag = intoEnglish ? 'en' : 'es-MX';
    const answers = intoEnglish ? card.meanings : card.answers;
    const matchKey = intoEnglish
      ? text => quizKey(text.replace(/\bI['’]m\b/gi, 'I am').replace(/n['’]t\b/gi, ' not')
        .replace(/\byou['’]re\b/gi, 'you are'))
      : quizKey;
    const accepted = answers.map(matchKey);
    const reveal = correct => {
      if (!correct) missed.push(card);
      const answer = node('p', answers.join(' / '));
      answer.lang = languageTag;
      const audio = node('div', '', 'controls');
      for (const phrase of card.answers) audio.append(playbackControls(phrase, card.answers.length > 1));
      const last = index === round.length - 1;
      const feedback = [answer, audio];
      if (!correct && intoEnglish && !multipleChoice) {
        feedback.push(button('My answer means the same thing', () => {
          missed.pop();
          reveal(true);
        }));
      }
      show(correct ? 'Correct' : 'Incorrect, review this phrase', ...feedback,
        button(last ? 'See Results' : 'Next Question', () => {
          if (last) results();
          else {
            index++;
            question();
          }
        }));
    };
    const counter = node('p', 'Question ' + (index + 1) + ' of ' + round.length, 'muted');
    const prompt = node('p', '', 'quiz-prompt');
    prompt.textContent = intoEnglish ? card.answers[0] : card.meanings.join(' / ');
    prompt.lang = intoEnglish ? 'es-MX' : 'en';
    if (multipleChoice) {
      const distractors = new Map();
      for (const other of shuffle(travelCards)) {
        if (other.meanings.some(meaning => card.meanings.some(own => matchKey(meaning) === matchKey(own))) ||
            other.answers.some(phrase => card.answers.some(own => quizKey(phrase) === quizKey(own)))) continue;
        const option = intoEnglish ? other.meanings[0] : other.answers[0];
        distractors.set(matchKey(option), option);
      }
      const options = node('div', '', 'quiz-choices');
      for (const phrase of shuffle([answers[0], ...[...distractors.values()].slice(0, 3)])) {
        const option = button(phrase, () => reveal(accepted.includes(matchKey(phrase))));
        option.lang = languageTag;
        options.append(option);
      }
      show('Choose the ' + answerLanguage + ' translation', counter, prompt, options);
      return;
    }
    const form = node('form', '', 'quiz-form');
    const label = node('label', 'Your answer in ' + answerLanguage);
    const input = node('input');
    input.id = 'quiz-answer';
    input.lang = languageTag;
    input.required = true;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    label.htmlFor = input.id;
    const submit = node('button', 'Check Answer');
    submit.type = 'submit';
    const confirmation = node('div', '', 'quiz-confirmation');
    form.append(label, input, submit, confirmation);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const answer = matchKey(input.value);
      const corrected = answer.replace(/\bs\b/g, 'es');
      if (!intoEnglish && answer !== corrected && accepted.includes(corrected) && !accepted.includes(answer)) {
        const phrase = card.answers[accepted.indexOf(corrected)];
        const yes = button('Yes, that’s what I said', () => reveal(true));
        confirmation.replaceChildren(node('p', 'Did you mean “' + phrase + '”?'), yes,
          button('Edit Answer', () => {
            confirmation.replaceChildren();
            input.focus();
          }), button('Use My Answer', () => reveal(false)));
        yes.focus();
      } else {
        reveal(accepted.includes(answer));
      }
    });
    input.addEventListener('input', () => confirmation.replaceChildren());
    const help = intoEnglish ? node('p', 'You can also use your English keyboard microphone.') : keyboardHelp();
    show('Say or type the ' + answerLanguage + ' translation', counter, prompt, form, help);
  }

  function close() {
    stopAudio();
    status();
    view.hidden = true;
    notebook.hidden = false;
    if (masteryChanged) render();
    byId('quiz-me').focus({preventScroll: true});
    window.scrollTo(0, scroll);
  }

  stopAudio();
  status();
  notebook.hidden = true;
  view.hidden = false;
  byId('quiz-back').onclick = close;
  const intro = node('p', 'Practice the phrases you’ve marked as Mastered across all chapters and Travel Spanish.');
  if (!pool.length) {
    show('Quiz Me', intro, node('p', 'Mark a phrase as Mastered in the notebook to start a quiz.'));
    return;
  }
  const directions = node('label', 'Translation direction', 'quiz-setting');
  const selection = node('select');
  for (const [value, label] of [['spanish', 'English to Spanish'], ['english', 'Spanish to English'], ['mixed', 'Mixed']]) {
    selection.add(new Option(label, value));
  }
  directions.append(selection);
  const length = node('label', 'Questions per round', 'quiz-setting');
  const sizes = node('select');
  const maximum = Math.min(pool.length, 50);
  for (let size = 10; size < maximum; size += 10) {
    sizes.add(new Option(size + ' questions', size));
  }
  sizes.add(new Option(maximum + (maximum === 1 ? ' question' : ' questions'), maximum));
  length.append(sizes);
  const modes = node('div', '', 'quiz-choices');
  for (const [mode, choice] of [['Multiple Choice', true], ['Type or Speak', false]]) {
    modes.append(button(mode, () => {
      multipleChoice = choice;
      direction = selection.value;
      roundSize = Number(sizes.value);
      nextRound();
    }));
  }
  show('Quiz Me', intro, node('p', pool.length + (pool.length === 1 ? ' mastered phrase' : ' mastered phrases')), directions, length, modes);
}

function setupCoverViewer() {
  const viewer = byId('cover-viewer');
  const cover = byId('viewer-cover');
  const flip = byId('flip-cover');
  const link = byId('book-repository').href;
  const feedback = byId('cover-share-status');
  const manual = byId('manual-book-link');
  let side = 'front';
  let gesture;

  function showSide(next) {
    side = next;
    cover.src = 'assets/the-blue-staircase-' + side + '-cover.jpg';
    cover.alt = 'The Blue Staircase ' + side + ' cover';
    byId('cover-side').textContent = side === 'front' ? 'Front cover' : 'Back cover';
    flip.textContent = side === 'front' ? 'Show Back Cover' : 'Show Front Cover';
  }
  const flipSide = () => showSide(side === 'front' ? 'back' : 'front');

  byId('open-cover').addEventListener('click', () => {
    showSide('front');
    feedback.textContent = '';
    manual.hidden = true;
    viewer.showModal();
  });
  byId('close-cover').addEventListener('click', () => viewer.close());
  flip.addEventListener('click', flipSide);
  viewer.addEventListener('keydown', event => {
    if (event.target === manual || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    flipSide();
  });
  const imageArea = cover.parentElement;
  imageArea.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.button === 0) {
      gesture = {id: event.pointerId, x: event.clientX, y: event.clientY};
      imageArea.setPointerCapture(event.pointerId);
    }
  });
  imageArea.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = Math.abs(event.clientX - gesture.x);
    const dy = Math.abs(event.clientY - gesture.y);
    gesture = undefined;
    if (dx >= 45 && dx > dy * 1.3) flipSide();
  });
  imageArea.addEventListener('lostpointercapture', () => { gesture = undefined; });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      manual.hidden = true;
      feedback.textContent = 'Link copied.';
    } catch {
      manual.value = link;
      manual.hidden = false;
      feedback.textContent = 'Select and copy the link below.';
      manual.focus();
      manual.select();
    }
  }
  byId('copy-book-link').addEventListener('click', copyLink);
  if (navigator.share) {
    const share = byId('share-book-link');
    share.hidden = false;
    share.addEventListener('click', async () => {
      try {
        await navigator.share({title: 'The Blue Staircase', url: link});
      } catch (error) {
        if (error.name !== 'AbortError') await copyLink();
      }
    });
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

setupCoverViewer();
start().catch(() => status('The notebook could not open. Reload the page to try again.'));
