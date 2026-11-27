'use strict';

const root = document.documentElement;
const sectionPicker = document.querySelector('#sections');
const article = document.querySelector('#book-text');
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
let sections = [];
let passages = [];
let section;
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
  if (!section) return;
  settings.position = {chapter: section.id, ...currentAnchor()};
  persist();
}

function showPage(number) {
  page = Math.max(0, Math.min(number, pageCount - 1));
  viewport.scrollLeft = page * pageStride;
  pageNumber.value = `Page ${page + 1} of ${pageCount}`;
  previous.disabled = page === 0 && section === sections[0];
  next.disabled = page === pageCount - 1 && section === sections.at(-1);
  previous.setAttribute('aria-label', page === 0 && !previous.disabled ? 'Previous section' : 'Previous page');
  next.setAttribute('aria-label', page === pageCount - 1 && !next.disabled ? 'Next section' : 'Next page');
  savePosition();
}

function paginate(anchor = {}) {
  const width = viewport.getBoundingClientRect().width;
  root.style.setProperty('--page-width', `${width}px`);
  pageStride = width + parseFloat(getComputedStyle(article).columnGap);
  root.style.setProperty('--page-height', `${viewport.clientHeight}px`);
  const last = passages.at(-1);
  const end = document.createRange();
  if (last) end.selectNode(last);
  const lastFragments = last
    ? [...end.getClientRects()].filter(rect => rect.width && rect.height)
    : [];
  pageCount = 1 + Math.max(0, ...lastFragments.map(pageOf));
  const passage = anchor.passage && document.getElementById(anchor.passage);
  const rects = passage && article.contains(passage) ? [...passage.getClientRects()] : [];
  const rect = rects[Math.min(anchor.fragment || 0, rects.length - 1)];
  showPage(rect ? pageOf(rect) : anchor.page === 'last' ? pageCount - 1 : anchor.page || 0);
}

function findSection(id) {
  return sections.find(item => String(item.id) === String(id));
}

function showSection(id, anchor) {
  const selected = findSection(id);
  if (!selected) return;
  stopAudio();
  section = selected;
  sectionPicker.value = String(id);
  article.dataset.kind = section.kind;
  article.setAttribute('aria-label', section.title);
  // The build emits allowlisted HTML from the published EPUB.
  article.innerHTML = section.html;
  passages = [...article.querySelectorAll('[data-passage]')];
  viewport.scrollLeft = 0;
  if (location.hash && location.hash !== `#${section.id}`) {
    history.replaceState(null, '', `#${section.id}`);
  }
  paginate(anchor);
}

function turnPage(direction) {
  if (!section) return;
  const target = page + direction;
  if (target >= 0 && target < pageCount) {
    stopAudio();
    showPage(target);
  } else {
    const adjacent = sections[sections.indexOf(section) + direction];
    if (adjacent) showSection(adjacent.id, direction < 0 ? {page: 'last'} : undefined);
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
    const title = findSection(bookmark.chapter)?.title || 'Bookmark';
    jump.textContent = `${title} · ${bookmark.label}`;
    jump.addEventListener('click', () => {
      bookmarkMenu.open = false;
      showSection(bookmark.chapter, bookmark);
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
  if (section) paginate(anchor);
  else persist();
});

new ResizeObserver(() => {
  if (section) paginate(settings.position);
}).observe(viewport);

article.addEventListener('focusin', event => {
  if (event.target.matches('button.spoken, a')) {
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

window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));
sectionPicker.addEventListener('change', () => showSection(sectionPicker.value));
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
  if (!section) return;
  const anchor = currentAnchor();
  const passage = anchor.passage && document.getElementById(anchor.passage);
  if (bookmarks.some(item => item.chapter === section.id &&
      item.passage === anchor.passage && (item.fragment || 0) === (anchor.fragment || 0) && item.page === anchor.page)) {
    announce('This passage is already bookmarked.');
    return;
  }
  const text = passage?.textContent.trim().replace(/\s+/g, ' ') || `Page ${page + 1}`;
  bookmarks.unshift({chapter: section.id, ...anchor,
    label: text.length > 72 ? `${text.slice(0, 72)}…` : text});
  persist();
  renderBookmarks();
  announce('Bookmark saved.');
});

audio.addEventListener('ended', stopAudio);
article.addEventListener('click', async event => {
  const sectionLink = event.target.closest('a[data-section]');
  if (sectionLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    showSection(sectionLink.dataset.section);
    sectionPicker.focus({preventScroll: true});
    return;
  }
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
    const response = await fetch('data/reader-book.json');
    if (!response.ok) throw new Error('Could not load book data');
    sections = await response.json();
    for (const item of sections) {
      sectionPicker.add(new Option(item.title, item.id));
    }
    const position = settings.position;
    const saved = findSection(position?.chapter);
    const linked = findSection(location.hash.slice(1));
    status.hidden = true;
    navigation.hidden = false;
    const initial = linked || saved || sections[0];
    showSection(initial.id, initial === saved ? position : undefined);
    sectionPicker.disabled = false;
    addBookmark.disabled = false;
    renderBookmarks();
    if ('serviceWorker' in navigator) {
      let previousController = navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const controller = navigator.serviceWorker.controller;
        const replaced = previousController && controller !== previousController;
        previousController = controller;
        if (replaced) {
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
