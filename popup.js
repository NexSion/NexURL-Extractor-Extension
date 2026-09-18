// NexURL-Extractor — popup script
// Author: Arabi Islam (MR. ARX) — NexApp

let currentFilter = 'all';
let allItems = []; // { url, category }
let sourcePageUrl = '';

function extOf(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function load() {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.runtime.sendMessage({ type: 'GET_MEDIA', tabId: tab.id }, (data) => {
    allItems = [];
    sourcePageUrl = (data && data.pageUrl) || tab.url || '';
    if (data) {
      ['video', 'audio', 'image'].forEach((cat) => {
        if (data[cat]) {
          Object.values(data[cat]).forEach((item) => allItems.push({ url: item.url, category: cat }));
        }
      });
    }
    allItems.sort((a, b) => a.url.localeCompare(b.url));
    render();
  });
}

function currentFiltered() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  let filtered = allItems.filter((i) => currentFilter === 'all' || i.category === currentFilter);
  if (search) {
    filtered = filtered.filter(
      (i) => i.url.toLowerCase().includes(search) || extOf(i.url).includes(search)
    );
  }
  return filtered;
}

function render() {
  const counts = { all: allItems.length, video: 0, audio: 0, image: 0 };
  allItems.forEach((i) => counts[i.category]++);
  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-video').textContent = counts.video;
  document.getElementById('count-audio').textContent = counts.audio;
  document.getElementById('count-image').textContent = counts.image;

  const filtered = currentFiltered();
  const list = document.getElementById('mediaList');
  list.innerHTML = '';
  document.getElementById('emptyState').style.display = filtered.length ? 'none' : 'block';

  const STAGGER_MS = 20;
  const STAGGER_CAP_MS = 300;

  filtered.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'mediaItem';
    li.style.animationDelay = `${Math.min(index * STAGGER_MS, STAGGER_CAP_MS)}ms`;
    const ext = extOf(item.url).toUpperCase();

    const badge = document.createElement('span');
    badge.className = `badge badge-${item.category}`;
    badge.textContent = ext || item.category;

    if (item.category === 'image') {
      const thumb = document.createElement('img');
      thumb.className = 'thumb loading';
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer';
      thumb.addEventListener('load', () => thumb.classList.remove('loading'));
      thumb.addEventListener('error', () => {
        // Hotlink-protected or otherwise unloadable — fall back to just
        // the badge/text rather than showing a broken image icon.
        thumb.remove();
      });
      if (sourcePageUrl) {
        chrome.runtime.sendMessage(
          { type: 'PREPARE_THUMB', url: item.url, referer: sourcePageUrl },
          () => {
            void chrome.runtime.lastError;
            thumb.src = item.url;
          }
        );
      } else {
        thumb.src = item.url;
      }
      li.appendChild(thumb);
    }

    const urlSpan = document.createElement('span');
    urlSpan.className = 'url';
    urlSpan.title = item.url;
    urlSpan.textContent = item.url;

    const openBtn = document.createElement('button');
    openBtn.className = 'openBtn';
    openBtn.textContent = 'Open';
    openBtn.title = sourcePageUrl
      ? 'Open in a new tab (spoofs the page Referer so CDN links that 403 direct opens still load)'
      : 'Open in a new tab';
    openBtn.addEventListener('click', () => {
      const original = openBtn.textContent;
      openBtn.disabled = true;
      openBtn.classList.add('loading');
      openBtn.textContent = 'Opening…';

      const finish = () => {
        openBtn.disabled = false;
        openBtn.classList.remove('loading');
        openBtn.textContent = original;
      };

      if (!sourcePageUrl) {
        // No known source page — open plainly rather than fail silently.
        chrome.tabs.create({ url: item.url });
        setTimeout(finish, 600);
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'OPEN_WITH_REFERER', url: item.url, referer: sourcePageUrl },
        (response) => {
          // Always read lastError when a callback is given, even if we
          // don't act on it, so Chrome doesn't log an "unchecked" warning.
          const err = chrome.runtime.lastError;
          if (err || !response || response.ok === false) {
            console.warn('[NexURL] OPEN_WITH_REFERER did not confirm success:', err || (response && response.error));
            // The background may still have opened the tab even if the
            // response never made it back (e.g. popup lost focus when the
            // new tab opened) — but if it truly failed, fall back here.
            if (!err) chrome.tabs.create({ url: item.url });
          }
          setTimeout(finish, 600);
        }
      );
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copyBtn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1100);
      });
    });

    li.appendChild(badge);
    li.appendChild(urlSpan);
    li.appendChild(openBtn);
    li.appendChild(copyBtn);
    list.appendChild(li);
  });
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  render();
});

document.getElementById('searchInput').addEventListener('input', render);

document.getElementById('copyAllBtn').addEventListener('click', () => {
  const filtered = currentFiltered();
  const text = filtered.map((i) => i.url).join('\n');
  const btn = document.getElementById('copyAllBtn');
  if (!text) {
    const old = btn.textContent;
    btn.textContent = 'Nothing to copy';
    setTimeout(() => (btn.textContent = old), 1100);
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = `Copied ${filtered.length}!`;
    setTimeout(() => (btn.textContent = old), 1100);
  });
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('rescanBtn').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });
  } catch (e) {
    // Some pages (chrome://, web store) block injection — ignore.
  }
  setTimeout(load, 800);
});

load();
