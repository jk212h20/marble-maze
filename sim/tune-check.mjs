//  Browser check for the physics tuning panel: sliders exist, they change the simulation
//  live, the marble follows the size slider, settings persist, and typing/arrow keys inside
//  the panel never tilt the board.
//
//  Run: node sim/tune-check.mjs
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:3010/';
const problems = [];
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(url, { waitUntil: 'load', timeout: 180000 });
//  The boot has to be allowed to take a while, and it has to *say* what it saw when it does not
//  arrive. A default 30s wait on a busy machine looks exactly like a broken build, and the title is
//  what distinguishes "the game is slow" from "that port is serving some other application".
//
//  Every wait for the game in this file goes through here, including the four after a reload: a
//  reload is a full re-boot, so it needs the same allowance as the first one. Leaving those at the
//  default is how this check failed with a bare `Timeout 30000ms exceeded` that said nothing about
//  which wait had starved.
const booted = (label) =>
  page
    .waitForFunction('window.__maze && window.__maze.tuning', null, { timeout: 120000 })
    .catch(async () => {
      const title = await page.evaluate(() => document.title).catch(() => 'unknown');
      throw new Error(`the game never booted ${label} at ${url} (page title: "${title}")`);
    });
await booted('');
await page.waitForTimeout(1200);

const report = {};

// 1. the panel exists, opens, and has one control per tunable
await page.click('#btn-tune');
await page.waitForTimeout(300);
report.panel = await page.evaluate(() => {
  const panel = document.getElementById('tune-panel');
  return {
    visible: panel.classList.contains('show'),
    sliders: panel.querySelectorAll('input[type=range]').length,
    // A choice item (the indicator mode) is a row of buttons and a colour is the browser's picker,
    // so the panel's control count is sliders plus choices plus colours - one control per tunable is
    // the property that matters, and a new control type has to be counted or it looks like a gap.
    choices: panel.querySelectorAll('.tune-seg').length,
    colours: panel.querySelectorAll('input[type=color]').length,
    groups: panel.querySelectorAll('details').length,
    specItems: window.__maze.tuning.spec.flatMap((g) => g.items).length,
    labels: [...panel.querySelectorAll('.tune-row-top b')].slice(0, 6).map((n) => n.textContent),
  };
});
if (!report.panel.visible) problems.push('tuning panel did not open');
if (report.panel.sliders + report.panel.choices + report.panel.colours !== report.panel.specItems) {
  problems.push(
    `panel has ${report.panel.sliders} sliders, ${report.panel.choices} choices and ${report.panel.colours} colours ` +
    `for ${report.panel.specItems} tunables`,
  );
}
// and the indicator choice itself has to work: pressing a button changes the mode
report.switch = await page.evaluate(async () => {
  const before = window.__maze.tuning.get('indicator');
  // Scoped to the indicator's own row: every choice row is a `.tune-seg`, so a document-wide
  // search for buttons grabs the board-finish row's first button instead.
  const buttons = [...document.querySelectorAll('.tune-row[data-path="indicator"] .tune-seg button')];
  const target = buttons.find((b) => b.dataset.value !== before);
  target?.click();
  await new Promise((r) => setTimeout(r, 120));
  const after = window.__maze.tuning.get('indicator');
  const marked = buttons.filter((b) => b.classList.contains('on')).map((b) => b.dataset.value);
  const back = buttons.find((b) => b.dataset.value === before);
  back?.click();
  await new Promise((r) => setTimeout(r, 120));
  return { before, after, target: target?.dataset.value, marked, restored: window.__maze.tuning.get('indicator') };
});
if (!report.switch?.target) problems.push('the indicator choice has no buttons');
else if (report.switch.after !== report.switch.target) {
  problems.push(`clicking ${report.switch.target} left the indicator at ${report.switch.after}`);
} else if (report.switch.marked.length !== 1 || report.switch.marked[0] !== report.switch.after) {
  problems.push(`the indicator buttons mark ${report.switch.marked.join(', ')} as selected`);
} else if (report.switch.restored !== report.switch.before) {
  problems.push('the indicator did not return to its first value');
}

