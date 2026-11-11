# Swarm Replay

Swarm Replay turns a webpage's entrance into a collaborative editing session. Colored cursors type headlines, drag frames around images, and draw panels and navigation bars. Each piece appears as its cursor works on it. Scroll normally to bring new work into view.

**Version 0.1.3** adds a team that grows or shrinks with the work in view and reuses site navigation that has already been replayed. The extension is built for Chromium browsers and can be loaded from source in Chrome, Edge, or Opera GX.

## Inspiration and credit

Swarm Replay draws heavily on **Sahir Veerancheri's work on saai.pro**. His portfolio's multi-cursor entrance inspired the central interaction here. A cursor moves to a particular element and visibly builds it, whether that means typing a line of text or dragging a frame before an image appears. Thank you, Sahir, for the original work that sparked this project. [Original site](https://saai.pro/) · [Sahir Veerancheri on GitHub](https://github.com/sahi-hub)

Swarm Replay applies that interaction to existing websites through an independently implemented browser extension.

## Install locally

1. Download or clone this project. If you downloaded a ZIP, extract it.
2. Open `chrome://extensions` in Chrome, `edge://extensions` in Edge, or `opera://extensions` in Opera GX. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the folder that contains `manifest.json`.
4. Open a regular website and choose **Swarm Replay** from the toolbar's Extensions menu. Select **Play this page** for one replay, or enable **Auto-play on websites**, grant access, and open or reload a page.

To update an unpacked install, copy the new files into the same folder, reload Swarm Replay from the browser's extensions page, then reload the webpage.

Select **Skip** or press **Escape** to restore the current page. The toolbar's auto-play switch controls future page loads. You can leave it off and use one-time playback. Automatic replay respects your system's reduced-motion setting.

## How it works

### Starting a replay

**Play this page** uses the Manifest V3 `activeTab` grant to inject the extension's JavaScript and CSS into the selected tab. **Auto-play on websites** requests optional HTTP and HTTPS host access and registers the scripts to run at `document_start`. The service worker restores the registration at browser startup when auto-play is enabled and access is available. During an automatic replay, temporary CSS holds back the first paint of the content being staged until the replay can start. [Chrome extension content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

### Finding layers and assigning cursors

A **layer** is a unit the extension can reveal, such as a paragraph, a linked thumbnail and its badge, an SVG icon, or the background and border of a panel. The engine walks the DOM in batches and measures candidate elements against the viewport and their clipping ancestors. It uses `IntersectionObserver` to revisit offscreen branches as they approach the viewport and `MutationObserver` to inspect parts of the DOM that a web app adds or updates.

The scheduler assigns a visible task to a nearby available cursor. A panel's background can be drawn before the cursors work on its contents. The team grows with the number of unfinished layers in view, from two to twelve on wide screens and up to six on narrow screens. When the workload drops, idle cursors step away. Work that leaves the viewport can pause while the team moves on to visible tasks.

### Rendering a task

- **Text.** The engine uses `Intl.Segmenter` where available to split text into grapheme clusters, then measures their positions with DOM `Range` rectangles. It reproduces the visible text in an overlay, clips the copy to expose each character, and moves the I-beam to the measured position. The site's original text nodes remain in place. If the source text changes mid-animation, the updated element takes over.
- **Images and panels.** The cursor draws a selection box from one corner to the other. When the frame reaches its target, the engine reveals the image, panel background, or grouped element. A video or canvas can enter as a single surface.
- **Overlay and idle motion.** A closed Shadow DOM holds the SVG cursors, selection boxes, text copies, and controls. CSS styles the overlay, `requestAnimationFrame` drives active work, and the Web Animations API runs the cursors' idle transform animations. The JavaScript loop sleeps between tasks.

### Reusing shared page regions

When a navigation bar, site header, or site footer finishes its replay, the engine remembers a short fingerprint of its text, links, and relevant labels. A matching region on a later route or reload in the same tab and origin stays visible and adds no tasks. A changed menu can replay on the next page.

## Technology and source layout

| Technology | Role | Source |
| --- | --- | --- |
| Manifest V3, Chrome Scripting API, and extension service worker | Tab access, script injection, and persistent auto-play registration | [manifest.json](manifest.json), [registration.js](registration.js), [background.js](background.js) |
| Vanilla JavaScript, DOM APIs, and viewport observers | Layer discovery, geometry, scheduling, and route changes | [replay.js](replay.js), [content.js](content.js) |
| Shadow DOM, SVG, CSS, and Web Animations | Cursor rendering, reveal effects, and isolated overlay styles | [replay-ui.js](replay-ui.js), [page.css](page.css) |
| Extension storage and browser session storage | Auto-play preference and up to 64 shared-region fingerprints per tab and origin | [popup.js](popup.js), [replay.js](replay.js) |
| Node.js test runner and Playwright | Browser regression and performance checks | [tests/replay.test.mjs](tests/replay.test.mjs) |

## Permissions and supported pages

The extension runs locally, using the page's existing content and layout. It makes no network requests of its own. One-time playback uses temporary access to the active tab. Automatic playback uses the optional site permissions you grant in the browser.

Common text, images, linked thumbnails, icons, panels, and ordinary, sticky, or fixed navigation bars can replay. Forms, editors, dialogs, live announcement regions, and iframe contents are outside the replay scope. Browser settings pages, extension stores, built-in viewers, and desktop apps are outside the extension's scope. A page built with custom rendering can expose fewer elements to the DOM scanner.

## Develop

The extension loads directly from source. The Playwright dependency is only for testing.

```sh
npm ci
npx playwright install chromium
npm test
```

The smoke test loads an unpacked copy in an isolated Chromium profile and serves local test pages. It checks cursor counts across sparse and dense views, concurrent work, navigation reuse after route changes and reloads, and replay after a menu changes. It also covers linked thumbnails, dropdowns, reduced motion, and cleanup. A fixture with 2,000 offscreen cards checks that unrelated mutations leave the replay loop idle. The test profile grants host access up front so it can exercise auto-play. [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
