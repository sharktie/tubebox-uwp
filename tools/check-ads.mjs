#!/usr/bin/env node
// Checks that ad blocking still works against the live YouTube TV app, without a console: starts
// Microsoft Edge headless with TubeBox's TV user agent and the same page script the app builds
// (TubeBox/Inject + filters.json), opens a few videos on a fresh profile, and reports what the
// filters removed and whether any ad played anyway.
//
//   node tools/check-ads.mjs                     the default videos, ad blocking on
//   node tools/check-ads.mjs --off               the same with ad blocking off (ads should show)
//   node tools/check-ads.mjs dQw4w9WgXcQ ...     particular videos
//
// Run it when ads start getting through on the console: if a video reports "AD PLAYED", YouTube has
// changed something, and the fix usually belongs in filters.json (bump its version so the app
// downloads it). Needs Node 22+ and Edge.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((path) => existsSync(path));
// Keep in step with TvUserAgent and ScriptParts in TubeBox/MainPage.xaml.cs.
const USER_AGENT =
  'Mozilla/5.0 (Linux armeabi-v7a; Android 9) Cobalt/23.lts.4.308317-gold (unlike Gecko) ' +
  'v8/8.8.278.17-jit gles Starboard/14, Google_ATV_sabrina_2020/RVC.200921.001 (Google, Chromecast) ' +
  'com.google.android.youtube.tv/2.12.08';
const PARTS = ['prelude.js', 'adblock.js', 'video.js', 'controller.js'];

const args = process.argv.slice(2);
const blockAds = !args.includes('--off');
const videos = args.filter((a) => !a.startsWith('--'));
if (!videos.length) videos.push('dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageScript() {
  const filters = JSON.parse(readFileSync(join(ROOT, 'TubeBox/Inject/filters.json'), 'utf8'));
  const config = {
    xbox: false, blockAds, codec: 'auto', maxHeight: 0,
    filters: { pruneKeys: filters.pruneKeys, pruneItems: filters.pruneItems },
  };
  const body = PARTS.map((p) => readFileSync(join(ROOT, 'TubeBox/Inject', p), 'utf8')).join('\n');
  return `(function (config) {\n'use strict';\nif (!/(^|\\.)youtube\\.com$/.test(location.hostname)) return;\n${body}\n})(${JSON.stringify(config)});`;
}

// Stands in for the app: collects the messages the scripts post, and watches the player for ads.
const probe = `
  window.chrome = window.chrome || {};
  window.__posted = [];
  window.chrome.webview = { postMessage: function (m) { window.__posted.push(m); }, addEventListener: function () {} };
  window.__ads = 0;
  setInterval(function () {
    var p = document.querySelector('.html5-video-player');
    if (p && p.classList.contains('ad-showing') && !window.__adNow) window.__ads++;
    window.__adNow = !!(p && p.classList.contains('ad-showing'));
  }, 200);`;

async function main() {
  if (!EDGE) throw new Error('Microsoft Edge was not found.');
  const profile = mkdtempSync(join(tmpdir(), 'tubebox-check-'));
  const port = 9222 + Math.floor(Math.random() * 500);
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
  try {
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      await sleep(200);
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    }
    if (!page) throw new Error('Edge did not start.');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    const blockedUrls = JSON.parse(readFileSync(join(ROOT, 'TubeBox/Inject/filters.json'), 'utf8')).blockUrls;
    const blocked = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      // The app refuses these addresses (RequestBlocker); do the same here.
      if (msg.method === 'Fetch.requestPaused') {
        blocked.push(msg.params.request.url);
        send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'BlockedByClient' });
      }
    });
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

    await send('Page.enable');
    await send('Emulation.setUserAgentOverride', { userAgent: USER_AGENT });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: probe });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript() });
    if (blockAds) await send('Fetch.enable', { patterns: blockedUrls.map((urlPattern) => ({ urlPattern })) });

    console.log(`Ad blocking ${blockAds ? 'on' : 'off'}, ${videos.length} video(s)`);
    let failed = false;
    for (const video of videos) {
      // A fresh page for each video: only changing the address's #fragment would keep the old one.
      await send('Page.navigate', { url: 'about:blank' });
      await sleep(500);
      await send('Page.navigate', { url: 'https://www.youtube.com/tv#/watch?v=' + video });
      await sleep(30000);
      const r = JSON.parse(await evaluate(`JSON.stringify({ ads: window.__ads,
        removed: window.__posted.filter(function (m) { return m.type === 'app.adblock'; }).reduce(function (n, m) { return n + m.removed; }, 0),
        time: (document.querySelector('video') || {}).currentTime || 0 })`));
      // Some videos are held back for the ad's length when the ad is blocked (YouTube's doing), so
      // a video still at the start isn't a failure on its own.
      const started = r.time > 1;
      console.log(`${video}: ${r.ads ? 'AD PLAYED' : 'no ads'}, ${r.removed} ad entries removed, video ${started ? 'playing' : 'not started yet'} (${r.time.toFixed(1)}s)`);
      if (blockAds && r.ads) failed = true;
    }
    if (blockAds) console.log(`${blocked.length} ad requests refused`);
    ws.close();
    process.exitCode = failed ? 1 : 0;
  } finally {
    edge.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
