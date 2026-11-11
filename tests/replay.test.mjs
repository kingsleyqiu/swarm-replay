import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = `<!doctype html>
<meta charset="utf-8"><title>Swarm Replay smoke test</title>
<style>
  body { margin: 0; font: 18px system-ui; }
  main { max-width: 950px; margin: 30px auto; }
  h1 { font: 46px Georgia; }
  img { display: block; width: 250px; height: 110px; background: teal; }
  #thumbnail { display: block; width: max-content; position: relative; overflow: hidden; }
  #duration { position: absolute; right: 3px; bottom: 3px; }
  details, .row { border-top: 1px solid #444; padding: 8px 0; }
  #scrollbox { height: 115px; overflow: auto; }
  #scrollbox p { margin: 0; }
</style>
<main>
  <h1 id="title">Watch this heading being <em>typed</em></h1>
  <a id="thumbnail" aria-hidden="true" href="/watch?v=sample">
    <yt-thumbnail-view-model>
      <img id="photo" width="250" height="110" alt="Test image"
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      <span id="duration" aria-hidden="true">2:26</span>
    </yt-thumbnail-view-model>
  </a>
  <details><summary>How does the FAQ open?</summary><p>Native answer.</p></details>
  <address>18 Juniper Lane<br>Maplewick</address>
  <div class="row"><small>Open until six</small></div>
  <form><input aria-label="Name" value="Original value"></form>
  <div id="scrollbox">
    <p>Start of the inner scroll area</p>
    <div style="height: 190px"></div>
    <p id="nested">Text lower in the inner scroll area</p>
  </div>
  <div style="height: 780px"></div>
  <h2 id="lower">A section below the fold</h2>
  <div style="height: 400px"></div>
</main>
<script>
  window.originalText = document.querySelector('h1').firstChild;
  requestAnimationFrame(() => {
    window.firstFrameHidden = getComputedStyle(document.body).opacity === '0'
      || getComputedStyle(document.querySelector('h1')).opacity === '0';
    window.firstThumbnailHidden = getComputedStyle(document.body).opacity === '0'
      || getComputedStyle(document.querySelector('#thumbnail')).opacity === '0';
  });
</script>`;

const dashboard = `<!doctype html><meta charset="utf-8">
<style>
  #icon-frame { border: 1px solid; width: 44px; height: 44px; }
  #rule { height: 6px; }
  #rule::before { content: ""; display: block; height: 1px; background: gray; }
  #feed { margin-top: 1200px; }
</style>
<main>
  <h1 id="article">A dashboard on a second origin</h1>
  <div><span id="status-label">STATUS</span> <span id="status-value">Healthy</span></div>
  <div id="icon-frame"><svg id="status-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
    <path d="M2 10L8 16L18 2" fill="none" stroke="green"/>
  </svg></div>
  <div id="rule"></div>
  <div id="live"></div>
  <div id="feed">${'<article data-test-feed-card><p>Offscreen card</p></article>'.repeat(2000)}</div>
</main>`;

const navigation = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px system-ui; }
  header, nav, [role="navigation"], #fixed { background: #ddd; }
  #sticky, #fixed, #regular { display: flex; align-items: center; gap: 20px; height: 42px; }
  #sticky { position: sticky; top: 0; z-index: 2; }
  #fixed { position: fixed; top: 42px; left: 0; right: 0; z-index: 2; }
  #regular { position: relative; margin-top: 42px; }
  #categories { position: absolute; top: 42px; left: 0; right: 0; height: 34px; background: #ddd; }
  #dropdown { position: absolute; top: 36px; right: 16px; z-index: 1; background: white; }
  #floating { position: fixed; bottom: 8px; right: 8px; background: #eee; }
  main { min-height: 2000px; margin-top: 34px; }
</style>
<header id="sticky"><div role="navigation"><a id="sticky-link" href="#content">Home</a></div></header>
<div id="fixed">
  <a id="fixed-link" href="#content">DSA</a><a href="#content">Python</a><a href="#content">Courses</a>
