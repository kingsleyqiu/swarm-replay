'use strict';

const autoplay = document.querySelector('#autoplay');
const play = document.querySelector('#play');
const status = document.querySelector('#status');

function showStatus(message) {
  status.textContent = message;
}

async function syncAutoplay() {
  const [scripts, allowed] = await Promise.all([
    registeredAutoplay(),
    chrome.permissions.contains({ origins })
  ]);
  autoplay.checked = scripts.length > 0 && allowed;
  showStatus(autoplay.checked ? 'Auto-play is on for new page loads.' : 'Play once or turn on automatic replay.');
}

autoplay.addEventListener('change', async () => {
  autoplay.disabled = true;
  try {
    const enabled = autoplay.checked;
    if (enabled && !await chrome.permissions.request({ origins })) {
      autoplay.checked = false;
      showStatus('Website access is required for automatic replay.');
      return;
    }
    await setAutoplayRegistration(enabled);
    await chrome.storage.local.set({ autoplay: enabled });
    if (!enabled) await chrome.permissions.remove({ origins });
    await syncAutoplay();
  } catch (error) {
    await syncAutoplay().catch(() => {});
    showStatus(error.message);
  } finally {
    autoplay.disabled = false;
  }
});

play.addEventListener('click', async () => {
  play.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url ?? '')) {
      showStatus('Open a regular website to play.');
      return;
    }
    const target = { tabId: tab.id };
    await chrome.scripting.insertCSS({ target, files: ['page.css'] });
    await chrome.scripting.executeScript({ target, files: scripts });
    await chrome.scripting.executeScript({
      target,
      func: () => globalThis.SwarmReplayExtension.play()
    });
    window.close();
  } catch {
    showStatus('This page is restricted or still loading.');
  } finally {
    play.disabled = false;
  }
});

syncAutoplay().catch(() => showStatus('Settings are unavailable.')).finally(() => {
  autoplay.disabled = false;
});
