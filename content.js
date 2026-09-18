// NexURL-Extractor — content script
// Author: Arabi Islam (MR. ARX) — NexApp

(function () {
  const VIDEO_EXT = ['mp4','webm','m3u8','mpd','m4v','mkv','ts','mov','avi','ogg','mpg','wmv','flv','3gp','m2ts','mts'];
  const AUDIO_EXT = ['mp3','aac','m4a','flac','wav'];
  const IMAGE_EXT = ['png','jpeg','jpg','ico','gif','webp','svg','bmp','tiff','avif'];

  function extOf(url) {
    try {
      const u = new URL(url, location.href);
      const m = u.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  function categoryOf(url) {
    const ext = extOf(url);
    if (!ext) return null;
    if (VIDEO_EXT.includes(ext)) return 'video';
    if (AUDIO_EXT.includes(ext)) return 'audio';
    if (IMAGE_EXT.includes(ext)) return 'image';
    return null;
  }

  function collect() {
    const found = new Map();
    const push = (raw) => {
      if (!raw) return;
      raw = raw.trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return;
      let url;
      try {
        url = new URL(raw, location.href).href;
      } catch (e) {
        return;
      }
      const cat = categoryOf(url);
      if (cat && !found.has(url)) found.set(url, cat);
    };

    document.querySelectorAll('img[src]').forEach((el) => push(el.src));
    document.querySelectorAll('img[srcset], source[srcset]').forEach((el) => {
      (el.getAttribute('srcset') || '').split(',').forEach((part) => {
        push(part.trim().split(' ')[0]);
      });
    });
    document.querySelectorAll('video[src], audio[src], source[src]').forEach((el) => push(el.src));
    document.querySelectorAll('video, audio').forEach((el) => {
      if (el.currentSrc) push(el.currentSrc);
    });
    document.querySelectorAll('link[rel~="icon"]').forEach((el) => push(el.href));
    document.querySelectorAll('a[href]').forEach((el) => push(el.href));

    document.querySelectorAll('*').forEach((el) => {
      let bg;
      try {
        bg = getComputedStyle(el).backgroundImage;
      } catch (e) {
        return;
      }
      if (bg && bg !== 'none') {
        const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g);
        if (matches) {
          matches.forEach((m) => {
            const url = m.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
            push(url);
          });
        }
      }
    });

    return Array.from(found.entries()).map(([url, category]) => ({ url, category }));
  }

  function report() {
    const items = collect();
    if (items.length) {
      chrome.runtime.sendMessage({ type: 'MEDIA_FOUND', items });
    }
  }

  report();
  window.addEventListener('load', report);

  const observer = new MutationObserver(() => report());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'srcset', 'style'],
  });

  // Catches lazy-loaded / late media that slips past mutation events.
  setInterval(report, 3000);

  // --- Passive-detection toast ------------------------------------------
  // Only the top frame renders a toast (background also targets frameId 0,
  // this is just defense-in-depth for pages with unusual frame setups).
  if (window.top !== window) return;

  const CATEGORY_ICON = { video: '🎬', audio: '🎵', image: '🖼️' };
  const ACCENT = '#5B5FEF';
  const MAX_VISIBLE_TOASTS = 3;
  const AUTO_DISMISS_MS = 12000;

  let shadowHost = null;
  let shadowRoot = null;
  let toastStack = null;

  function ensureToastRoot() {
    if (shadowRoot) return shadowRoot;
    shadowHost = document.createElement('div');
    shadowHost.id = 'nexurl-toast-host';
    shadowHost.style.all = 'initial';
    (document.body || document.documentElement).appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .stack {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column-reverse;
        gap: 10px;
        font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        width: 320px;
        max-width: 88vw;
        background: rgba(255,255,255,0.72);
        backdrop-filter: blur(20px) saturate(160%);
        -webkit-backdrop-filter: blur(20px) saturate(160%);
        border: 1px solid rgba(255,255,255,0.35);
        border-radius: 16px;
        box-shadow: 0 10px 34px rgba(20,20,40,0.22);
        color: #1b1e2b;
        font-size: 12.5px;
        overflow: hidden;
        animation: nexurlIn 220ms ease both;
      }
      @media (prefers-color-scheme: dark) {
        .toast {
          background: rgba(28,28,36,0.82);
          border-color: rgba(255,255,255,0.1);
          color: #eef0fb;
        }
      }
      @keyframes nexurlIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes nexurlOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } }
      .toast.closing { animation: nexurlOut 180ms ease both; }
      .head {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 10px 6px 12px;
      }
      .head .title { flex: 1; font-weight: 700; font-size: 12.5px; }
      .headBtn {
        background: transparent; border: none; cursor: pointer;
        color: inherit; opacity: 0.6; font-size: 13px; line-height: 1;
        padding: 4px; border-radius: 6px;
      }
      .headBtn:hover { opacity: 1; background: rgba(127,127,127,0.15); }
      .group { padding: 2px 12px 8px; }
      .groupHead {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; opacity: 0.85; margin-bottom: 4px;
      }
      .groupHead .muteFmt {
        margin-left: auto; background: transparent; border: none; cursor: pointer;
        font-size: 10.5px; opacity: 0.55; color: inherit; text-decoration: underline;
      }
      .groupHead .muteFmt:hover { opacity: 0.9; }
      .row {
        display: flex; align-items: center; gap: 6px;
        padding: 4px 0;
        border-top: 1px solid rgba(127,127,127,0.15);
      }
      .row:first-of-type { border-top: none; }
      .row .u {
        flex: 1; min-width: 0; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; font-size: 11px; opacity: 0.85;
      }
      .row button {
        flex-shrink: 0; border-radius: 7px; padding: 3px 8px; font-size: 10px;
        font-weight: 600; cursor: pointer; border: 1px solid transparent;
        transition: filter 150ms ease, transform 100ms ease;
      }
      .row button:active { transform: scale(0.93); }
      .row .openB { background: ${ACCENT}; color: #fff; }
      .row .openB:hover { filter: brightness(1.1); }
      .row .copyB { background: transparent; border-color: rgba(127,127,127,0.4); color: inherit; }
      .more { font-size: 10.5px; opacity: 0.6; padding-top: 2px; }
      .foot {
        display: flex; justify-content: flex-end; padding: 6px 12px 10px;
        border-top: 1px solid rgba(127,127,127,0.15);
      }
      .foot button {
        background: transparent; border: none; cursor: pointer; color: inherit;
        opacity: 0.6; font-size: 10.5px; text-decoration: underline;
      }
      .foot button:hover { opacity: 1; }
    `;
    shadowRoot.appendChild(style);

    toastStack = document.createElement('div');
    toastStack.className = 'stack';
    shadowRoot.appendChild(toastStack);
    return shadowRoot;
  }

  function truncateUrl(url, max) {
    if (url.length <= max) return url;
    return url.slice(0, max - 1) + '…';
  }

  async function disableFormat(hostname, ext) {
    if (!hostname) return;
    ext = ext.toLowerCase();
    const store = await chrome.storage.sync.get('detectRules');
    const rules = store.detectRules || {};
    const site = rules[hostname] || {};
    site.formats = site.formats || {};
    if (site.mode === 'allow') {
      // Allowlist mode: "stop detecting X" means take X off the allow-list.
      delete site.formats[ext];
    } else {
      // Block mode (default): "stop detecting X" means add X to the block-list.
      site.formats[ext] = true;
    }
    rules[hostname] = site;
    await chrome.storage.sync.set({ detectRules: rules });
  }

  async function disableSite(hostname) {
    if (!hostname) return;
    const store = await chrome.storage.sync.get('detectRules');
    const rules = store.detectRules || {};
    rules[hostname] = Object.assign({}, rules[hostname], { disableAll: true });
    await chrome.storage.sync.set({ detectRules: rules });
  }

  function removeToast(el) {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 190);
  }

  function showToast(groups, hostname) {
    ensureToastRoot();

    // Cap how many toasts stack up at once — drop the oldest.
    while (toastStack.children.length >= MAX_VISIBLE_TOASTS) {
      removeToast(toastStack.firstElementChild);
    }

    const totalLinks = groups.reduce((sum, g) => sum + g.total, 0);
    const totalFormats = groups.length;

    const toast = document.createElement('div');
    toast.className = 'toast';

    const head = document.createElement('div');
    head.className = 'head';
    const icon = CATEGORY_ICON[groups[0] && groups[0].category] || '📄';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = totalFormats === 1
      ? `${icon} ${totalLinks} new ${groups[0].ext} link${totalLinks > 1 ? 's' : ''} found`
      : `📎 ${totalLinks} new media link${totalLinks > 1 ? 's' : ''} found`;
    head.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'headBtn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Dismiss';
    closeBtn.addEventListener('click', () => removeToast(toast));
    head.appendChild(closeBtn);
    toast.appendChild(head);

    groups.forEach((g) => {
      const group = document.createElement('div');
      group.className = 'group';

      const gHead = document.createElement('div');
      gHead.className = 'groupHead';
      gHead.innerHTML = `<span>${CATEGORY_ICON[g.category] || '📄'} ${g.ext} · ${g.total}</span>`;
      const muteFmtBtn = document.createElement('button');
      muteFmtBtn.className = 'muteFmt';
      muteFmtBtn.textContent = `🚫 stop detecting ${g.ext}`;
      muteFmtBtn.title = `Stop detecting ${g.ext} links on this site entirely`;
      muteFmtBtn.addEventListener('click', () => {
        disableFormat(hostname, g.ext);
        removeToast(toast);
      });
      gHead.appendChild(muteFmtBtn);
      group.appendChild(gHead);

      g.items.forEach((url) => {
        const row = document.createElement('div');
        row.className = 'row';
        const u = document.createElement('span');
        u.className = 'u';
        u.textContent = truncateUrl(url, 34);
        u.title = url;
        row.appendChild(u);

        const openB = document.createElement('button');
        openB.className = 'openB';
        openB.textContent = 'Open';
        openB.addEventListener('click', () => {
          chrome.runtime.sendMessage(
            { type: 'OPEN_WITH_REFERER', url, referer: location.href },
            () => void chrome.runtime.lastError
          );
        });
        row.appendChild(openB);

        const copyB = document.createElement('button');
        copyB.className = 'copyB';
        copyB.textContent = 'Copy';
        copyB.addEventListener('click', () => {
          navigator.clipboard.writeText(url).then(() => {
            copyB.textContent = 'Copied!';
            setTimeout(() => (copyB.textContent = 'Copy'), 1000);
          });
        });
        row.appendChild(copyB);

        group.appendChild(row);
      });

      if (g.more > 0) {
        const more = document.createElement('div');
        more.className = 'more';
        more.textContent = `+${g.more} more — open the extension to see all`;
        group.appendChild(more);
      }

      toast.appendChild(group);
    });

    const foot = document.createElement('div');
    foot.className = 'foot';
    const muteSiteBtn = document.createElement('button');
    muteSiteBtn.textContent = '🚫 Stop detecting on this site';
    muteSiteBtn.title = 'Turns off detection (and this toast) for every format on this site';
    muteSiteBtn.addEventListener('click', () => {
      disableSite(hostname);
      removeToast(toast);
    });
    foot.appendChild(muteSiteBtn);
    toast.appendChild(foot);

    toastStack.appendChild(toast);

    let dismissTimer = setTimeout(() => removeToast(toast), AUTO_DISMISS_MS);
    toast.addEventListener('mouseenter', () => clearTimeout(dismissTimer));
    toast.addEventListener('mouseleave', () => {
      dismissTimer = setTimeout(() => removeToast(toast), AUTO_DISMISS_MS);
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_TOAST' && Array.isArray(msg.groups) && msg.groups.length) {
      showToast(msg.groups, msg.hostname || '');
    }
  });
})();
