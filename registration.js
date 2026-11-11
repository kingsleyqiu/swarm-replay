'use strict';

const origins = ['http://*/*', 'https://*/*'];
const scripts = ['replay-ui.js', 'replay.js', 'content.js'];
const scriptId = 'swarm-replay-autoplay';

function registeredAutoplay() {
  return chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
}

async function setAutoplayRegistration(enabled) {
  const registered = await registeredAutoplay();
  if (enabled && !registered.length) {
    await chrome.scripting.registerContentScripts([{
      id: scriptId,
      matches: origins,
      css: ['page.css'],
      js: [...scripts, 'autoplay.js'],
      runAt: 'document_start',
      persistAcrossSessions: true
    }]);
  } else if (!enabled && registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
  }
}
