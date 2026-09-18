// NexURL-Extractor — background service worker
// Author: Arabi Islam (MR. ARX) — NexApp

const VIDEO_EXT = ['mp4','webm','m3u8','mpd','m4v','mkv','ts','mov','avi','ogg','mpg','wmv','flv','3gp','m2ts','mts'];
const AUDIO_EXT = ['mp3','aac','m4a','flac','wav'];
const IMAGE_EXT = ['png','jpeg','jpg','ico','gif','webp','svg','bmp','tiff','avif'];

function extOf(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]{2,5})$/);
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

async function getTabData(tabId) {
  const key = String(tabId);
  const store = await chrome.storage.session.get(key);
  return store[key] || {};
}

async function setTabData(tabId, data) {
  await chrome.storage.session.set({ [String(tabId)]: data });
}

async function addMedia(tabId, url, category, source) {
  if (tabId === undefined || tabId === null || tabId < 0) return false;
  const data = await getTabData(tabId);
  if (!data[category]) data[category] = {};
  if (!data[category][url]) {
    data[category][url] = { url, source, ts: Date.now() };
    await setTabData(tabId, data);
    return true; // newly added
  }
  return false; // already known
}

// Catch media pulled over the network (covers streaming manifests, direct
// media requests, CDN assets — anything that hits the network layer).
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const cat = categoryOf(details.url);
    if (!cat) return;
    const ext = extOf(details.url) || cat;
    isDetectionAllowed(details.tabId, ext).then(({ allowed, hostname }) => {
      if (!allowed) return;
      addMedia(details.tabId, details.url, cat, 'network').then((isNew) => {
        if (isNew) queueToastItem(details.tabId, details.url, cat, hostname);
      });
    });
  },
  { urls: ['<all_urls>'] }
);

// Reset the list whenever a tab navigates to a new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    setTabData(tabId, { pageUrl: changeInfo.url });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(String(tabId));
  const entry = pendingToasts.get(tabId);
  if (entry) {
    clearTimeout(entry.timer);
    pendingToasts.delete(tabId);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MEDIA_FOUND' && sender.tab) {
    (async () => {
      for (const item of msg.items) {
        const ext = extOf(item.url) || item.category;
        const { allowed, hostname } = await isDetectionAllowed(sender.tab.id, ext);
        if (!allowed) continue;
        const isNew = await addMedia(sender.tab.id, item.url, item.category, 'dom');
        if (isNew) queueToastItem(sender.tab.id, item.url, item.category, hostname);
      }
    })();
    return false;
  }
  if (msg.type === 'GET_MEDIA') {
    (async () => {
      const data = await getTabData(msg.tabId);
      const hostname = data.pageUrl ? (() => { try { return new URL(data.pageUrl).hostname; } catch (e) { return ''; } })() : '';
      const rules = hostname ? await getDetectRules() : {};
      const site = hostname ? rules[hostname] : null;

      // Defensive re-filter: if a rule was added/changed after items were
      // already stored for this tab, the popup should still reflect it
      // immediately rather than waiting for a rescan.
      if (site && site.disableAll) {
        sendResponse({ pageUrl: data.pageUrl });
        return;
      }
      const filtered = { pageUrl: data.pageUrl };
      ['video', 'audio', 'image'].forEach((cat) => {
        if (!data[cat]) return;
        const kept = {};
        Object.keys(data[cat]).forEach((url) => {
          const ext = (extOf(url) || cat).toLowerCase();
          const isListed = !!(site && site.formats && site.formats[ext]);
          const allowed = site && site.mode === 'allow' ? isListed : !isListed;
          if (!allowed) return;
          kept[url] = data[cat][url];
        });
        filtered[cat] = kept;
      });
      sendResponse(filtered);
    })();
    return true; // keep channel open for async sendResponse
  }
  if (msg.type === 'OPEN_WITH_REFERER') {
    openWithReferer(msg.url, msg.referer)
      .then(sendResponse)
      .catch((e) => {
        // openWithReferer is written to never reject, but if it somehow
        // does, still answer so the popup never hangs, and log so the
        // real cause shows up in the SERVICE WORKER console (not the
        // popup's) — chrome://extensions -> this extension -> "service
        // worker" link.
        console.error('[NexURL] OPEN_WITH_REFERER failed:', e);
        sendResponse({ ok: false, error: String(e) });
      });
    return true; // keep channel open for async sendResponse
  }
  return false;
});

// --- Passive-detection toast -------------------------------------------
// When new media turns up on a page (DOM scan or network sniff) without
// the user opening the popup, batch the finds for a moment (bursts of
// network requests — e.g. HLS segments — would otherwise spam a toast
// per file) and push one summarized toast to the page itself.

const TOAST_DEBOUNCE_MS = 900;
const TOAST_MAX_ITEMS_PER_GROUP = 5;

const pendingToasts = new Map(); // tabId -> { items: Map(url -> {url,category,ext}), timer }

// { [hostname]: { disableAll?: bool, formats?: { [ext]: true } } }
// This is the single source of truth for what gets detected at all on a
// site — not just whether a toast fires. A disabled format/site is
// skipped before it's ever written to tab storage, so it won't show in
// the popup list either.
let detectRulesCache = null;

async function getDetectRules() {
  if (detectRulesCache) return detectRulesCache;
  const store = await chrome.storage.sync.get('detectRules');
  detectRulesCache = store.detectRules || {};
  return detectRulesCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.detectRules) {
    detectRulesCache = changes.detectRules.newValue || {};
  }
});

