(function (global) {
  'use strict';
  if (global.SwarmReplay) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const textSelector = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,figcaption,summary,address,small,td,th,label,time,[role="heading"]';
  const mediaSelector = 'picture,img,svg,video,canvas,[role="img"]';
  const controlSelector = 'a[href],button,[role="button"]';
  const navSelector = 'nav,[role="navigation"]';
  const menuSelector = '[role="menu"],[role="listbox"],[popover]';
  const siteRegionSelector = 'header,footer,[role="banner"],[role="contentinfo"]';
  const sharedStorageKey = 'swarm-replay:shared-regions:v1';
  const ignoreSelector = '[data-swarm-ignore],form,input,select,textarea,iframe,pre,code,script,style,template,link,meta,[inert],[aria-live],[role="dialog"],[role="alert"],[contenteditable]:not([contenteditable="false"])';
  const sharedIgnoreSelector = `${ignoreSelector},${menuSelector},[hidden]`;
  const borderSides = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
  const noPaint = color => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  let mounted;

  function readSharedRegions() {
    try {
      const keys = JSON.parse(sessionStorage.getItem(sharedStorageKey) || '[]');
      return new Set(keys.filter(key => typeof key === 'string' && /^[a-f0-9]{8}$/.test(key)).slice(-64));
    } catch {
      return new Set();
    }
  }

  function regionKey(element, nativeMenus) {
    const tokens = [element.localName, element.getAttribute('role'), element.getAttribute('aria-label')];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeType === Node.ELEMENT_NODE && (nativeMenus.has(node)
          || node.matches(sharedIgnoreSelector)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let visited = 0; walker.nextNode(); visited++) {
      if (visited >= 2000) return null;
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        const label = node.data.trim().replace(/\s+/g, ' ');
        if (label) tokens.push(label);
      } else if (node.matches('a[href],img,button,[aria-label]')) {
        tokens.push([node.localName, node.getAttribute('href'), node.getAttribute('src'),
          node.getAttribute('alt'), node.getAttribute('aria-label')]);
      }
    }
    if (tokens.length === 3) return null;
    const signature = JSON.stringify(tokens);
    let hash = 2166136261;
    for (let index = 0; index < signature.length; index++) {
      hash = Math.imul(hash ^ signature.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function navigationLayout(element, rect, cache) {
    if (cache.has(element)) return cache.get(element);
    const { top, right, bottom, left, width, height } = rect ?? element.getBoundingClientRect();
    const horizontal = width >= innerWidth * .55 && height <= Math.min(220, innerHeight * .35)
      && (top <= 160 || bottom >= innerHeight - 80);
    const vertical = width <= Math.min(320, innerWidth * .45) && height >= innerHeight * .45
      && (left <= 24 || right >= innerWidth - 24);
    const isNavigation = Boolean(element.matches(navSelector) || ((horizontal || vertical) && (
      element.querySelector(navSelector)
      || (element.matches('header,[role="banner"]') && element.querySelector(controlSelector))
      || element.querySelectorAll('a[href]').length >= 3
    )));
    cache.set(element, isNavigation);
    return isNavigation;
  }

  function clippingAncestors(element, cache, navigation) {
    if (!element || element === document.body || element === document.documentElement) return [];
    if (cache.has(element)) return cache.get(element);
    const style = getComputedStyle(element);
    const pinned = style.position === 'fixed' || style.position === 'sticky';
    const allowed = !pinned || navigationLayout(element, null, navigation);
    const parents = allowed && style.position === 'fixed' ? [] : clippingAncestors(element.parentElement, cache, navigation);
    const clipX = !['visible', 'unset'].includes(style.overflowX);
    const clipY = !['visible', 'unset'].includes(style.overflowY);
    const clips = parents === null || !allowed || (style.opacity === '0' && !element.hasAttribute('data-swr-page-state')) ? null
      : clipX || clipY ? [...parents, { element, clipX, clipY }] : parents;
    cache.set(element, clips);
    return clips;
  }

  function visibleBounds(rect, clips, margin = 0) {
    let left = Math.max(-margin, rect.left);
    let top = Math.max(-margin, rect.top);
    let right = Math.min(innerWidth + margin, rect.right);
    let bottom = Math.min(innerHeight + margin, rect.bottom);
    for (const { element, clipX, clipY } of clips) {
      const box = element.getBoundingClientRect();
      if (clipX) {
        left = Math.max(left, box.left + element.clientLeft);
        right = Math.min(right, box.left + element.clientLeft + element.clientWidth);
      }
      if (clipY) {
        top = Math.max(top, box.top + element.clientTop);
        bottom = Math.min(bottom, box.top + element.clientTop + element.clientHeight);
      }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function hasPaint(style) {
    return style.backgroundImage !== 'none' || !noPaint(style.backgroundColor)
      || borderSides.some(side => parseFloat(style[side]) > 0) || style.boxShadow !== 'none';
  }

  function classify(element, style, rect) {
    if (element.matches(mediaSelector)) return 'media';
    const control = element.matches(controlSelector);
    const media = control && element.querySelector('picture,img,video,canvas,[role="img"]');
    if (media) {
      const image = media.getBoundingClientRect();
      if (!element.querySelector(textSelector) && (element.getAttribute('aria-hidden') === 'true'
        || (image.width >= rect.width * .8 && image.height >= rect.height * .75))) return 'media';
      return null;
    }
    const ownText = Array.prototype.some.call(element.childNodes, node => node.nodeType === 3 && node.data.trim());
    const formatted = element.matches(textSelector) || (ownText && !element.querySelector(textSelector));
    if (formatted && element.textContent.trim() && !element.querySelector(ignoreSelector)) {
      if (element.querySelector(mediaSelector)) return ownText ? 'reveal' : hasPaint(style) ? 'surface' : null;
      if (element.textContent.length <= 240 && style.direction === 'ltr' && style.writingMode === 'horizontal-tb'
        && !style.backgroundClip.includes('text') && style.transform === 'none'
        && !element.querySelector(controlSelector)) return 'type';
      return 'reveal';
    }
    if (control) return element.querySelector(ignoreSelector) ? null : 'reveal';
    if (style.backgroundImage.includes('url(') && !element.children.length) return 'media';
    if (hasPaint(style)) return 'surface';
    if (element.children.length || rect.width * rect.height >= 64) {
      for (const pseudo of ['::before', '::after']) {
        const paint = getComputedStyle(element, pseudo);
        if (!['normal', 'none'].includes(paint.content) && (hasPaint(paint) || paint.content !== '""')) return 'surface';
      }
    }
    return null;
  }

  function collect(queue, root, byElement, nativeMenus, shared, defer, visit) {
    const cache = new WeakMap();
    const navigation = new WeakMap();
    const layers = [];
    const discovered = new Set();
    const deadline = performance.now() + 12;
    for (let count = 0; queue.length && count < 500 && (count < 40 || performance.now() < deadline); count++) {
      const element = queue.pop();
      visit(element);
      if (discovered.has(element) || !root.contains(element) || element.closest(ignoreSelector)) continue;
      discovered.add(element);
      const previous = byElement.get(element);
      if (previous && previous.kind !== 'surface') continue;
      if (nativeMenus.has(element) || shared.reused.has(element)) continue;
      let parentTask;
      let insideNav = false;
      let covered = false;
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (nativeMenus.has(parent) || shared.reused.has(parent)) {
          covered = true;
          break;
        }
        const above = byElement.get(parent);
        if (!above) continue;
        insideNav ||= above.navigation;
        if (above.kind !== 'surface' && (above.state !== 'done' || above.kind === 'media')) {
          covered = true;
          break;
        }
        if (above.kind === 'surface') parentTask ??= above;
      }
      if (covered) continue;
      const collapsed = element.parentElement?.closest('details:not([open])');
      if (collapsed && !collapsed.querySelector(':scope > summary')?.contains(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width >= 1 && rect.height >= 1 && (rect.bottom < -110 || rect.top > innerHeight + 110
        || rect.right <= 0 || rect.left >= innerWidth)) {
        defer(element, true);
        continue;
      }
      const style = getComputedStyle(element);
      const hidden = element.hasAttribute('hidden');
      const absoluteBar = insideNav && style.position === 'absolute' && rect.height <= 80
        && !element.matches(menuSelector) && navigationLayout(element, rect, navigation);
      if (insideNav || (element.matches(menuSelector) && element.closest(navSelector))) {
        const popup = element.matches('[role="listbox"],[popover]');
        const floating = style.position === 'absolute' && !absoluteBar;
        const closed = hidden || style.display === 'none' || style.visibility !== 'visible';
        if (popup || ((floating || closed) && (element.matches(menuSelector) || element.querySelector(controlSelector)))) {
          nativeMenus.add(element);
          continue;
        }
      }
      if (hidden) continue;
      const pinned = style.position === 'fixed' || style.position === 'sticky';
      if (pinned && !navigationLayout(element, rect, navigation)) continue;
      const clips = style.position === 'fixed' ? [] : clippingAncestors(element.parentElement, cache, navigation);
      if (!clips) continue;
      const area = visibleBounds(rect, clips, 110);
      if (style.display !== 'contents' && (area.width < 1 || area.height < 1)) {
        defer(element, rect.width >= 1 && rect.height >= 1);
        continue;
      }
      const nav = pinned || absoluteBar || element.matches(navSelector);
      const sharedRegion = nav || (element.matches(siteRegionSelector) && !element.closest('main,article,section,aside'));
      const kind = !previous && element !== root && style.visibility === 'visible'
        && style.opacity !== '0' && rect.width >= 1 && rect.height >= 1 ? (sharedRegion ? 'surface' : classify(element, style, rect)) : null;
      if (kind) {
        const key = sharedRegion ? regionKey(element, nativeMenus) : null;
        if (key && shared.keys.has(key)) {
          shared.reused.add(element);
          continue;
        }
        const layer = { element, kind, clips, parent: parentTask, navigation: nav, state: 'pending', wipe: style.clipPath === 'none' };
        byElement.set(element, layer);
        if (key) shared.pending.set(element, { key, layer });
        layers.push(layer);
      }
      if (kind && kind !== 'surface' || element.localName === 'svg') continue;
      for (let child = element.lastElementChild; child; child = child.previousElementSibling) queue.push(child);
    }
    return layers;
  }

  function control(parent, tag, label, name) {
    const node = document.createElement(tag);
    if (tag === 'button') node.type = 'button';
    if (name) node.dataset.swrControl = name;
    node.textContent = label;
    parent.append(node);
    return node;
  }

  function mount() {
    if (mounted) return mounted;
    const pageRoot = () => document.body;
    const events = new AbortController();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
    const shadow = host.attachShadow({ mode: 'closed' });
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(global.SwarmReplayStyles);
    shadow.adoptedStyleSheets = [stylesheet];
    const overlay = control(shadow, 'div', '');
    overlay.className = 'swr-overlay';
    overlay.hidden = true;
    document.documentElement.append(host);

    const fx = control(overlay, 'div', '');
    fx.className = 'swr-fx';
    fx.setAttribute('aria-hidden', 'true');
    const hud = control(overlay, 'div', '');
    hud.className = 'swr-hud';
    hud.setAttribute('role', 'group');
    hud.setAttribute('aria-label', 'Swarm replay');
    const badges = control(hud, 'span', '');
    badges.className = 'swr-crew';
    badges.setAttribute('aria-hidden', 'true');
    const agentLabel = control(hud, 'span', '');
    control(agentLabel, 'b', '0', 'agents');
    agentLabel.append(' agents');
    const layerLabel = control(hud, 'span', '');
    control(layerLabel, 'b', '0', 'done');
    layerLabel.append(' / ');
    control(layerLabel, 'span', '0', 'total');
    layerLabel.append(' layers');
    control(hud, 'progress', '', 'progress').setAttribute('aria-label', 'Layers built');
    control(hud, 'button', '1×', 'speed').setAttribute('aria-label', 'Change playback speed');
    control(hud, 'button', 'Replay', 'replay');
    control(hud, 'button', 'Skip', 'stop');

    const speedButton = overlay.querySelector('[data-swr-control="speed"]');
    const progress = overlay.querySelector('[data-swr-control="progress"]');
    const agentCount = overlay.querySelector('[data-swr-control="agents"]');
    const layerCount = overlay.querySelector('[data-swr-control="done"]');
    const colors = [
      '#39c5f2', '#ab79ff', '#4adba4', '#ff936a', '#ff7bb6', '#ffd468',
      '#639aff', '#d7ef63', '#f180fa', '#74e5de', '#f77076', '#dcbaff'
    ];
    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const lerp = (a, b, p) => a + (b - a) * p;
    const smooth = p => p * p * (3 - 2 * p);
    const agents = [];
    function createAgent(color) {
      const cursor = document.createElement('div');
      cursor.className = 'swr-cursor';
      cursor.style.setProperty('--ink-agent', color);
      const svg = document.createElementNS(SVG, 'svg');
      for (const [name, value] of Object.entries({ width: 22, height: 22, viewBox: '0 0 22 22' })) {
        svg.setAttribute(name, value);
      }
      for (const [shape, d] of [
        ['pointer', 'M1 1 17 7 9.5 10 6 17Z'],
        ['type', 'M-4 -7H4 M0 -7V7 M-4 7H4'],
        ['draw', 'M-7 0H7 M0 -7V7']
      ]) {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('data-shape', shape);
        path.setAttribute('d', d);
        svg.append(path);
      }
      cursor.append(svg);
      const box = document.createElement('div');
      box.className = 'swr-box';
      for (let i = 0; i < 4; i++) box.append(document.createElement('i'));
      box.append(document.createElement('b'));
      const guide = document.createElement('div');
      guide.className = 'swr-guide';
      cursor.hidden = box.hidden = guide.hidden = true;
      fx.append(guide, box, cursor);
      const dot = document.createElement('i');
      dot.style.background = color;
      dot.hidden = true;
      badges.append(dot);
      return { cursor, box, guide, dot, size: box.lastElementChild, task: null, position: null, idle: null };
    }

    const totalLabel = overlay.querySelector('[data-swr-control="total"]');
    const observer = new MutationObserver(onMutations);
    const intersections = new IntersectionObserver(entries => {
      for (const { target, intersectionRect } of entries) {
        if (!deferred.has(target) || intersectionRect.width < 1 || intersectionRect.height < 1) continue;
        intersections.unobserve(target);
        deferred.delete(target);
        offscreen.delete(target);
        enqueue(target);
      }
      if (queue.length) wake();
    }, { rootMargin: '110px 0px' });
    const route = () => location.pathname + location.search;
    let running = false;
    let speed = 1;
    let frameId = 0;
    let lastFrame = 0;
    let clock = 0;
    let nextAssignment = 0;
    let completed = 0;
    let total = 0;
    let tasks = [];
    let crew = [];
    let crewTarget = 2;
    let crewDirty = false;
    let nextCrewCheck = 0;
    let crewTimer = 0;
    let root;
    let page;
    let byElement;
    const nativeMenus = new WeakSet();
    const shared = { keys: readSharedRegions(), reused: new WeakSet(), pending: new Map() };
    const queue = [];
    const queued = new Set();
    const deferred = new Set();
    let offscreen = new WeakSet();
    let immediateScan = false;
    let mediaTimer = 0;

    function hideAgent(agent) {
      agent.idle?.cancel();
      agent.idle = null;
      agent.cursor.hidden = agent.box.hidden = agent.guide.hidden = agent.dot.hidden = true;
    }

    function resetLayer(task) {
      task.element.removeAttribute('data-swr-page-state');
      task.copy?.remove();
      task.copy = task.keystrokes = null;
      restoreStyle(task);
    }

    function restoreStyle(task) {
      if (!task.changedStyle) return;
      const { element, changedStyle, oldValue, oldPriority } = task;
      if (element.style.getPropertyValue(changedStyle) === task.writtenStyle
        && !element.style.getPropertyPriority(changedStyle)) {
        if (oldValue) element.style.setProperty(changedStyle, oldValue, oldPriority);
        else element.style.removeProperty(changedStyle);
      }
      task.changedStyle = null;
    }

    function setStyle(task, property, value) {
      if (!task.changedStyle) {
        task.changedStyle = property;
        task.oldValue = task.element.style.getPropertyValue(property);
        task.oldPriority = task.element.style.getPropertyPriority(property);
      } else if (task.element.style.getPropertyValue(property) !== task.writtenStyle
        || task.element.style.getPropertyPriority(property)) {
        task.changedStyle = null;
        task.wipe = false;
        return;
      }
      task.element.style.setProperty(property, value);
      task.writtenStyle = task.element.style.getPropertyValue(property);
    }

    function reset() {
      tasks.forEach(resetLayer);
      tasks = [];
      byElement = new WeakMap();
      shared.reused = new WeakSet();
      shared.pending.clear();
      intersections.disconnect();
      deferred.clear();
      offscreen = new WeakSet();
      queue.length = 0;
      queued.clear();
      clearTimeout(mediaTimer);
      mediaTimer = 0;
      clearTimeout(crewTimer);
      crewTimer = 0;
      crewTarget = 2;
      crewDirty = false;
      nextCrewCheck = 0;
      immediateScan = false;
      root = pageRoot();
      page = route();
      agents.forEach(agent => {
        agent.task = null;
        hideAgent(agent);
      });
      overlay.hidden = true;
      crew = [];
      agentCount.textContent = 0;
      completed = total = clock = lastFrame = nextAssignment = 0;
    }

    function enqueue(element) {
      if (!element?.matches || !root?.contains(element) || queued.has(element) || element.closest(ignoreSelector)
        || (element.ownerSVGElement && element.localName !== 'svg')) return;
      for (let ancestor = element; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        if (offscreen.has(ancestor) || nativeMenus.has(ancestor) || shared.reused.has(ancestor)) return;
        const task = byElement.get(ancestor);
        if (task && task.kind !== 'surface' && (ancestor === element || task.state !== 'done' || task.kind === 'media')) return;
      }
      queued.add(element);
      queue.push(element);
    }

    function defer(element, away = false) {
      if (away) offscreen.add(element);
      if (deferred.has(element)) return;
      deferred.add(element);
      intersections.observe(element);
    }

    function scan() {
      if (!root || !queue.length) return;
      const added = collect(queue, root, byElement, nativeMenus, shared, defer, element => queued.delete(element));
      if (!added.length) return;
      tasks.push(...added);
      for (const task of added) {
        task.element.setAttribute('data-swr-page-state', task.kind === 'surface' ? 'surface' : 'hidden');
      }
      total += added.length;
      progress.max = total;
      totalLabel.textContent = total;
      layerCount.textContent = progress.value = completed;
      overlay.hidden = false;
      crewDirty = true;
    }

    function wake() {
      if (running && !frameId && !document.hidden) frameId = requestAnimationFrame(frame);
    }

    function viewportChanged() {
      crewDirty = true;
      wake();
    }

    function updateRoute() {
      if (running && (page !== route() || root !== pageRoot())) start(true);
    }

    function onMutations(records) {
      if (!running) return;
      updateRoute();
      let prepaint = false;
      let removed = false;
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) enqueue(node);
            if (node.nodeType === Node.TEXT_NODE) enqueue(record.target);
          }
          for (const node of record.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.isConnected) continue;
            removed = true;
            const detached = [node];
            while (detached.length && deferred.size) {
              const element = detached.pop();
              if (deferred.delete(element)) intersections.unobserve(element);
              offscreen.delete(element);
              detached.push(...element.children);
            }
          }
          prepaint ||= record.addedNodes.length > 0;
        } else {
          const element = record.type === 'attributes' ? record.target : record.target.parentElement;
          if (!byElement.has(element)) {
            enqueue(element);
            prepaint = true;
          }
        }
      }
      if (prepaint && queue.length && !immediateScan && !document.hidden) {
        immediateScan = true;
        try {
          scan();
        } catch (error) {
          close();
          throw error;
        }
      }
      if (queue.length || (removed && tasks.length) || (prepaint && immediateScan)) wake();
    }

    function start(waitForRoute = false) {
      reset();
      running = true;
      observer.observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'hidden', 'open', 'src', 'srcset', 'aria-hidden', 'aria-expanded']
      });
      try {
        enqueue(root);
        if (!waitForRoute) scan();
      } catch (error) {
        close();
        throw error;
      }
      wake();
    }

    function close() {
      running = false;
      cancelAnimationFrame(frameId);
      frameId = 0;
      observer.disconnect();
      reset();
    }

    function visible(area, rect) {
      return area.width >= Math.min(rect.width * .35, 36) && area.height >= Math.min(rect.height * .5, 48)
        && area.width > 0 && area.height > 0;
    }

    function measureCrew(now) {
      if (!crewDirty) return;
      if (tasks.length > 6 && now < nextCrewCheck) {
        if (!crewTimer) crewTimer = setTimeout(() => {
          crewTimer = 0;
          wake();
        }, nextCrewCheck - now);
        return;
      }
      clearTimeout(crewTimer);
      crewTimer = 0;
      crewDirty = false;
      nextCrewCheck = now + 150;
      const limit = innerWidth < 720 ? 6 : colors.length;
      let visibleLayers = 0;
      if (tasks.length > 6) for (const task of tasks) {
        if (task.state === 'done' || !task.element.isConnected) continue;
        const rect = task.element.getBoundingClientRect();
        if (visible(visibleBounds(rect, task.clips), rect)) visibleLayers++;
        if (visibleLayers >= limit * 3) break;
      }
      crewTarget = clamp(Math.ceil(visibleLayers / 3), 2, limit);
    }

    function resizeCrew() {
      if (crew.length === crewTarget) return;
      const previousCount = crew.length;
      for (let index = crew.length - 1; index >= 0 && crew.length > crewTarget; index--) {
        if (crew[index].task) continue;
        hideAgent(crew[index]);
        crew.splice(index, 1);
      }
      while (crew.length < crewTarget) {
        let agent = agents.find(item => item.cursor.hidden);
        if (!agent) {
          agent = createAgent(colors[agents.length]);
          agents.push(agent);
        }
        const index = crew.length;
        const columns = innerWidth < 720 ? 3 : 4;
        const x = innerWidth * (.15 + .7 * (index % columns) / (columns - 1));
        const y = innerHeight * (.25 + .23 * Math.floor(index / columns));
        crew.push(agent);
        cursorAt(agent, x, y, 'pointer');
      }
      if (crew.length !== previousCount) agentCount.textContent = crew.length;
    }

    function rememberSharedRegions() {
      if (!shared.pending.size || queue.length) return;
      let changed = false;
      for (const [element, { key, layer }] of shared.pending) {
        if (layer.state !== 'done' && element.isConnected) continue;
        if (layer.revealed && element.isConnected) {
          if (tasks.some(task => element.contains(task.element))) continue;
          shared.keys.add(key);
          changed = true;
        }
        shared.pending.delete(element);
      }
      if (!changed) return;
      while (shared.keys.size > 64) shared.keys.delete(shared.keys.values().next().value);
      try {
        sessionStorage.setItem(sharedStorageKey, JSON.stringify([...shared.keys]));
      } catch {
        // In-memory reuse still works across same-document navigation.
      }
    }

    function inView(x, y) {
      return [clamp(x, 2, innerWidth - 3), clamp(y, 2, innerHeight - 3)];
    }

    function snapPixel(value) {
      return Math.round(value * devicePixelRatio) / devicePixelRatio;
    }

    function cursorAt(agent, x, y, tool, pressed = false) {
      const [screenX, screenY] = inView(x, y);
      agent.position = [screenX, screenY];
      agent.cursor.hidden = agent.dot.hidden = false;
      const atEdge = x !== screenX || y !== screenY;
      agent.cursor.dataset.tool = atEdge ? 'pointer' : tool;
      agent.cursor.classList.toggle('pressed', pressed && !atEdge);
      agent.cursor.classList.toggle('idle', !agent.task);
      agent.cursor.style.transform = `translate3d(${snapPixel(screenX)}px,${snapPixel(screenY)}px,0)`;
    }

    function wander(agent) {
      if (agent.idle) return;
      const [x, y] = agent.position;
      const angle = Math.random() * Math.PI * 2;
      const keyframes = [[x, y]];
      for (let i = 0; i < 3; i++) {
        const direction = angle + i * Math.PI * 2 / 3;
        keyframes.push(inView(x + Math.cos(direction) * 65, y + Math.sin(direction) * 40));
      }
      keyframes.push([x, y]);
      cursorAt(agent, x, y, 'pointer');
      agent.idle = agent.cursor.animate(keyframes.map(([left, top]) => ({
        transform: `translate3d(${snapPixel(left)}px,${snapPixel(top)}px,0)`, easing: 'ease-in-out'
      })), { duration: 6800 + Math.random() * 2200, iterations: Infinity });
    }

    function stopWandering(agent) {
      if (!agent.idle) return;
      const { left, top } = agent.cursor.getBoundingClientRect();
      agent.idle.cancel();
      agent.idle = null;
      cursorAt(agent, left, top, 'pointer');
    }

    function frameBox(agent, x, y, width, height, mode) {
      const left = snapPixel(x);
      const top = snapPixel(y);
      agent.box.hidden = false;
      agent.box.dataset.mode = mode;
      agent.box.style.transform = `translate3d(${left}px,${top}px,0)`;
      agent.box.style.width = `${Math.max(1 / devicePixelRatio, snapPixel(x + width) - left)}px`;
      agent.box.style.height = `${Math.max(1 / devicePixelRatio, snapPixel(y + height) - top)}px`;
      const label = `${Math.round(width)} × ${Math.round(height)}`;
      if (agent.size.textContent !== label) agent.size.textContent = label;
    }

    function prepareText(task, rect) {
      const copy = document.createElement('div');
      copy.className = 'swr-copy';
      copy.hidden = true;
      const source = task.element.textContent;
      const walker = document.createTreeWalker(task.element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const keys = [];
      const properties = [
        'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch',
        'font-kerning', 'font-variant', 'font-feature-settings', 'font-variation-settings',
        'letter-spacing', 'word-spacing', 'text-transform', 'text-shadow', 'text-decoration',
        '-webkit-text-fill-color', '-webkit-text-stroke-width', '-webkit-text-stroke-color'
      ];
      let elapsed = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const style = getComputedStyle(node.parentElement);
        if (style.visibility !== 'visible' || style.display === 'none') continue;
        const graphemes = segmenter ? Array.from(segmenter.segment(node.data), item => item.segment) : Array.from(node.data);
        let offset = 0;
        let line;
        for (const char of graphemes) {
          range.setStart(node, offset);
          offset += char.length;
          range.setEnd(node, offset);
          const glyph = range.getBoundingClientRect();
          if (glyph.width < .1 || glyph.height < 1) continue;
          if (!line || Math.abs(glyph.top - line.top) > .5 || glyph.left < line.left - .5) {
            const span = document.createElement('span');
            for (const property of properties) span.style.setProperty(property, style.getPropertyValue(property));
            Object.assign(span.style, {
              left: `${glyph.left - rect.left}px`,
              top: `${glyph.top - rect.top}px`,
              lineHeight: `${glyph.height}px`,
              clipPath: 'inset(50%)'
            });
            copy.append(span);
            line = { span, top: glyph.top, left: glyph.left };
          }
          line.span.append(char);
          elapsed += (source.length < 26 ? 45 : 17) + (keys.length * 17 % 19) + (/[.,—。！？]/.test(char) ? 72 : 0);
          keys.push({
            elapsed, span: line.span, width: glyph.right - line.left,
            x: glyph.right - rect.left, y: glyph.top - rect.top + glyph.height / 2
          });
        }
      }
      if (!keys.length) return false;
      fx.prepend(copy);
      task.copy = copy;
      task.source = source;
      task.textWidth = rect.width;
      task.textHeight = rect.height;
      const textRight = Math.max(...keys.map(key => key.x));
      const singleLine = keys.every(key => Math.abs(key.y - keys[0].y) < 2);
      task.shift = (task.element.matches('h1,[data-swarm-move]') && singleLine && !task.clips.length
        && rect.left + textRight < innerWidth - 50) ? 28 : 0;
      task.keystrokes = keys;
      task.textEnd = elapsed;
      task.nextKey = 0;
      return true;
    }

    function workPoint(task, rect, area) {
      const [x, y] = task.anchor ?? [(task.shift ?? 0) + 2, 2];
      return inView(clamp(rect.left + x, area.left, area.right), clamp(rect.top + y, area.top, area.bottom));
    }

    function assign(agent, task, rect, area) {
      stopWandering(agent);
      if (task.state === 'pending') {
        task.age = 0;
        if (task.kind === 'type' && !prepareText(task, rect)) task.kind = 'reveal';
        task.drawTime = clamp(220 + Math.hypot(area.width, area.height) * .28, 300, 680);
      }
      task.state = 'active';
      const [x, y] = workPoint(task, rect, area);
      const [fromX, fromY] = agent.position;
      task.travel = {
        from: agent.position,
        elapsed: 0,
        duration: clamp(110 + Math.hypot(fromX - x, fromY - y) * .43, 145, 440)
      };
      agent.task = task;
    }

    function approach(agent, task, rect, area, delta) {
      const { from: [startX, startY], duration } = task.travel;
      task.travel.elapsed += delta;
      const t = smooth(clamp(task.travel.elapsed / duration));
      const [x, y] = workPoint(task, rect, area);
      const bend = Math.sin(t * Math.PI) * Math.min(34, Math.abs(startX - x) * .24);
      cursorAt(agent, lerp(startX, x, t), lerp(startY, y, t) - bend, 'pointer');
      if (t === 1) task.travel = null;
    }

    function finishTask(task) {
      resetLayer(task);
      task.state = 'done';
      layerCount.textContent = ++completed;
      progress.value = completed;
      crewDirty = true;
    }

    function finish(agent) {
      finishTask(agent.task);
      agent.task = null;
      agent.box.hidden = agent.guide.hidden = true;
      cursorAt(agent, ...agent.position, 'pointer');
    }

    function playText(agent, task, rect, area, elapsed) {
      const { copy, element, keystrokes, textEnd } = task;
      if (element.textContent !== task.source || Math.abs(task.textWidth - rect.width) > 1
        || Math.abs(task.textHeight - rect.height) > 1) {
        finish(agent);
        return;
      }
      copy.hidden = false;
      const sinceTyped = elapsed - textEnd - 90;
      const drag = task.shift && sinceTyped > 100;
      const dragProgress = drag ? smooth(clamp((sinceTyped - 215) / 315)) : 0;
      const offset = task.shift * (1 - dragProgress);
      copy.style.transform = `translate3d(${rect.left + offset}px, ${rect.top}px, 0)`;
      if (task.clips.length) {
        const clipped = visibleBounds(new DOMRect(0, 0, innerWidth, innerHeight), task.clips);
        copy.style.clipPath = `inset(${clipped.top - rect.top}px ${innerWidth + rect.left - clipped.right}px ${innerHeight + rect.top - clipped.bottom}px ${clipped.left - rect.left}px)`;
      }
      while (keystrokes[task.nextKey]?.elapsed <= elapsed - 90) {
        const { span, width } = keystrokes[task.nextKey++];
        span.style.clipPath = `inset(-4px calc(100% - ${width}px) -4px -4px)`;
      }
      const key = keystrokes[task.nextKey - 1];
      const x = key ? rect.left + key.x + offset : area.left + 2 + offset;
      const y = key ? rect.top + key.y : area.top + Math.min(area.height / 2, 18);
      frameBox(agent, area.left - 2 + offset, area.top - 1,
        Math.min(area.width + 4, innerWidth - area.left - offset), area.height + 2, drag ? 'move' : 'type');
      agent.guide.hidden = !drag;
      if (drag) {
        agent.guide.style.left = `${snapPixel(area.left)}px`;
        const seek = smooth(clamp((sinceTyped - 100) / 115));
        const grip = rect.left + offset + Math.min((key?.x ?? 0) * .48, 110);
        cursorAt(agent, lerp(x, grip, seek), y, 'pointer', seek === 1 && dragProgress < 1);
      } else {
        cursorAt(agent, x, y, 'type', elapsed < 100);
      }
      if (sinceTyped >= (task.shift ? 600 : 150)) finish(agent);
    }

    function playFrame(agent, task, rect, elapsed) {
      const { element, kind, drawTime } = task;
      const amount = smooth(clamp((elapsed - 65) / drawTime));
      const width = rect.width * amount;
      const height = rect.height * amount;
      agent.box.toggleAttribute('data-media', kind === 'media' && width > 44 && height > 44);
      frameBox(agent, rect.left, rect.top, width, height, amount < 1 ? 'draw' : 'placed');
      cursorAt(agent, rect.left + width, rect.top + height, amount < 1 ? 'draw' : 'pointer', elapsed < 120);
      if (amount < 1) return;
      element.removeAttribute('data-swr-page-state');
      const reveal = clamp((elapsed - 65 - drawTime) / 250);
      if (kind === 'media' && task.wipe) setStyle(task, 'clip-path', `inset(0 0 ${(1 - reveal) * 100}% 0)`);
      if (reveal === 1) {
        task.revealed = true;
        finish(agent);
      }
    }

    function frame(now) {
      frameId = 0;
      try {
        animate(now);
      } catch (error) {
        close();
        throw error;
      }
    }

    function animate(now) {
      if (!host.isConnected) {
        destroy();
        return;
      }
      updateRoute();
      if (!immediateScan) scan();
      immediateScan = false;
      if (overlay.hidden) {
        if (queue.length) wake();
        return;
      }
      const delta = lastFrame ? clamp(now - lastFrame, 0, 34) * speed : 0;
      lastFrame = now;
      clock += delta;
      const active = crew.filter(agent => agent.task).map(agent => {
        const { task } = agent;
        const rect = task.element.getBoundingClientRect();
        return { agent, task, rect, area: visibleBounds(rect, task.clips) };
      });
      for (const { agent, task, rect, area } of active) {
        if (!task.element.isConnected || !rect.width || !rect.height) {
          byElement.delete(task.element);
          finish(agent);
          continue;
        }
        if (!visible(area, rect)) {
          task.state = 'parked';
          crewDirty = true;
          agent.task = null;
          agent.box.hidden = agent.guide.hidden = true;
          if (task.copy) task.copy.hidden = true;
          continue;
        }
        if (task.travel) {
          approach(agent, task, rect, area, delta);
          continue;
        }
        task.age += delta;
        if (task.kind === 'type') playText(agent, task, rect, area, task.age);
        else playFrame(agent, task, area, task.age);
        if (agent.task) task.anchor = [agent.position[0] - rect.left, agent.position[1] - rect.top];
      }
      measureCrew(now);
      resizeCrew();
      const available = crew.filter(agent => !agent.task);
      if (available.length && clock >= nextAssignment) {
        for (const task of tasks) {
          if (task.state === 'active' || task.state === 'done' || (task.parent && task.parent.state !== 'done')) continue;
          if (!task.element.isConnected) {
            finishTask(task);
            continue;
          }
          const rect = task.element.getBoundingClientRect();
          if (rect.bottom < -innerHeight || rect.top > innerHeight * 2 || !rect.width || !rect.height) {
            finishTask(task);
            byElement.delete(task.element);
            defer(task.element, rect.width >= 1 && rect.height >= 1);
            continue;
          }
          const area = visibleBounds(rect, task.clips);
          if (!visible(area, rect)) continue;
          if (task.kind === 'media') {
            const image = task.element.matches('img') ? task.element : task.element.querySelector('img');
            if (image && !image.complete) {
              task.mediaDeadline ??= now + 1800;
              if (now < task.mediaDeadline) {
                if (!mediaTimer) mediaTimer = setTimeout(() => {
                  mediaTimer = 0;
                  wake();
                }, task.mediaDeadline - now);
                continue;
              }
            }
          }
          const [x, y] = workPoint(task, rect, area);
          const distance = agent => Math.hypot(agent.position[0] - x, agent.position[1] - y);
          const closest = available.reduce((best, agent) => distance(agent) < distance(best) ? agent : best);
          assign(closest, task, rect, area);
          nextAssignment = clock + 64;
          break;
        }
      }
      tasks = tasks.filter(task => task.state !== 'done');
      rememberSharedRegions();
      for (const agent of available) if (!agent.task) wander(agent);
      if (queue.length || crew.some(agent => agent.task) || (tasks.length && clock < nextAssignment)) wake();
      else lastFrame = 0;
    }

    const { signal } = events;
    document.addEventListener('scroll', viewportChanged, { capture: true, passive: true, signal });
    window.addEventListener('resize', viewportChanged, { passive: true, signal });
    window.addEventListener('popstate', updateRoute, { signal });
    window.navigation?.addEventListener('currententrychange', updateRoute, { signal });
    document.addEventListener('visibilitychange', wake, { signal });
    document.addEventListener('load', wake, { capture: true, signal });
    document.addEventListener('error', wake, { capture: true, signal });
    document.addEventListener('focusin', event => {
      if (event.target.closest('[data-swr-page-state="hidden"]')) close();
    }, { capture: true, signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && running) close();
    }, { signal });
    speedButton.addEventListener('click', () => {
      speed = speed === 1 ? 2 : 1;
      speedButton.textContent = `${speed}×`;
    }, { signal });
    overlay.querySelector('[data-swr-control="stop"]').addEventListener('click', close, { signal });
    overlay.querySelector('[data-swr-control="replay"]').addEventListener('click', () => start(), { signal });

    function destroy() {
      close();
      events.abort();
      host.remove();
      mounted = null;
    }

    mounted = {
      play: (waitForRoute = false) => !signal.aborted && start(waitForRoute),
      stop: () => { if (running) close(); },
      destroy,
      get running() { return running; }
    };
    return mounted;
  }

  global.SwarmReplay = { mount, hasSharedRegions: () => readSharedRegions().size > 0 };
})(globalThis);