// 2. a slider drag changes the simulation, not just a number in the UI
report.live = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Stepped by an exact simulated second rather than a wall-clock sleep: on a software
  // renderer (or under a heavy scene) 1200 ms of waiting is only a few frames of physics,
  // and this check would end up measuring the frame rate instead of the gravity slider.
  const measure = (gravity) => {
    window.__maze.tuning.reset();
    if (gravity) window.__maze.tuning.set('gravity', gravity);
    window.__maze.restart();
    window.__maze.holdTilt(0, 0.25);
    const x0 = window.__maze.world.ball.x;
    window.__maze.advance(1.0);
    const travel = window.__maze.world.ball.x - x0;
    window.__maze.holdTilt(0, 0);
    return travel;
  };
  const slow = measure();
  const fast = measure(16);
  window.__maze.tuning.reset();
  // and through the actual slider element, not just the API
  const slider = document.querySelector('input[data-path="gravity"]');
  slider.value = '15';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  const applied = window.__maze.tuning.get('gravity');
  const readout = slider.closest('.tune-row').querySelector('i').textContent;
  window.__maze.tuning.reset();
  return { slow: +slow.toFixed(2), fast: +fast.toFixed(2), applied, readout };
});
if (!(report.live.fast > report.live.slow + 0.2)) {
  problems.push(`gravity slider did not change the roll (${report.live.slow} -> ${report.live.fast})`);
}
if (report.live.applied !== 15) problems.push(`slider input did not reach the engine (${report.live.applied})`);

// 3. marble size moves the rendered marble too
report.marble = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // the marble is a group; the size lives on the group's scale
  const find = () => {
    let m = null;
    window.__maze.scene.scene.traverse((o) => {
      if (o.name === 'marble-ball') m = o;
    });
    return m.parent;
  };
  // The rendered scale is only written by the frame loop, so this one genuinely has to
  // wait for frames - give a slow renderer room for a couple of them.
  window.__maze.tuning.set('ballR', 0.2);
  await sleep(700);
  const small = find().scale.x;
  window.__maze.tuning.set('ballR', 0.4);
  await sleep(700);
  const big = find().scale.x;
  window.__maze.tuning.reset();
  await sleep(500);
  return { small: +small.toFixed(3), big: +big.toFixed(3), back: +find().scale.x.toFixed(3) };
});
if (!(report.marble.big > report.marble.small * 1.5)) {
  problems.push(`marble size slider did not resize the ball (${report.marble.small} -> ${report.marble.big})`);
}

// 3b. the marble selector swaps the marble that is actually on the board.
//
//  Driven through the sheet's own segmented control, not the API, because that is the path a player
//  uses - and it is the path that was once wired up while the API path was not. The signature is
//  structural (mesh count, light count, the colours of the materials), so it cannot pass by reading
//  back the same label it just set.
report.marbleLook = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The panel is already open from check 1; clicking the button again would toggle it *shut*, and
  // the later key check focuses a slider inside it.
  const group = () => {
    let ball = null;
    window.__maze.scene.scene.traverse((o) => {
      if (o.name === 'marble-ball') ball = o;
    });
    return ball ? ball.parent : null;
  };
  const signature = () => {
    const g = group();
    if (!g) return null;
    let meshes = 0;
    let lights = 0;
    const colors = [];
    g.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        //  A material's colour is not enough any more: the solid marble's colour and bands live in its
        //  own map, so the signature has to see the texture too or a recolour reads as "unchanged".
        const map = o.material.map?.image?.data;
        let sum = 0;
        if (map) for (let i = 0; i < map.length; i += 7) sum = (sum + map[i]) % 100000;
        colors.push((o.material.color ? o.material.color.getHexString() : '') + (map ? `+${sum}` : ''));
      }
      if (o.isLight) lights++;
    });
    return { meshes, lights, colors: colors.sort(), id: window.__maze.scene.marble.id };
  };
  const click = async (value) => {
    const btn = document.querySelector(`.tune-row[data-path="marbleLook"] .tune-seg button[data-value="${value}"]`);
    if (!btn) return false;
    btn.click();
    await sleep(400);
    return true;
  };
  const before = signature();
  const clickedLantern = await click('lantern');
  const lantern = signature();
  const clickedSolid = await click('solid');
  const solid = signature();
  window.__maze.tuning.reset();
  await sleep(400);
  const back = signature();
  return { before, lantern, solid, back, clickedLantern, clickedSolid };
});
{
  //  The two shipped alternatives to the cat's-eye, each chosen because it differs from it in a way
  //  the signature can see: the lantern brings a light, solid brings a different surface.
  const r = report.marbleLook;
  if (!r.clickedLantern || !r.clickedSolid) problems.push('the sheet has no segmented control for the marble look');
  else {
    if (r.lantern.id !== 'lantern') problems.push(`choosing Lantern from the sheet did not reach the renderer (${r.lantern.id})`);
    if (r.solid.id !== 'solid') problems.push(`choosing Solid from the sheet did not reach the renderer (${r.solid.id})`);
    if (r.lantern.colors.join() === r.before.colors.join()) problems.push('the marble geometry did not change when the look did');
    // The lantern is the one with a lamp in it: if no light appears, the whole point of it is gone.
    if (!(r.lantern.lights > r.before.lights)) problems.push(`the lantern brought no light (${r.before.lights} -> ${r.lantern.lights})`);
    //  Solid is one sphere with a pattern on it, so the *colours* change, not the mesh count.
    if (r.solid.colors.join() === r.before.colors.join()) problems.push('the solid marble\'s surface did not change');
    if (r.back.id !== 'catseye') problems.push(`reset did not restore the shipped marble (${r.back.id})`);
  }
}