async function hostnameForTab(tabId) {
  try {
    const data = await getTabData(tabId);
    if (data.pageUrl) return new URL(data.pageUrl).hostname;
  } catch (e) {
    /* fall through */
  }
  return '';
}

async function isDetectionAllowed(tabId, ext) {
  const hostname = await hostnameForTab(tabId);
  if (!hostname) return { allowed: true, hostname };
  const rules = await getDetectRules();
  const site = rules[hostname];
  if (!site) return { allowed: true, hostname };
  if (site.disableAll) return { allowed: false, hostname };
  const isListed = !!(site.formats && site.formats[ext.toLowerCase()]);
  if (site.mode === 'allow') {
    // Allowlist mode: ONLY listed formats are detected.
    return { allowed: isListed, hostname };
  }
  // Default / 'block' mode: everything is detected EXCEPT listed formats.
  return { allowed: !isListed, hostname };
}

function queueToastItem(tabId, url, category, hostname) {
  if (tabId === undefined || tabId === null || tabId < 0) return;
  let entry = pendingToasts.get(tabId);
  if (!entry) {
    entry = { items: new Map(), hostname: hostname || '', timer: null };
    pendingToasts.set(tabId, entry);
  }
  if (hostname) entry.hostname = hostname;
  if (!entry.items.has(url)) {
    entry.items.set(url, { url, category, ext: (extOf(url) || category).toUpperCase() });
  }
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushToast(tabId), TOAST_DEBOUNCE_MS);
}

function flushToast(tabId) {
  const entry = pendingToasts.get(tabId);
  if (!entry) return;
  pendingToasts.delete(tabId);
  const items = Array.from(entry.items.values());
  if (!items.length) return;

  // Items only ever reach the queue after isDetectionAllowed() already
  // said yes, so no further rule-checking is needed here — just group
  // and send.
  const groupsMap = new Map(); // ext -> { ext, category, items: [] }
  items.forEach((it) => {
    if (!groupsMap.has(it.ext)) groupsMap.set(it.ext, { ext: it.ext, category: it.category, items: [] });
    groupsMap.get(it.ext).items.push(it.url);
  });

  const groups = Array.from(groupsMap.values()).map((g) => ({
    ext: g.ext,
    category: g.category,
    total: g.items.length,
    items: g.items.slice(0, TOAST_MAX_ITEMS_PER_GROUP),
    more: Math.max(0, g.items.length - TOAST_MAX_ITEMS_PER_GROUP),
  }));

  chrome.tabs.sendMessage(
    tabId,
    { type: 'SHOW_TOAST', groups, hostname: entry.hostname },
    { frameId: 0 },
    () => {
      // Swallow "no receiving end" errors — happens on chrome:// pages,
      // the New Tab page, PDFs, etc. where content scripts can't run.
      void chrome.runtime.lastError;
    }
  );
}
// Some CDNs/media hosts 403 a direct request unless the Referer header
// matches the page the link was embedded on. Normal fetch/XHR can't set
// that header (it's a forbidden header), so we use declarativeNetRequest
// to rewrite it for exactly this one URL, open the tab, then clean up.

const DNR_RULE_MIN_ID = 1;
const DNR_RULE_MAX_ID = 5000;
let dnrRuleCounter = DNR_RULE_MIN_ID;

function nextRuleId() {
  const id = dnrRuleCounter;
  dnrRuleCounter = dnrRuleCounter >= DNR_RULE_MAX_ID ? DNR_RULE_MIN_ID : dnrRuleCounter + 1;
  return id;
}

async function openWithReferer(url, referer) {
  if (!url) return { ok: false, error: 'missing url' };

  // No referer to spoof — just open it plainly.
  if (!referer) {
    try {
      await chrome.tabs.create({ url });
      return { ok: true, spoofed: false };
    } catch (e) {
      console.error('[NexURL] plain tabs.create failed:', e);
      return { ok: false, error: String(e) };
    }
  }

  const ruleId = nextRuleId();
  let ruleInstalled = false;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [
        {
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: referer },
            ],
          },
          condition: {
            urlFilter: url,
            resourceTypes: [
              'main_frame', 'sub_frame', 'xmlhttprequest', 'media',
              'image', 'other',
            ],
          },
        },
      ],
    });
    ruleInstalled = true;
  } catch (e) {
    // Rule creation failed (e.g. Chrome rejected it as an "unsafe" rule,
    // a bad urlFilter, or a permission gap). Log it clearly, then still
    // open the link plainly below rather than doing nothing.
    console.error('[NexURL] declarativeNetRequest rule failed, opening without referer spoof:', e);
  }

  try {
    const tab = await chrome.tabs.create({ url });

    if (ruleInstalled) {
      const cleanup = () => {
        chrome.declarativeNetRequest
          .updateDynamicRules({ removeRuleIds: [ruleId] })
          .catch((e) => console.error('[NexURL] rule cleanup failed:', e));
      };
      const onUpdated = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          cleanup();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Safety net in case the tab never reaches 'complete' (closed
      // early, navigates away, etc.) so the rule doesn't pile up.
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        cleanup();
      }, 8000);
    }

    return { ok: true, spoofed: ruleInstalled };
  } catch (e) {
    console.error('[NexURL] tabs.create failed:', e);
    if (ruleInstalled) {
      chrome.declarativeNetRequest
        .updateDynamicRules({ removeRuleIds: [ruleId] })
        .catch(() => {});
    }
    return { ok: false, error: String(e) };
  }
}
