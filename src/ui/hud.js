//  HUD and menus. Plain DOM, so it stays crisp and is trivial to keep in sync with the
//  game state. Every user action here is wired to a callback owned by main.js.

const el = (id) => document.getElementById(id);

export function createHud(handlers) {
  const root = el('hud');
  const state = {
    levelName: el('level-name'),
    levelShape: el('level-shape'),
    levelDots: el('level-dots'),
    time: el('stat-time'),
    falls: el('stat-falls'),
    // Present only on the levels that show it; `setStats` no-ops when the chip is absent.
    marbleStat: el('stat-marbles'),
    marbleNorm: el('stat-marbles-home'),
    best: el('stat-best'),
    bestRow: el('best-row'),
    hint: el('hint'),
    flash: el('flash'),
    bubble: el('bubble-dot'),
    bubbleWrap: el('bubble'),
    mode: el('mode-label'),
    win: el('overlay-win'),
    winStars: el('win-stars'),
    winTime: el('win-time'),
    winFalls: el('win-falls'),
    winBest: el('win-best'),
    winNext: el('win-next'),
    menu: el('overlay-menu'),
    pause: el('overlay-pause'),
    levelList: el('level-list'),
    slate: el('slate-list'),
    demoBadge: el('demo-badge'),
    soundBtn: el('btn-sound'),
    helpPanel: el('help'),
  };

  // ---------------------------------------------------------------- level select
  function renderLevels(levels, bests, currentId, onPick) {
    state.levelList.innerHTML = '';
    for (const lv of levels) {
      const card = document.createElement('button');
      card.className = 'level-card';
      if (lv.id === currentId) card.classList.add('is-current');
      const best = bests[lv.id];
      card.innerHTML = `
        <span class="lc-top">
          <span class="lc-num">${lv.isDraft ? 'draft' : lv.difficulty}</span>
          <span class="lc-name">${lv.name}</span>
        </span>
        <span class="lc-shape">${lv.shape}</span>
        <span class="lc-best">${best ? `best ${fmtTime(best.time)} · ${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)}` : 'not finished yet'}</span>`;
      card.addEventListener('click', () => onPick(lv.id));
      state.levelList.appendChild(card);
    }
    const soon = document.createElement('div');
    soon.className = 'level-card is-soon';
    soon.innerHTML = `<span class="lc-top"><span class="lc-num">?</span><span class="lc-name">More levels</span></span>
      <span class="lc-shape">in review</span>
      <span class="lc-best">Level 2 onward is waiting on your notes on Level 1.</span>`;
    soon.addEventListener('click', () => handlers.onShowSlate?.());
    state.levelList.appendChild(soon);
  }

  function renderSlate(ideas) {
    state.slate.innerHTML = '';
    for (const idea of ideas) {
      const row = document.createElement('div');
      row.className = 'slate-row';
      row.innerHTML = `<span class="slate-n">${idea.n}</span>
        <span class="slate-body"><b>${idea.name}</b> — ${idea.shape.toLowerCase()} board. ${idea.idea}<br><em>${idea.ask}</em></span>`;
      state.slate.appendChild(row);
    }
  }

  // -------------------------------------------------------------------- helpers
  function fmtTime(t) {
    if (t == null) return '--:--';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  let hintTimer = 0;
  function showHint(text, seconds = 6) {
    state.hint.textContent = text;
    state.hint.classList.add('show');
    hintTimer = seconds;
  }

  let flashTimer = 0;
  function flash(text, seconds = 1.6, kind = '') {
    state.flash.textContent = text;
    state.flash.className = `flash show ${kind}`;
    flashTimer = seconds;
  }

  function setLevelInfo(lv, best, hasNext) {
    state.levelName.textContent = lv.name;
    state.levelShape.textContent = lv.isDraft ? `draft · ${lv.shape}` : lv.shape;
    state.levelDots.innerHTML = Array.from({ length: 10 }, (_, i) => `<i class="${i < lv.difficulty ? 'on' : ''}"></i>`).join('');
    state.best.textContent = best ? fmtTime(best.time) : '--:--';
    state.bestRow.classList.toggle('has-best', !!best);
    state.winNext.disabled = !hasNext;
    state.winNext.textContent = hasNext ? 'Next level →' : 'Next level (soon)';
  }

  /**
   * `marbles` is `{ home, total }` on a multi-marble level, or null on an ordinary one. The chip
   * is shown only when there is more than one marble, so the single-marble HUD is unchanged.
   */
  function setStats(time, falls, marbles = null) {
    state.time.textContent = fmtTime(time);
    state.falls.textContent = String(falls);
    if (!state.marbleStat) return;
    const multi = marbles && marbles.total > 1;
    state.marbleStat.hidden = !multi;
    if (multi) state.marbleNorm.textContent = `${marbles.home} / ${marbles.total}`;
  }

  function setTilt(tilt, max) {
    // Travel is a fraction of the dial, not a fixed number of pixels: the pad is smaller on
    // narrow screens, and at full tilt the dot still has to stay inside the ring.
    const travel = (state.bubbleWrap.clientWidth || 74) * 0.35;
    const x = (tilt.z / max) * travel;
    const y = (tilt.x / max) * travel;
    state.bubble.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${-y.toFixed(1)}px)`;
  }

  function setMode(label) {
    state.mode.textContent = label;
  }

  function showWin({ stars, time, falls, best, isNewBest, hasNext }) {
    state.winStars.innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="star ${i < stars ? 'on' : ''}">★</span>`).join('');
    state.winTime.textContent = fmtTime(time);
    state.winFalls.textContent = String(falls);
    state.winBest.textContent = isNewBest ? 'new best!' : best ? fmtTime(best.time) : '--:--';
    state.winNext.disabled = !hasNext;
    state.winNext.textContent = hasNext ? 'Next level →' : 'Next level (soon)';
    state.win.classList.add('show');
  }

  function hideWin() {
    state.win.classList.remove('show');
  }

  function showMenu(on) {
    state.menu.classList.toggle('show', on);
  }

  function showPause(on) {
    state.pause.classList.toggle('show', on);
  }

  function showDemo(on) {
    state.demoBadge.classList.toggle('show', on);
  }

  function setSound(on) {
    state.soundBtn.textContent = on ? 'sound on' : 'sound off';
    state.soundBtn.classList.toggle('off', !on);
  }

  function tick(dt) {
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) state.hint.classList.remove('show');
    }
    if (flashTimer > 0) {
      flashTimer -= dt;
      if (flashTimer <= 0) state.flash.classList.remove('show');
    }
  }

  // ------------------------------------------------------------------- handlers
  el('btn-restart').addEventListener('click', () => handlers.onRestart());
  el('btn-pause').addEventListener('click', () => handlers.onPause());
  el('btn-menu').addEventListener('click', () => handlers.onMenu());
  el('btn-demo').addEventListener('click', () => handlers.onDemo());
  el('btn-sound').addEventListener('click', () => handlers.onToggleSound());
  el('win-retry').addEventListener('click', () => handlers.onRestart());
  el('win-next').addEventListener('click', () => handlers.onNext());
  el('win-menu').addEventListener('click', () => handlers.onMenu());
  el('menu-close').addEventListener('click', () => handlers.onCloseMenu());
  el('pause-resume').addEventListener('click', () => handlers.onResume());
  el('pause-restart').addEventListener('click', () => handlers.onRestart());
  el('pause-menu').addEventListener('click', () => handlers.onMenu());
  el('btn-help').addEventListener('click', () => state.helpPanel.classList.toggle('show'));
  el('help-close').addEventListener('click', () => state.helpPanel.classList.remove('show'));

  return {
    root,
    state,
    renderLevels,
    renderSlate,
    setLevelInfo,
    setStats,
    setTilt,
    setMode,
    showHint,
    flash,
    showWin,
    hideWin,
    showMenu,
    showPause,
    showDemo,
    setSound,
    tick,
    fmtTime,
  };
}
