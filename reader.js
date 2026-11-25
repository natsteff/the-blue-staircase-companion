'use strict';

const root = document.documentElement;
const header = document.querySelector('#reader-header');
const chapterPicker = document.querySelector('#chapters');
const article = document.querySelector('#chapter-text');
const status = document.querySelector('#reader-status');
const feedback = document.querySelector('#reader-feedback');
const appearance = document.querySelector('#appearance');
const theme = document.querySelector('#theme');
const textSize = document.querySelector('#text-size');
const bookmarkMenu = document.querySelector('#bookmark-menu');
const addBookmark = document.querySelector('#add-bookmark');
const bookmarkList = document.querySelector('#bookmark-list');
const noBookmarks = document.querySelector('#no-bookmarks');
const previous = document.querySelector('#previous-chapter');
const next = document.querySelector('#next-chapter');
const storageKey = 'blue-staircase-reader';
const audio = new Audio();
audio.preload = 'none';

let settings = {};
try {
  settings = JSON.parse(localStorage.getItem(storageKey)) || {};
} catch {
  // The reader also runs when storage is unavailable.
}
let bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
let chapters = [];
let passages = [];
let chapter;
let playing;
let feedbackTimer;
let saveTimer;

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({...settings, bookmarks}));
  } catch {
    // Keep current-session settings available in memory.
  }
}

function announce(message) {
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 3500);
}

function stopAudio() {
  audio.pause();
  playing?.setAttribute('aria-pressed', 'false');
  playing = undefined;
}

function currentPassage() {
  const line = header.getBoundingClientRect().bottom + 12;
  return passages.find(passage => passage.getBoundingClientRect().bottom > line) || passages.at(-1);
}

function savePosition() {
  clearTimeout(saveTimer);
  if (!chapter) return;
  settings.position = {chapter: chapter.number, passage: currentPassage()?.id};
  persist();
}

function jumpTo(passageId) {
  const passage = passageId && document.getElementById(passageId);
  if (passage && article.contains(passage)) {
    passage.scrollIntoView({block: 'start'});
  } else {
    window.scrollTo(0, 0);
  }
}

function showChapter(number, passageId) {
  const selected = chapters.find(item => item.number === number);
  if (!selected) return;
  clearTimeout(saveTimer);
  stopAudio();
  chapter = selected;
  chapterPicker.value = String(number);
  // The build emits allowlisted HTML from the published EPUB.
  article.innerHTML = chapter.html;
  passages = [...article.querySelectorAll('[data-passage]')];
  previous.hidden = !chapters.some(item => item.number === number - 1);
  next.hidden = !chapters.some(item => item.number === number + 1);
  jumpTo(passageId);
  savePosition();
}

function renderBookmarks() {
  bookmarkList.replaceChildren();
  noBookmarks.hidden = bookmarks.length > 0;
  for (const bookmark of bookmarks) {
    const row = document.createElement('li');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'bookmark-jump';
    jump.textContent = `Chapter ${bookmark.chapter} · ${bookmark.label}`;
    jump.addEventListener('click', () => {
      bookmarkMenu.open = false;
      showChapter(bookmark.chapter, bookmark.passage);
      bookmarkMenu.querySelector('summary').focus({preventScroll: true});
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove bookmark for ${jump.textContent}`);
    remove.addEventListener('click', () => {
      bookmarks = bookmarks.filter(item => item !== bookmark);
      persist();
      renderBookmarks();
      addBookmark.focus();
      announce('Bookmark removed.');
    });
    row.append(jump, remove);
    bookmarkList.append(row);
  }
}

theme.value = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
textSize.value = settings.size || '20';
root.dataset.theme = theme.value;
root.style.setProperty('--reading-size', `${Number(textSize.value) / 16}rem`);

theme.addEventListener('change', () => {
  settings.theme = root.dataset.theme = theme.value;
  persist();
});

textSize.addEventListener('input', () => {
  const passage = currentPassage();
  settings.size = textSize.value;
  root.style.setProperty('--reading-size', `${Number(textSize.value) / 16}rem`);
  if (passage) jumpTo(passage.id);
  savePosition();
});

new ResizeObserver(() => {
  root.style.setProperty('--header-height', `${header.offsetHeight}px`);
}).observe(header);

window.addEventListener('scroll', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePosition, 160);
}, {passive: true});
window.addEventListener('pagehide', () => {
  savePosition();
  stopAudio();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) savePosition();
});
document.querySelector('#back-to-companion').addEventListener('click', event => {
  savePosition();
  const referrer = document.referrer;
  if (referrer === new URL('./', location.href).href ||
      referrer === new URL('index.html', location.href).href) {
    event.preventDefault();
    history.back();
  }
});

chapterPicker.addEventListener('change', () => showChapter(Number(chapterPicker.value)));
function navigateChapter(number) {
  showChapter(number);
  const heading = passages[0];
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({preventScroll: true});
}
previous.addEventListener('click', () => navigateChapter(chapter.number - 1));
next.addEventListener('click', () => navigateChapter(chapter.number + 1));

for (const menu of [appearance, bookmarkMenu]) {
  menu.addEventListener('toggle', () => {
    if (menu.open) (menu === appearance ? bookmarkMenu : appearance).open = false;
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    menu.querySelector('summary').focus();
  });
}

addBookmark.addEventListener('click', () => {
  const passage = currentPassage();
  if (!passage) return;
  if (bookmarks.some(item => item.chapter === chapter.number && item.passage === passage.id)) {
    announce('This passage is already bookmarked.');
    return;
  }
  const text = passage.textContent.trim().replace(/\s+/g, ' ');
  bookmarks.unshift({chapter: chapter.number, passage: passage.id,
    label: text.length > 72 ? `${text.slice(0, 72)}…` : text});
  persist();
  renderBookmarks();
  announce('Bookmark saved.');
});

audio.addEventListener('ended', stopAudio);
article.addEventListener('click', async event => {
  const phrase = event.target.closest('button[data-audio]');
  if (!phrase) return;
  stopAudio();
  playing = phrase;
  phrase.setAttribute('aria-pressed', 'true');
  audio.src = phrase.dataset.audio;
  try {
    await audio.play();
  } catch (error) {
    if (playing !== phrase || error.name === 'AbortError') return;
    stopAudio();
    announce('Audio could not play. Tap the phrase to try again.');
  }
});

async function openBook() {
  try {
    const response = await fetch('data/reader-chapters.json');
    if (!response.ok) throw new Error('Could not load chapter data');
    chapters = await response.json();
    for (const item of chapters) {
      chapterPicker.add(new Option(`Chapter ${item.number} · ${item.title}`, item.number));
    }
    const position = settings.position;
    const saved = chapters.find(item => item.number === position?.chapter);
    status.hidden = true;
    showChapter((saved || chapters[0]).number, saved && position.passage);
    chapterPicker.disabled = false;
    addBookmark.disabled = false;
    document.querySelector('#chapter-navigation').hidden = false;
    renderBookmarks();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).catch(() => {});
    }
  } catch {
    status.hidden = false;
    status.textContent = 'The Reader could not open the book. Reload to try again, or download the EPUB below.';
  }
}

openBook();
