// NexURL-Extractor — HLS player page
// Plays .m3u8 streams via hls.js (MediaSource Extensions) instead of
// letting Chrome's native HLS engine handle them directly — the native
// engine stalls video decode on some manifests (bitrate/level switches,
// separate audio/video renditions) while audio keeps playing normally.
// Custom glass-style controls replace the native <video controls> UI.

(function () {
  const params = new URLSearchParams(location.search);
  const src = params.get('src');
  const referer = params.get('referer') || '';

  const stage = document.getElementById('stage');
  const video = document.getElementById('video');
  const statusEl = document.getElementById('status');
  const spinner = document.getElementById('spinner');
  const centerPlay = document.getElementById('centerPlay');

  const controls = document.getElementById('controls');
  const seek = document.getElementById('seek');
  const seekBuffered = document.getElementById('seekBuffered');
  const seekPlayed = document.getElementById('seekPlayed');
  const seekHandle = document.getElementById('seekHandle');
  const playBtn = document.getElementById('playBtn');
  const backBtn = document.getElementById('backBtn');
  const fwdBtn = document.getElementById('fwdBtn');
  const volGroup = document.getElementById('volGroup');
  const muteBtn = document.getElementById('muteBtn');
  const volRange = document.getElementById('volRange');
  const timeDisplay = document.getElementById('timeDisplay');
  const settingsWrap = document.querySelector('.settingsWrap');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsMenu = document.getElementById('settingsMenu');
  const speedOptions = document.getElementById('speedOptions');
  const qualityOptions = document.getElementById('qualityOptions');
  const qualityLabel = document.getElementById('qualityLabel');
  const copySrcBtn = document.getElementById('copySrcBtn');
  const copyRefBtn = document.getElementById('copyRefBtn');
  const fsBtn = document.getElementById('fsBtn');

  // --- icons (simple inline line-icon SVGs) ------------------------------
  const ICONS = {
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5v13l11-6.5-11-6.5Z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    back10: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 12a8 8 0 1 1 2.4 5.7M6 12v5M6 12H1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15" font-size="7" fill="currentColor" text-anchor="middle" font-family="monospace">10</text></svg>',
    fwd10: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M18 12a8 8 0 1 0-2.4 5.7M18 12v5M18 12h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15" font-size="7" fill="currentColor" text-anchor="middle" font-family="monospace">10</text></svg>',
    volUp: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    volMute: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    settings: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="m19.4 13-.1-1-.1-1 1.6-1.3-2-3.4-2 .6-1.7-1-.3-2h-4l-.3 2-1.7 1-2-.6-2 3.4L6.3 11l-.1 1 .1 1-1.6 1.3 2 3.4 2-.6 1.7 1 .3 2h4l.3-2 1.7-1 2 .6 2-3.4L19.4 13Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.4"/></svg>',
    fsEnter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fsExit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  playBtn.innerHTML = ICONS.play;
  backBtn.innerHTML = ICONS.back10;
  fwdBtn.innerHTML = ICONS.fwd10;
  muteBtn.innerHTML = ICONS.volUp;
  settingsBtn.innerHTML = ICONS.settings;
  fsBtn.innerHTML = ICONS.fsEnter;
  centerPlay.innerHTML = ICONS.play.replace('width="18" height="18"', 'width="64" height="64"');

  function showStatus(text) {
    statusEl.textContent = text;
    statusEl.style.display = 'block';
  }
  function hideStatus() {
    statusEl.style.display = 'none';
  }

  if (!src) {
    showStatus('No stream URL was provided.');
    return;
  }
  document.title = 'Playing — NexURL-Extractor';

  // --- time formatting -----------------------------------------------
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // --- seek bar ---------------------------------------------------------
  let dragging = false;

  function ratioFromEvent(e) {
    const rect = seek.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function paintSeek(ratio) {
    const pct = (ratio * 100).toFixed(3) + '%';
    seekPlayed.style.width = pct;
    seekHandle.style.left = pct;
    seek.setAttribute('aria-valuenow', Math.round(ratio * 100));
  }

  function updateSeekFromVideo() {
    if (!video.duration || dragging) return;
    paintSeek(video.currentTime / video.duration);
    if (video.buffered.length) {
      const end = video.buffered.end(video.buffered.length - 1);
      seekBuffered.style.width = Math.min(100, (end / video.duration) * 100) + '%';
    }
  }

  function updateTimeDisplay() {
    timeDisplay.innerHTML = `${fmt(video.currentTime)} <span class="sep">/</span> ${fmt(video.duration)}`;
  }

  seek.addEventListener('mousedown', (e) => {
    dragging = true;
    seek.classList.add('dragging');
    const ratio = ratioFromEvent(e);
    paintSeek(ratio);
    if (video.duration) video.currentTime = ratio * video.duration;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const ratio = ratioFromEvent(e);
    paintSeek(ratio);
    if (video.duration) video.currentTime = ratio * video.duration;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    seek.classList.remove('dragging');
  });
  seek.addEventListener('touchstart', (e) => {
    dragging = true;
    seek.classList.add('dragging');
    const ratio = ratioFromEvent(e);
    paintSeek(ratio);
    if (video.duration) video.currentTime = ratio * video.duration;
  }, { passive: true });
  seek.addEventListener('touchmove', (e) => {
    const ratio = ratioFromEvent(e);
    paintSeek(ratio);
    if (video.duration) video.currentTime = ratio * video.duration;
  }, { passive: true });
  seek.addEventListener('touchend', () => {
    dragging = false;
    seek.classList.remove('dragging');
  });
  seek.addEventListener('keydown', (e) => {
    if (!video.duration) return;
    if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration, video.currentTime + 5);
    if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
  });

  video.addEventListener('timeupdate', () => { updateSeekFromVideo(); updateTimeDisplay(); });
  video.addEventListener('progress', updateSeekFromVideo);
  video.addEventListener('loadedmetadata', updateTimeDisplay);
  video.addEventListener('durationchange', updateTimeDisplay);

  // --- center flash + play/pause ----------------------------------------
  let flashTimer = null;
  function flashCenter(icon) {
    centerPlay.innerHTML = icon.replace('width="18" height="18"', 'width="64" height="64"');
    centerPlay.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => centerPlay.classList.remove('show'), 480);
  }

  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  video.addEventListener('play', () => { playBtn.innerHTML = ICONS.pause; showControls(); });
  video.addEventListener('pause', () => { playBtn.innerHTML = ICONS.play; showControls(true); });
  playBtn.addEventListener('click', togglePlay);
  stage.addEventListener('click', (e) => {
    if (e.target === video || e.target === stage) {
      togglePlay();
      // video.paused updates synchronously on play()/pause(), so this
      // already reflects the new state by the time we read it here.
      flashCenter(video.paused ? ICONS.pause : ICONS.play);
    }
  });

  backBtn.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
  fwdBtn.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration || video.currentTime + 10, video.currentTime + 10);
  });

  // --- volume -------------------------------------------------------------
  function updateMuteIcon() {
    muteBtn.innerHTML = (video.muted || video.volume === 0) ? ICONS.volMute : ICONS.volUp;
  }
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
    volRange.value = video.muted ? 0 : video.volume;
    updateMuteIcon();
  });
  volRange.addEventListener('input', () => {
    video.volume = parseFloat(volRange.value);
    video.muted = video.volume === 0;
    updateMuteIcon();
  });
  volGroup.addEventListener('mouseenter', () => volGroup.classList.add('active'));
  volGroup.addEventListener('mouseleave', () => volGroup.classList.remove('active'));

  // --- buffering spinner ---------------------------------------------------
  video.addEventListener('waiting', () => spinner.classList.add('show'));
  video.addEventListener('playing', () => spinner.classList.remove('show'));
  video.addEventListener('canplay', () => spinner.classList.remove('show'));

  // --- settings popover: speed + quality -----------------------------------
  let settingsOpen = false;
  function closeSettings() {
    settingsOpen = false;
    settingsMenu.classList.remove('open');
  }
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsOpen = !settingsOpen;
    settingsMenu.classList.toggle('open', settingsOpen);
    if (settingsOpen) showControls();
  });
  document.addEventListener('click', (e) => {
    if (settingsOpen && !settingsWrap.contains(e.target)) closeSettings();
  });

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  function buildSpeedOptions() {
    speedOptions.innerHTML = '';
    SPEEDS.forEach((rate) => {
      const btn = document.createElement('button');
      btn.className = 'settingsOpt' + (video.playbackRate === rate ? ' active' : '');
      btn.textContent = rate === 1 ? 'Normal' : `${rate}x`;
      btn.addEventListener('click', () => {
        video.playbackRate = rate;
        buildSpeedOptions();
      });
      speedOptions.appendChild(btn);
    });
  }
  video.addEventListener('ratechange', buildSpeedOptions);
  buildSpeedOptions();

  qualityLabel.style.display = 'none';
  qualityOptions.style.display = 'none';

  function flashCopied(btn, originalText) {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalText; }, 1200);
  }

  copySrcBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(src).then(() => flashCopied(copySrcBtn, '📋 Copy stream URL'));
  });

  if (referer) {
    copyRefBtn.style.display = '';
    copyRefBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(referer).then(() => flashCopied(copyRefBtn, '📋 Copy referer URL'));
    });
  }

  function buildQualityOptions(hls) {
    if (!hls || !hls.levels || !hls.levels.length) return;
    qualityLabel.style.display = '';
    qualityOptions.style.display = '';

    function render() {
      qualityOptions.innerHTML = '';
      const autoBtn = document.createElement('button');
      const isAuto = hls.currentLevel === -1;
      const activeLevel = hls.levels[hls.loadLevel];
      autoBtn.className = 'settingsOpt' + (isAuto ? ' active' : '');
      autoBtn.textContent = isAuto && activeLevel && activeLevel.height
        ? `Auto (${activeLevel.height}p)`
        : 'Auto';
      autoBtn.addEventListener('click', () => { hls.currentLevel = -1; render(); });
      qualityOptions.appendChild(autoBtn);

      hls.levels
        .map((lvl, i) => ({ i, height: lvl.height, bitrate: lvl.bitrate }))
        .sort((a, b) => (b.height || 0) - (a.height || 0))
        .forEach(({ i, height }) => {
          const btn = document.createElement('button');
          btn.className = 'settingsOpt' + (hls.currentLevel === i ? ' active' : '');
          btn.textContent = height ? `${height}p` : `Level ${i + 1}`;
          btn.addEventListener('click', () => { hls.currentLevel = i; render(); });
          qualityOptions.appendChild(btn);
        });
    }
    render();
    hls.on(Hls.Events.LEVEL_SWITCHED, render);
  }

  // --- fullscreen -----------------------------------------------------------
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.innerHTML = document.fullscreenElement ? ICONS.fsExit : ICONS.fsEnter;
  });

  // --- auto-hide controls ----------------------------------------------------
  let hideTimer = null;
  function showControls(force) {
    controls.classList.remove('hidden');
    stage.classList.remove('idle');
    clearTimeout(hideTimer);
    if (!force && !video.paused && !settingsOpen) {
      hideTimer = setTimeout(() => {
        if (!settingsOpen) {
          controls.classList.add('hidden');
          stage.classList.add('idle');
        }
      }, 3000);
    }
  }
  stage.addEventListener('mousemove', () => showControls());
  stage.addEventListener('mouseleave', () => {
    clearTimeout(hideTimer);
    if (!video.paused && !settingsOpen) {
      controls.classList.add('hidden');
      stage.classList.add('idle');
    }
  });
  showControls(true);

  // --- keyboard shortcuts ------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        video.currentTime = Math.min(video.duration || video.currentTime + 10, video.currentTime + 10);
        break;
      case 'ArrowLeft':
        video.currentTime = Math.max(0, video.currentTime - 10);
        break;
      case 'm':
        muteBtn.click();
        break;
      case 'f':
        fsBtn.click();
        break;
    }
    showControls();
  });

  // --- hls.js setup --------------------------------------------------------
  function startPlayback() {
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 30 });
      let networkRetries = 0;
      const MAX_NETWORK_RETRIES = 5;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data || !data.fatal) return;
        console.error('[NexURL player] fatal hls.js error:', data);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (networkRetries++ < MAX_NETWORK_RETRIES) {
              showStatus(`Network hiccup — retrying (${networkRetries}/${MAX_NETWORK_RETRIES})…`);
              setTimeout(() => hls.startLoad(), 800);
            } else {
              showStatus('Playback failed: repeated network errors. The link may be expired or blocked.');
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            showStatus('Recovering from a media error…');
            hls.recoverMediaError();
            break;
          default:
            showStatus('Unrecoverable playback error — see the console for details.');
            hls.destroy();
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        hideStatus();
        buildQualityOptions(hls);
        video.play().catch(() => {});
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari-style) — not applicable in Chrome, but
      // kept as a graceful fallback for any Chromium build without MSE.
      video.src = src;
    } else {
      showStatus('This browser cannot play HLS streams.');
    }
  }

  volRange.value = video.volume;
  updateMuteIcon();

  if (referer) {
    showStatus('Preparing stream…');
    // Ask the background service worker to install a domain-wide referer
    // rule BEFORE the first request goes out — hls.js will fetch the
    // manifest, then separate sub-playlists/segments/keys, usually from
    // the same host but different paths, so a single-URL rule (like the
    // one used for a plain "Open") wouldn't cover them all.
    chrome.runtime.sendMessage(
      { type: 'PREPARE_HLS_REFERER', url: src, referer },
      () => {
        void chrome.runtime.lastError;
        startPlayback();
      }
    );
  } else {
    startPlayback();
  }
})();