// 3c. the lamp dials reach the lamp.
//
//  A dial that exists in the sheet and does nothing is the failure this catches. The signature is
//  the light's own colour and the marble's lamp gain, so it cannot pass by reading back the value
//  it just set. Brightness is checked as a gain rather than as `light.intensity`, because the
//  lantern's own per-frame tick owns the intensity (it multiplies the gain by the pulse).
report.lampDials = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lamp = () => {
    let found = null;
    window.__maze.scene.scene.traverse((o) => { if (o.isPointLight && o.parent?.userData?.lamp) found = o; });
    return found;
  };
  //  The lamp's gain and its light live on the marble group, which is the light's own parent.
  const gain = () => lamp()?.parent?.userData?.lampGain ?? null;
  window.__maze.tuning.set('marbleLook', 'lantern');
  await sleep(500);
  const shipped = { color: lamp()?.color.getHexString() ?? null, gain: gain() };
  window.__maze.tuning.set('marbleLampHue', 200);
  window.__maze.tuning.set('marbleLampBrightness', 2);
  await sleep(500);
  const shifted = { color: lamp()?.color.getHexString() ?? null, gain: gain(), intensity: lamp()?.intensity ?? null };
  //  Put the dials *back* rather than resetting, because resetting also puts the cat's-eye back on the
  //  board - and then there is no lamp left to be the right colour, which is not a failure of the lamp.
  window.__maze.tuning.set('marbleLampHue', 36);
  window.__maze.tuning.set('marbleLampBrightness', 1);
  await sleep(500);
  const restored = { color: lamp()?.color.getHexString() ?? null, gain: gain(), look: window.__maze.scene.marble.id };
  window.__maze.tuning.reset();
  await sleep(400);
  return { shipped, shifted, restored, afterReset: window.__maze.scene.marble.id };
});
{
  const r = report.lampDials;
  if (!r.shipped.color) problems.push('no lamp found on the lantern, so the lamp dials cannot be checked');
  else {
    if (r.shifted.color === r.shipped.color) problems.push(`the hue dial did not move the lamp colour (${r.shipped.color})`);
    if (r.restored.color !== r.shipped.color) problems.push(`the lamp did not return to its shipped colour (${r.shipped.color} -> ${r.restored.color})`);
    if (r.shifted.gain !== 2) problems.push(`the brightness dial did not reach the lamp (gain ${r.shifted.gain}, expected 2)`);
    if (!(r.shifted.intensity > 0)) problems.push('the lamp went dark when the brightness dial was raised');
    if (r.restored.gain !== 1) problems.push(`the lamp did not return to its shipped brightness (gain ${r.restored.gain})`);
    if (r.afterReset !== 'catseye') problems.push(`reset did not restore the shipped marble (${r.afterReset})`);
  }
}

// 3d. the colour picker, driven through the panel's own control.
//
//  A picker is exactly the sort of thing that can look right and do nothing - it is a new control
//  type, and the value it writes is a string in a layer that had only ever clamped numbers. So this
//  clicks the real input and checks the marble's own surface changed, and that what the panel shows
//  is what the tuning layer stored.
report.solidColor = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const surface = () => {
    let sum = null;
    window.__maze.scene.scene.traverse((o) => {
      if (o.name === 'marble-ball' && o.material.map?.image?.data) {
        sum = 0;
        const data = o.material.map.image.data;
        for (let i = 0; i < data.length; i += 5) sum = (sum + data[i]) % 1000000;
      }
    });
    return sum;
  };
  window.__maze.tuning.set('marbleLook', 'solid');
  await sleep(500);
  const input = document.querySelector('.tune-row[data-path="marbleSolidColor"] input[type=color]');
  if (!input) return { found: false };
  const before = surface();
  const shownBefore = input.value;
  input.value = '#c0392b';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);
  const after = surface();
  const stored = window.__maze.tuning.get('marbleSolidColor');
  const custom = window.__maze.tuning.customised();
  window.__maze.tuning.reset();
  await sleep(400);
  return { found: true, before, after, shownBefore, stored, custom, restored: window.__maze.tuning.get('marbleSolidColor') };
});
{
  const r = report.solidColor;
  if (!r.found) problems.push('the sheet has no colour picker for the solid marble');
  else {
    if (r.before === r.after) problems.push('picking a colour did not change the marble surface');
    if (r.stored !== '#c0392b') problems.push(`the picker stored ${r.stored} instead of the colour chosen`);
    if (!r.custom) problems.push('recolouring the marble did not register as a custom tuning');
    if (r.restored !== '#15171d') problems.push(`reset did not restore the shipped colour (${r.restored})`);
  }
}

