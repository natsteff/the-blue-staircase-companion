'use strict';

const root = document.documentElement;
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
const viewport = document.querySelector('#page-viewport');
const navigation = document.querySelector('#page-navigation');
const pageNumber = document.querySelector('#page-number');
const previous = document.querySelector('#previous-page');
const next = document.querySelector('#next-page');
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
let page = 0;
let pageCount = 1;
let pageStride = 1;
let touchStart;

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

function pageOf(rect) {
  const offset = rect.left - viewport.getBoundingClientRect().left + viewport.scrollLeft;
  return Math.max(0, Math.floor((offset + 1) / pageStride));
}

function currentAnchor() {
  for (const passage of passages) {
    const fragments = [...passage.getClientRects()];
    const fragment = fragments.findIndex(rect => rect.width && rect.height && pageOf(rect) === page);
    if (fragment !== -1) return {passage: passage.id, fragment};
  }
  return {page};
}

function savePosition() {
  if (!chapter) return;
  settings.position = {chapter: chapter.number, ...currentAnchor()};
  persist();
}

function showPage(number) {
  page = Math.max(0, Math.min(number, pageCount - 1));
  viewport.scrollLeft = page * pageStride;
  pageNumber.value = `Page ${page + 1} of ${pageCount}`;
  previous.disabled = page === 0 && chapter === chapters[0];
  next.disabled = page === pageCount - 1 && chapter === chapters.at(-1);
  previous.setAttribute('aria-label', page === 0 && !previous.disabled ? 'Previous chapter' : 'Previous page');
  next.setAttribute('aria-label', page === pageCount - 1 && !next.disabled ? 'Next chapter' : 'Next page');
  savePosition();
}

function paginate(anchor = {}) {
  const width = viewport.getBoundingClientRect().width;
  root.style.setProperty('--page-width', `${width}px`);
  pageStride = width + parseFloat(getComputedStyle(article).columnGap);
  const end = document.createRange();
  end.selectNodeContents(passages.at(-1));
  const lastFragments = [...end.getClientRects()].filter(rect => rect.width && rect.height);
  pageCount = 1 + Math.max(0, ...lastFragments.map(pageOf));
  const passage = anchor.passage && document.getElementById(anchor.passage);
  const rects = passage && article.contains(passage) ? [...passage.getClientRects()] : [];
  const rect = rects[Math.min(anchor.fragment || 0, rects.length - 1)];
  showPage(rect ? pageOf(rect) : anchor.page === 'last' ? pageCount - 1 : anchor.page || 0);
}

function showChapter(number, anchor) {
  const selected = chapters.find(item => item.number === number);
  if (!selected) return;
  stopAudio();
  chapter = selected;
  chapterPicker.value = String(number);
  // The build emits allowlisted HTML from the published EPUB.
  article.innerHTML = chapter.html;
  passages = [...article.querySelectorAll('[data-passage]')];
  viewport.scrollLeft = 0;
  paginate(anchor);
}

function turnPage(direction) {
  if (!chapter) return;
  const target = page + direction;
  if (target >= 0 && target < pageCount) {
    stopAudio();
    showPage(target);
  } else {
    showChapter(chapter.number + direction, direction < 0 ? {page: 'last'} : undefined);
  }
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
      showChapter(bookmark.chapter, bookmark);
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
  const anchor = currentAnchor();
  settings.size = textSize.value;
  root.style.setProperty('--reading-size', `${Number(textSize.value) / 16}rem`);
  if (chapter) paginate(anchor);
  else persist();
});

new ResizeObserver(() => {
  if (chapter) paginate(settings.position);
}).observe(viewport);

article.addEventListener('focusin', event => {
  if (event.target.matches('button.spoken')) {
    const targetPage = pageOf(event.target.getBoundingClientRect());
    if (targetPage !== page) showPage(targetPage);
  }
});

viewport.addEventListener('touchstart', event => {
  const touch = event.touches[0];
  touchStart = event.touches.length === 1 ? {x: touch.clientX, y: touch.clientY} : undefined;
}, {passive: true});
viewport.addEventListener('touchend', event => {
  if (!touchStart || event.touches.length) return;
  const touch = event.changedTouches[0];
  const x = touch.clientX - touchStart.x;
  const y = touch.clientY - touchStart.y;
  touchStart = undefined;
  if (Math.abs(x) > 42 && Math.abs(x) > Math.abs(y) * 1.5) turnPage(x < 0 ? 1 : -1);
}, {passive: true});
viewport.addEventListener('touchcancel', () => { touchStart = undefined; });

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || appearance.open || bookmarkMenu.open ||
      event.target.matches?.('input, select, textarea, [contenteditable]')) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  turnPage(event.key === 'ArrowLeft' ? -1 : 1);
});

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
previous.addEventListener('click', () => turnPage(-1));
next.addEventListener('click', () => turnPage(1));

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
  if (!chapter) return;
  const anchor = currentAnchor();
  const passage = anchor.passage && document.getElementById(anchor.passage);
  if (bookmarks.some(item => item.chapter === chapter.number &&
      item.passage === anchor.passage && (item.fragment || 0) === (anchor.fragment || 0) && item.page === anchor.page)) {
    announce('This passage is already bookmarked.');
    return;
  }
  const text = passage ? passage.textContent.trim().replace(/\s+/g, ' ') : `Page ${page + 1}`;
  bookmarks.unshift({chapter: chapter.number, ...anchor,
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
    navigation.hidden = false;
    showChapter((saved || chapters[0]).number, saved ? position : undefined);
    chapterPicker.disabled = false;
    addBookmark.disabled = false;
    renderBookmarks();
    if ('serviceWorker' in navigator) {
      const previousController = navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (previousController && navigator.serviceWorker.controller !== previousController) {
          savePosition();
          location.reload();
        }
      });
      navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(registration => {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) registration.update().catch(() => {});
        });
        window.addEventListener('online', () => registration.update().catch(() => {}));
      }).catch(() => {});
    }
  } catch {
    status.hidden = false;
    status.textContent = 'The Reader could not open the book. Reload to try again, or download the EPUB below.';
  }
}

openBook();
