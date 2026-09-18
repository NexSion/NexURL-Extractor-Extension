// NexURL-Extractor — options page
// Manages detectRules: which formats/sites are excluded from detection
// entirely (network scan, DOM scan, popup list, and the toast). Same
// storage shape a toast's own 🚫 buttons write to, so changes here and
// changes made from a toast always stay in sync.

const FORMATS = {
  video: ['mp4','webm','m3u8','mpd','m4v','mkv','ts','mov','avi','ogg','mpg','wmv','flv','3gp','m2ts','mts'],
  audio: ['mp3','aac','m4a','flac','wav'],
  image: ['png','jpeg','jpg','ico','gif','webp','svg','bmp','tiff','avif'],
};
const CATEGORY_ICON = { video: '🎬', audio: '🎵', image: '🖼️' };

function categoryOfExt(ext) {
  ext = ext.toLowerCase();
  for (const cat of Object.keys(FORMATS)) {
    if (FORMATS[cat].includes(ext)) return cat;
  }
  return null;
}

async function getMutes() {
  const store = await chrome.storage.sync.get('detectRules');
  return store.detectRules || {};
}

async function setMutes(mutes) {
  await chrome.storage.sync.set({ detectRules: mutes });
}

function normalizeDomain(raw) {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return d;
}

function buildFormatSelect() {
  const select = document.createElement('select');
  select.className = 'formatSelect';
  Object.keys(FORMATS).forEach((cat) => {
    const group = document.createElement('optgroup');
    group.label = `${CATEGORY_ICON[cat]} ${cat}`;
    FORMATS[cat].forEach((ext) => {
      const opt = document.createElement('option');
      opt.value = ext;
      opt.textContent = ext;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });
  return select;
}

async function render() {
  const mutes = await getMutes();
  const hosts = Object.keys(mutes).sort();
  const list = document.getElementById('siteList');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('siteCount');

  list.innerHTML = '';
  count.textContent = String(hosts.length);
  empty.style.display = hosts.length ? 'none' : 'block';

  hosts.forEach((host) => {
    const rule = mutes[host] || {};
    const card = document.createElement('div');
    card.className = 'siteCard';

    // --- top row: hostname, disable-all switch, remove ---
    const row = document.createElement('div');
    row.className = 'siteRow';

    const hostEl = document.createElement('div');
    hostEl.className = 'siteHost';
    hostEl.textContent = host;
    row.appendChild(hostEl);

    const switchLabel = document.createElement('span');
    switchLabel.className = 'switchLabel';
    switchLabel.textContent = 'Disable all';
    row.appendChild(switchLabel);

    const switchWrap = document.createElement('label');
    switchWrap.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!rule.disableAll;
    cb.addEventListener('change', async () => {
      const m = await getMutes();
      m[host] = Object.assign({}, m[host], { disableAll: cb.checked });
      await setMutes(m);
      render();
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    switchWrap.appendChild(cb);
    switchWrap.appendChild(slider);
    row.appendChild(switchWrap);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'removeBtn';
    removeBtn.textContent = '🗑';
    removeBtn.title = 'Remove this site rule entirely';
    removeBtn.addEventListener('click', async () => {
      const m = await getMutes();
      delete m[host];
      await setMutes(m);
      render();
    });
    row.appendChild(removeBtn);

    card.appendChild(row);

    if (rule.disableAll) {
      const note = document.createElement('div');
      note.className = 'mutedAllNote';
      note.textContent = 'Nothing is detected on this site — the rule below is ignored while this is on.';
      card.appendChild(note);
    } else {
      const mode = rule.mode === 'allow' ? 'allow' : 'block';

      // --- rule mode: block selected formats, or ONLY detect selected ---
      const modeRow = document.createElement('div');
      modeRow.className = 'modeRow';
      const blockBtn = document.createElement('button');
      blockBtn.className = 'modeBtn' + (mode === 'block' ? ' active' : '');
      blockBtn.textContent = '🚫 Mute selected formats';
      blockBtn.addEventListener('click', async () => {
        if (mode === 'block') return;
        const m = await getMutes();
        m[host] = Object.assign({}, m[host], { mode: 'block' });
        await setMutes(m);
        render();
      });
      const allowBtn = document.createElement('button');
      allowBtn.className = 'modeBtn' + (mode === 'allow' ? ' active' : '');
      allowBtn.textContent = '✅ Detect only selected';
      allowBtn.addEventListener('click', async () => {
        if (mode === 'allow') return;
        const m = await getMutes();
        m[host] = Object.assign({}, m[host], { mode: 'allow' });
        await setMutes(m);
        render();
      });
      modeRow.appendChild(blockBtn);
      modeRow.appendChild(allowBtn);
      card.appendChild(modeRow);

      const modeHint = document.createElement('div');
      modeHint.className = 'hint';
      modeHint.style.margin = '6px 0 0';
      modeHint.textContent = mode === 'allow'
        ? 'Only the formats picked below will be detected on this site — everything else is ignored.'
        : 'The formats picked below are skipped on this site — everything else is detected as normal.';
      card.appendChild(modeHint);

      // --- selected-format chips ---
      const chips = document.createElement('div');
      chips.className = 'chips';
      const selectedFormats = Object.keys(rule.formats || {});
      selectedFormats.sort().forEach((ext) => {
        const cat = categoryOfExt(ext);
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `<span>${cat ? CATEGORY_ICON[cat] : '📄'} ${ext}</span>`;
        const rm = document.createElement('button');
        rm.textContent = '✕';
        rm.title = mode === 'allow'
          ? `Stop detecting ${ext} on ${host}`
          : `Resume detecting ${ext} on ${host}`;
        rm.addEventListener('click', async () => {
          const m = await getMutes();
          if (m[host] && m[host].formats) {
            delete m[host].formats[ext];
            if (!Object.keys(m[host].formats).length) delete m[host].formats;
          }
          await setMutes(m);
          render();
        });
        chip.appendChild(rm);
        chips.appendChild(chip);
      });
      card.appendChild(chips);

      // --- add a format to the list above ---
      const addRow = document.createElement('div');
      addRow.className = 'addFormatRow';
      const select = buildFormatSelect();
      addRow.appendChild(select);
      const addBtn = document.createElement('button');
      addBtn.className = 'smallBtn';
      addBtn.textContent = mode === 'allow' ? '✅ Add to detect-only list' : '🚫 Add to mute list';
      addBtn.addEventListener('click', async () => {
        const ext = select.value;
        const m = await getMutes();
        m[host] = m[host] || {};
        m[host].formats = m[host].formats || {};
        m[host].formats[ext] = true;
        await setMutes(m);
        render();
      });
      addRow.appendChild(addBtn);
      card.appendChild(addRow);
    }

    list.appendChild(card);
  });
}

document.getElementById('addSiteBtn').addEventListener('click', async () => {
  const input = document.getElementById('domainInput');
  const host = normalizeDomain(input.value);
  if (!host) return;
  const mutes = await getMutes();
  if (!mutes[host]) mutes[host] = {};
  await setMutes(mutes);
  input.value = '';
  render();
});

document.getElementById('domainInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('addSiteBtn').click();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.detectRules) render();
});

render();