// 4. presets and the customised badge
report.badge = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.getElementById('btn-tune');
  const before = { custom: window.__maze.tuning.customised(), text: btn.textContent };
  window.__maze.tuning.preset('slick');
  await sleep(200);
  const mid = {
    custom: window.__maze.tuning.customised(),
    text: btn.textContent,
    drag: window.__maze.tuning.get('surfaces.wood.drag'),
    diffKeys: Object.keys(window.__maze.tuning.diff()).length,
  };
  window.__maze.tuning.reset();
  await sleep(150);
  const after = { custom: window.__maze.tuning.customised(), text: btn.textContent };
  return { before, mid, after };
});
if (report.badge.before.custom) problems.push('tuning reported as customised before any change');
if (!report.badge.mid.custom || report.badge.mid.diffKeys < 3) problems.push('preset did not register as a custom tuning');
if (report.badge.after.custom) problems.push('reset did not return to the shipping defaults');

// 5. keys typed inside the panel must not tilt the board
report.keys = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__maze.restart();
  window.__maze.holdTilt(null);
  // sliders inside a folded group are not focusable: open them first
  document.querySelectorAll('#tune-panel details').forEach((d) => (d.open = true));
  const slider = document.querySelector('input[data-path="tiltRate"]');
  slider.scrollIntoView({ block: 'center' });
  const before = slider.value;
  slider.focus();
  return { before, ready: document.activeElement === slider };
});
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(500);
report.keysAfter = await page.evaluate(() => {
  const slider = document.querySelector('input[data-path="tiltRate"]');
  return {
    after: slider.value,
    tiltControlZ: window.__maze.world.control.z,
    tiltZ: +window.__maze.world.tilt.z.toFixed(4),
  };
});
if (report.keysAfter.tiltControlZ !== 0 || Math.abs(report.keysAfter.tiltZ) > 0.001) {
  problems.push('arrow keys inside the tuning panel tilted the board');
}
if (report.keysAfter.after === report.keys.before) {
  problems.push('arrow keys inside the tuning panel did not adjust the slider');
}
await page.evaluate(() => window.__maze.tuning.reset());

// 6. settings survive a reload, and ?physics=default ignores them
report.persist = await page.evaluate(() => {
  window.__maze.tuning.set('surfaces.wood.roll', 0.31);
  window.__maze.tuning.set('maxTilt', 0.19);
  return window.__maze.tuning.json();
});
await page.reload({ waitUntil: 'load' });
await booted('after a reload');
await page.waitForTimeout(900);
report.afterReload = await page.evaluate(() => ({
  roll: window.__maze.tuning.get('surfaces.wood.roll'),
  maxTilt: window.__maze.tuning.get('maxTilt'),
  custom: window.__maze.tuning.customised(),
}));
if (Math.abs(report.afterReload.roll - 0.31) > 1e-9) problems.push('tuning did not survive a reload');
if (!report.afterReload.custom) problems.push('reloaded tuning was not reported as custom');

await page.goto(`${url}?physics=default`, { waitUntil: 'load' });
await booted('on ?physics=default');
await page.waitForTimeout(700);
report.forcedDefault = await page.evaluate(() => ({
  roll: window.__maze.tuning.get('surfaces.wood.roll'),
  custom: window.__maze.tuning.customised(),
}));
if (report.forcedDefault.custom) problems.push('?physics=default did not ignore the saved tuning');