</div>
<nav id="regular">
  <a id="regular-link" href="#content">Practice Problems</a>
  <button id="menu-button" aria-expanded="false">More topics</button>
  <div id="categories">
    <a id="category-link" href="#content">Web</a> <a href="#content">Cloud</a> <a href="#content">Data</a>
  </div>
</nav>
<aside id="floating"><button id="floating-button">Help</button></aside>
<main id="content"><h1>Practice topics</h1></main>
<script>
  document.querySelector('#menu-button').onclick = event => {
    event.currentTarget.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.id = 'dropdown';
    menu.innerHTML = '<a href="#content">Linux</a>';
    document.querySelector('#regular').append(menu);
  };
</script>`;

const workload = `<!doctype html><meta charset="utf-8">
<style>
  body { font: 16px system-ui; }
  #dense { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  #dense p { min-height: 54px; margin: 0; }
  .spacer { height: 1250px; }
</style>
<main>
  <p id="sparse">One layer near the top.</p>
  <div class="spacer"></div>
  <section id="dense">${'<p>Each cursor has a paragraph to write in the crowded section.</p>'.repeat(42)}</section>
  <div class="spacer"></div>
  <p id="sparse-end">One layer after the grid.</p>
  <div class="spacer"></div>
</main>`;

const probe = `
(() => {
  const counts = { frames: 0, feedRects: 0, wholePageQueries: 0 };
  const frame = globalThis.requestAnimationFrame;
  const rect = Element.prototype.getBoundingClientRect;
  const query = Element.prototype.querySelectorAll;
  globalThis.requestAnimationFrame = callback => {
    counts.frames++;
    return frame(callback);
  };
  Element.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-test-feed-card')) counts.feedRects++;
    return rect.call(this);
  };
  Element.prototype.querySelectorAll = function (selector) {
    if (this === document.body) counts.wholePageQueries++;
    return query.call(this, selector);
  };
  document.addEventListener('sample-replay-test', () => {
    document.documentElement.dataset.replayTestCounts = JSON.stringify(counts);
  });
})();
`;

function replayCounts(page) {
  return page.evaluate(() => {
    document.dispatchEvent(new Event('sample-replay-test'));
    return JSON.parse(document.documentElement.dataset.replayTestCounts);
  });
}

async function serve(body, t) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function flatten(node) {
  const attributes = node.attributes ?? [];
  const pairs = [];
  for (let i = 0; i < attributes.length; i += 2) pairs.push([attributes[i], attributes[i + 1]]);
  return [Object.fromEntries(pairs), ...(node.children ?? []).flatMap(flatten), ...(node.shadowRoots ?? []).flatMap(flatten)];
}

async function waitForCrew(devtools, expected, minimumWorking = 0) {
  const deadline = Date.now() + 5000;
  let actual;
  let working;
  do {
    const { root } = await devtools.send('DOM.getDocument', { depth: -1, pierce: true });
    const visible = flatten(root).filter(attrs => !('hidden' in attrs));
    actual = visible.filter(attrs => attrs.class?.split(' ').includes('swr-cursor')).length;
    working = visible.filter(attrs => attrs.class?.split(' ').includes('swr-box')).length;
    if (actual === expected && working >= minimumWorking) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.equal(actual, expected, 'number of visible agents');
  assert.ok(working >= minimumWorking, 'agents working in parallel');
}

test('the unpacked extension animates visible content and restores the original page', { timeout: 60000 }, async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'swarm-replay-test-'));
  let context;
  t.after(async () => {
    await context?.close();
    await rm(sandbox, { recursive: true, force: true });
  });
  const extension = join(sandbox, 'extension');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const origins = manifest.optional_host_permissions;
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
  const id = [...hash].map(hex => String.fromCharCode(97 + parseInt(hex, 16))).join('');
  await cp(root, extension, {
    recursive: true,
    filter: source => !/[\\/](?:node_modules|\.git|tests|test-results)(?:[\\/]|$)/.test(source)
  });
  // The test profile grants access up front because the native permission dialog is outside the test page.
  manifest.host_permissions = origins;
  manifest.key = key.toString('base64');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const replayPath = join(extension, 'replay.js');
  await writeFile(replayPath, probe + await readFile(replayPath, 'utf8'));
  const [first, second, third, fourth] = await Promise.all([
    serve(fixture, t),
    serve(dashboard, t),
    serve(navigation, t),
    serve(workload, t)
  ]);
  const launch = () => chromium.launchPersistentContext(join(sandbox, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1024, height: 768 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  context = await launch();
  let page = await context.newPage();
  await page.goto(first);
  assert.equal(await page.locator('[data-swr-page-state]').count(), 0);
  const popupUrl = `chrome-extension://${id}/popup.html`;
  let popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole('checkbox', { name: 'Auto-play on websites' }).check();
  await popup.getByText('Auto-play is on for new page loads.').waitFor();
  await context.close();

  context = await launch();
  page = await context.newPage();
  await page.goto(first);
  await page.waitForFunction(() => typeof window.firstFrameHidden === 'boolean');
  if (!await page.evaluate(() => window.firstFrameHidden)) {
    const diagnostics = await context.newPage();
    await diagnostics.goto(popupUrl);
    const startup = await diagnostics.evaluate(async () => ({
      registrations: await chrome.scripting.getRegisteredContentScripts(),
      storage: await chrome.storage.local.get('autoplay'),
      permissions: await chrome.permissions.getAll()
    }));
    assert.fail(`The first frame was visible after restart. ${JSON.stringify(startup)}`);
  }
  assert.equal(await page.locator('summary').getAttribute('data-swr-page-state'), 'hidden');
  assert.equal(await page.evaluate(() => window.firstThumbnailHidden), true);
  assert.equal(await page.locator('#thumbnail').getAttribute('data-swr-page-state'), 'hidden');
  assert.equal(await page.locator('#duration').getAttribute('data-swr-page-state'), null);
  assert.equal(await page.locator('.row').getAttribute('data-swr-page-state'), 'surface');
  assert.equal(await page.locator('#nested').getAttribute('data-swr-page-state'), null);
  assert.equal(await page.locator('input').inputValue(), 'Original value');

  const devtools = await context.newCDPSession(page);
  const deadline = Date.now() + 4000;
  let concurrent = false;
  while (Date.now() < deadline && !concurrent) {
    const { root } = await devtools.send('DOM.getDocument', { depth: -1, pierce: true });
    const elements = flatten(root);
    concurrent = elements.some(attributes => attributes['data-tool'] === 'type' && !('hidden' in attributes))
      && elements.some(attributes => attributes['data-mode'] === 'draw' && 'data-media' in attributes && !('hidden' in attributes))
      && elements.some(attributes => attributes.style?.includes('clip-path: inset(-4px'));
  }
  assert.equal(concurrent, true, 'an I-beam types while another cursor draws the photo frame');
  assert.equal(await page.evaluate(() => document.querySelector('h1').firstChild === window.originalText), true);
  await page.evaluate(() => { document.querySelector('h1 em').firstChild.data = 'updated by the site'; });
  await page.waitForFunction(() => !document.querySelector('h1').hasAttribute('data-swr-page-state'));
  assert.match(await page.locator('#title').textContent(), /updated by the site/);
  await page.waitForFunction(() => !document.querySelector('#thumbnail').hasAttribute('data-swr-page-state')
    && !document.querySelector('#thumbnail').style.clipPath);
  await page.waitForFunction(() => !document.querySelector('summary').hasAttribute('data-swr-page-state'));
  await page.locator('summary').click();
  assert.equal(await page.locator('details').getAttribute('open'), '');

  await page.locator('#scrollbox').evaluate(box => { box.scrollTop = box.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('#nested').hasAttribute('data-swr-page-state'));
  await page.evaluate(() => window.scrollTo(0, 1150));
  await page.waitForFunction(() => document.querySelector('#lower').hasAttribute('data-swr-page-state'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-swr-page-state]').count(), 0);
  assert.ok(await page.evaluate(() => scrollY > 700));

  await page.evaluate(() => {
    history.pushState({}, '', '/story');
    document.querySelector('main').innerHTML = '<h1 id="story">A new story after a route change</h1>';
  });
  await page.waitForFunction(() => document.querySelector('#story').hasAttribute('data-swr-page-state'));
  const article = await context.newPage();
  await article.goto(second);
  assert.equal(await article.locator('#article').getAttribute('data-swr-page-state'), 'hidden');
  for (const selector of ['#status-label', '#status-value', '#status-icon']) {
    assert.equal(await article.locator(selector).getAttribute('data-swr-page-state'), 'hidden', selector);
  }
  assert.equal(await article.locator('#rule').getAttribute('data-swr-page-state'), 'surface');
  assert.equal(await article.locator('#rule').evaluate(element => getComputedStyle(element, '::before').visibility), 'hidden');
  const delayedHidden = await article.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => {
      const target = document.querySelector('#live');
      target.innerHTML = '<span id="delayed">A late-loaded status</span>';
      requestAnimationFrame(() => resolve(getComputedStyle(target.firstElementChild).opacity === '0'));
    });
  }));
  assert.equal(delayedHidden, true, 'content inserted by a web app is staged before the next frame');
  await article.waitForFunction(() => !document.querySelector('[data-swr-page-state]'));
  const before = await replayCounts(article);
  await article.evaluate(async () => {
    const card = document.querySelector('[data-test-feed-card]');
    for (let i = 0; i < 12; i++) {
      card.classList.toggle('updated');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });
  const after = await replayCounts(article);
  t.diagnostic(`2,000 offscreen cards, 12 mutations: ${after.frames - before.frames} replay frames, ${after.feedRects} offscreen card measurements, ${after.wholePageQueries} full-body selector scans`);
  assert.equal(after.frames - before.frames, 0);
  assert.equal(after.feedRects, 0);
  assert.equal(after.wholePageQueries, 0);
  await article.evaluate(() => document.querySelector('#feed').scrollIntoView());
  await article.waitForFunction(() => document.querySelector('[data-test-feed-card] p').hasAttribute('data-swr-page-state'));
  await article.emulateMedia({ reducedMotion: 'reduce' });
  await article.reload();
  assert.equal(await article.locator('[data-swr-page-state]').count(), 0);

  const navPage = await context.newPage();
  await navPage.goto(third);
  for (const selector of ['#sticky', '#sticky [role="navigation"]', '#fixed', '#regular', '#categories']) {
    assert.equal(await navPage.locator(selector).getAttribute('data-swr-page-state'), 'surface', selector);
  }
  for (const selector of ['#sticky-link', '#fixed-link', '#regular-link', '#menu-button', '#category-link']) {
    assert.equal(await navPage.locator(selector).getAttribute('data-swr-page-state'), 'hidden', selector);
  }
  assert.equal(await navPage.locator('#floating [data-swr-page-state]').count(), 0);
  await navPage.waitForFunction(() => !document.querySelector('#menu-button').hasAttribute('data-swr-page-state'));
  await navPage.getByRole('button', { name: 'More topics' }).click();
  const linux = navPage.getByRole('link', { name: 'Linux' });
  await linux.waitFor();
  assert.equal(await linux.getAttribute('data-swr-page-state'), null);
  assert.equal(await navPage.locator('#dropdown').getAttribute('data-swr-page-state'), null);
  await navPage.waitForFunction(() => !document.querySelector('[data-swr-page-state]'));
  await linux.click();
  assert.ok(navPage.url().endsWith('#content'));
  await navPage.evaluate(() => scrollTo(0, 450));
  assert.equal(await navPage.locator('#fixed').evaluate(element => element.getBoundingClientRect().top), 42);
  assert.equal(await navPage.locator('#sticky').evaluate(element => element.getBoundingClientRect().top), 0);

  await navPage.evaluate(() => {
    scrollTo(0, 0);
    history.pushState({}, '', '/new-view');
    document.querySelector('#fixed-link').setAttribute('aria-current', 'page');
    document.querySelector('main').innerHTML = '<h1 id="fresh">Fresh content on the next page</h1>';
  });
  await navPage.waitForFunction(() => document.querySelector('#fresh').hasAttribute('data-swr-page-state'));
  for (const selector of ['#sticky', '#fixed', '#regular']) {
    assert.equal(await navPage.locator(selector).getAttribute('data-swr-page-state'), null, selector);
    assert.equal(await navPage.locator(`${selector} [data-swr-page-state]`).count(), 0, selector);
  }
  await navPage.goto(`${third}/new-document`);
  assert.equal(await navPage.locator('#fixed').getAttribute('data-swr-page-state'), null);
  assert.equal(await navPage.locator('#regular [data-swr-page-state]').count(), 0);
  assert.equal(await navPage.locator('main h1').getAttribute('data-swr-page-state'), 'hidden');
  await navPage.reload();
  assert.equal(await navPage.locator('#sticky [data-swr-page-state]').count(), 0);
  await navPage.evaluate(() => {
    history.pushState({}, '', '/changed-menu');
    document.querySelector('#fixed-link').textContent = 'Algorithms';
  });
  await navPage.waitForFunction(() => document.querySelector('#fixed').getAttribute('data-swr-page-state') === 'surface');
  assert.equal(await navPage.locator('#fixed-link').getAttribute('data-swr-page-state'), 'hidden');
  assert.equal(await navPage.locator('#regular').getAttribute('data-swr-page-state'), null);

  const workloadPage = await context.newPage();
  await workloadPage.goto(fourth);
  const workloadDevtools = await context.newCDPSession(workloadPage);
  await waitForCrew(workloadDevtools, 2);
  await workloadPage.evaluate(() => document.querySelector('#dense').scrollIntoView());
  await waitForCrew(workloadDevtools, 12, 7);
  await workloadPage.evaluate(() => document.querySelector('#sparse-end').scrollIntoView());
  await waitForCrew(workloadDevtools, 2);

  await workloadPage.setViewportSize({ width: 680, height: 768 });
  await workloadPage.reload();
  await workloadPage.evaluate(() => document.querySelector('#dense').scrollIntoView());
  await waitForCrew(workloadDevtools, 6);

  await page.bringToFront();
  await page.goto(first);
  await page.waitForFunction(() => document.querySelector('#title').hasAttribute('data-swr-page-state'));
  popup = await context.newPage();
  await popup.goto(popupUrl);
  // Required access in this test profile cannot be revoked through chrome.permissions.
  await popup.evaluate(() => {
    chrome.permissions.remove = async request => {
      window.removedOrigins = request.origins;
      return false;
    };
  });
  await popup.getByRole('checkbox', { name: 'Auto-play on websites' }).uncheck();
  await popup.getByText('Play once or turn on automatic replay.').waitFor();
  assert.deepEqual(await popup.evaluate(() => window.removedOrigins), origins);
  await page.waitForFunction(() => !document.querySelector('[data-swr-page-state]'));
  await page.reload();
  assert.equal(await page.locator('[data-swr-page-state]').count(), 0);

  // The popup is open as a test tab, so use the fixture tab as its active target.
  await popup.evaluate(url => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async () => (await query({})).filter(tab => tab.url === url);
  }, page.url());
  await popup.getByRole('button', { name: 'Play this page' }).click();
  await page.waitForFunction(() => document.querySelector('#title').hasAttribute('data-swr-page-state'));
  await page.bringToFront();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-swr-page-state]').count(), 0);
});
