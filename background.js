'use strict';
importScripts('registration.js');

async function restoreAutoplay() {
  const { autoplay } = await chrome.storage.local.get('autoplay');
  if (autoplay && await chrome.permissions.contains({ origins })) {
    await setAutoplayRegistration(true);
  }
}

function restore() {
  restoreAutoplay().catch(error => console.error('Could not restore auto-play.', error));
}

chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