// 7. copy JSON reflects the live values
await page.goto(url, { waitUntil: 'load' });
await booted('on a fresh load');
await page.waitForTimeout(700);
report.export = await page.evaluate(() => {
  window.__maze.tuning.set('pitCapture', 0.55);
  const json = window.__maze.tuning.json();
  window.__maze.tuning.reset();
  return { hasKey: json.includes('"pitCapture": 0.55'), length: json.length };
});
if (!report.export.hasKey) problems.push('exported JSON does not include the changed value');

// 8. the slider range modes widen the sliders outward, and a value can be taken past the
//    shipped range on purpose
report.ranges = await page.evaluate(() => {
  const gravity = () => document.querySelector('input[data-path="gravity"]');
  const modeButton = (text) => [...document.querySelectorAll('.tune-ranges button')].find((b) => b.textContent.includes(text));
  modeButton('Normal').click();
  const normalMax = Number(gravity().max);
  const normalMarked = document.querySelectorAll('.tune-ranges button.on').length;
  modeButton('Extreme').click();
  const extremeMax = Number(gravity().max);
  // drag the slider to the very top of the widened range: this is the whole point of the mode
  const slider = gravity();
  slider.value = String(extremeMax);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  const applied = window.__maze.tuning.get('gravity');
  const readout = slider.closest('.tune-row').querySelector('i').textContent;
  modeButton('Wide').click();
  const wideMax = Number(gravity().max);
  const kept = window.__maze.tuning.get('gravity');
  window.__maze.tuning.reset();
  gravity().dispatchEvent(new Event('input', { bubbles: true }));
  return { normalMax, extremeMax, wideMax, normalMarked, applied, kept, readout };
});
if (report.ranges.normalMax !== 20) problems.push(`the normal range is not the shipped one (${report.ranges.normalMax})`);
if (!(report.ranges.extremeMax >= 200)) problems.push(`the extreme range is not far past the shipped one (${report.ranges.extremeMax})`);
if (!(report.ranges.wideMax > report.ranges.normalMax && report.ranges.wideMax < report.ranges.extremeMax)) {
  problems.push(`wide mode did not sit between normal and extreme (${report.ranges.wideMax})`);
}
if (report.ranges.normalMarked !== 1) problems.push('the range mode did not mark exactly one button as current');
if (report.ranges.applied !== report.ranges.extremeMax) {
  problems.push(`the widened slider did not reach the engine (${report.ranges.applied})`);
}
// Switching back to a narrower mode is a view change only: it must not rewrite the number.
if (report.ranges.kept !== report.ranges.applied) problems.push('narrowing the range rewrote the value');

// 9. save a profile, reload the page, load the profile back, delete it
report.profileSave = await page.evaluate(() => {
  window.__maze.tuning.reset();
  window.__maze.tuning.set('gravity', 17.4);
  const input = document.querySelector('.tune-profile-name');
  input.value = 'browser check';
  document.querySelector('.tune-profile-new button').click();
  const names = [...document.querySelectorAll('.tune-profile-label')].map((n) => n.textContent);
  const note = document.querySelector('.tune-profile-head .tune-status').textContent;
  window.__maze.tuning.reset();
  return { names, note };
});
if (!report.profileSave.names.includes('browser check')) {
  problems.push(`saving a profile did not list it (${JSON.stringify(report.profileSave.names)})`);
}
if (!report.profileSave.note.includes('saved')) problems.push(`the save was not acknowledged (${report.profileSave.note})`);

await page.reload({ waitUntil: 'load' });
await booted('after a reload');
await page.waitForTimeout(900);
report.profileLoad = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('btn-tune').click();
  await sleep(200);
  const label = [...document.querySelectorAll('.tune-profile-label')].find((n) => n.textContent === 'browser check');
  if (!label) return { found: false };
  const row = label.closest('.tune-profile');
  row.querySelector('button').click();
  await sleep(200);
  const loaded = window.__maze.tuning.get('gravity');
  // delete it again so the check leaves the browser as it found it
  row.querySelectorAll('button')[1].click();
  await sleep(200);
  return {
    found: true,
    loaded,
    rowsAfterDelete: [...document.querySelectorAll('.tune-profile-label')].map((n) => n.textContent),
  };
});
if (!report.profileLoad.found) problems.push('the saved profile did not survive a reload');
else {
  if (Math.abs(report.profileLoad.loaded - 17.4) > 1e-9) problems.push(`loading a profile did not restore it (${report.profileLoad.loaded})`);
  if (report.profileLoad.rowsAfterDelete.includes('browser check')) problems.push('deleting a profile left it in the list');
}

report.consoleErrors = errors;
report.problems = problems;
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(problems.length || errors.length ? 1 : 0);
