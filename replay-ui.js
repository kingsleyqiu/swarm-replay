'use strict';

globalThis.SwarmReplayStyles = `
.swr-overlay {
  all: initial;
  display: block;
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  direction: ltr;
  writing-mode: horizontal-tb;
  color-scheme: dark;
}
.swr-overlay *, .swr-overlay *::before, .swr-overlay *::after { box-sizing: border-box; }
.swr-fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 12;
}
.swr-overlay[hidden], .swr-overlay [hidden] { display: none !important; }
.swr-cursor {
  position: absolute;
  top: 0;
  left: 0;
  width: 22px;
  height: 22px;
  color: var(--ink-agent);
  filter: drop-shadow(0 1px 1px #000a);
  will-change: transform;
  transition: opacity .16s ease;
  z-index: 2;
}
.swr-cursor.idle { opacity: .66; }
.swr-cursor svg { display: block; overflow: visible; }
.swr-cursor [data-shape] { display: none; }
.swr-cursor[data-tool="pointer"] [data-shape="pointer"],
.swr-cursor[data-tool="type"] [data-shape="type"],
.swr-cursor[data-tool="draw"] [data-shape="draw"] { display: block; }
.swr-cursor.pressed::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  left: -9px;
  top: -9px;
  border: 1px solid currentColor;
  border-radius: 50%;
  opacity: .55;
}
.swr-box {
  --selection-edge: #35aaff;
  --selection-label: #0e6199;
  position: absolute;
  top: 0;
  left: 0;
  border: 1px solid var(--selection-edge);
  will-change: transform;
}
.swr-box[data-mode="draw"] { background: #889eb433; }
.swr-box[data-mode="draw"][data-media]::after {
  content: "";
  position: absolute;
  inset: 0;
  opacity: .65;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23c6d2df' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='16' rx='2'/%3E%3Ccircle cx='8' cy='9' r='1.5'/%3E%3Cpath d='m4 17 5-4 3 2 4-5 4 4'/%3E%3C/svg%3E") center / 22px no-repeat;
}
.swr-box[data-mode="move"] { --selection-edge: #f57668; --selection-label: #9b3e35; }
.swr-box i {
  position: absolute;
  width: 5px;
  height: 5px;
  background: #f0f8ff;
  border: 1px solid var(--selection-edge);
}
.swr-box i:nth-child(1) { top: -3px; left: -3px; }
.swr-box i:nth-child(2) { top: -3px; right: -3px; }
.swr-box i:nth-child(3) { bottom: -3px; left: -3px; }
.swr-box i:nth-child(4) { bottom: -3px; right: -3px; }
.swr-box b {
  position: absolute;
  top: calc(100% + 4px);
  inset-inline: 0;
  margin-inline: auto;
  width: max-content;
  padding: 2px 4px;
  background: var(--selection-label);
  color: white;
  font: 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.swr-guide {
  position: absolute;
  top: 0;
  height: 100%;
  border-left: 1px dashed #fa77668a;
}
.swr-hud {
  position: absolute;
  pointer-events: auto;
  z-index: 15;
  inset-inline: 0;
  margin-inline: auto;
  bottom: max(13px, env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 7px;
  width: max-content;
  max-width: calc(100% - 16px);
  padding: 6px 8px;
  border: 1px solid #ffffff25;
  border-radius: 12px;
  color: #e8e6e8;
  background: #212124f5;
  box-shadow: 0 5px 23px #0009;
  font: 11px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.swr-hud button {
  all: unset;
  box-sizing: border-box;
  border-radius: 6px;
  background: #38383e;
  color: white;
  padding: 6px 8px;
  cursor: pointer;
  white-space: nowrap;
  font: inherit;
}
.swr-hud [data-swr-control="stop"] { background: #13577e; }
.swr-hud span { white-space: nowrap; }
.swr-crew { display: flex; margin-right: 2px; }
.swr-crew i { width: 9px; height: 9px; border: 1px solid #212124; border-radius: 50%; }
.swr-hud progress { width: 54px; height: 4px; accent-color: #209ffe; }

.swr-cursor [data-shape="pointer"] { fill: currentColor; stroke: #fff; stroke-width: 1.35; stroke-linejoin: round; }
.swr-cursor [data-shape="type"], .swr-cursor [data-shape="draw"] {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
}
.swr-hud button:focus-visible { outline: 2px solid #8ad6ff; outline-offset: 2px; }
@media (max-width: 720px) {
  .swr-hud .swr-crew, .swr-hud progress { display: none; }
  .swr-hud { flex-wrap: wrap; justify-content: center; gap: 4px; padding: 5px; font-size: 10px; }
  .swr-hud button { padding-inline: 5px; }
}

.swr-copy { position: absolute; inset: 0; pointer-events: none; }
.swr-copy span { position: absolute; display: block; width: max-content; white-space: pre; margin: 0; padding: 0; }
`;
