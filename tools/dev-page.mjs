#!/usr/bin/env node
// Runs JavaScript in YouTube's page inside a Debug build of TubeBox running on this PC, and prints
// what it returns. Nothing outside a Windows app can connect to it, so this goes through files in
// the app's LocalState folder, which Debug builds watch (StartDevCommands in TubeBox/MainPage.xaml.cs).
//
//   node tools/dev-page.mjs "document.title"
//   node tools/dev-page.mjs --file script.js
//   node tools/dev-page.mjs --key down           a controller button (up/down/left/right, select, back,
//                                                x, y, lb, rb, lt, rt, menu), as ControllerBridge sends it
//   node tools/dev-page.mjs --log [lines]        the end of the app's log
//
// Deploy a Debug build to this PC first (Developer Mode on): devenv.com TubeBoxUWP.sln /deploy "Debug|x64",
// then start it from the Start menu or with: explorer.exe shell:AppsFolder\<package family>!App
//
// The script runs as with ExecuteScriptAsync: the value of its last expression comes back as
// JSON (a Promise comes back as {}, so store async results on window and read them after).

import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IDENTITY = 'f4420250-f8e7-4005-aefe-9e6025adf10b_';
const packages = join(process.env.LOCALAPPDATA || '', 'Packages');
const family = existsSync(packages) && readdirSync(packages).find((name) => name.startsWith(IDENTITY));
if (!family) {
  console.error('TubeBox is not installed on this PC (deploy a Debug build from Visual Studio first).');
  process.exit(1);
}
const folder = join(packages, family, 'LocalState');
const args = process.argv.slice(2);

if (args[0] === '--log') {
  const lines = Number(args[1]) || 40;
  const text = readFileSync(join(folder, 'tubebox.log'), 'utf8').trimEnd().split('\n');
  console.log(text.slice(-lines).join('\n'));
  process.exit(0);
}

let script;
if (args[0] === '--file') script = readFileSync(args[1], 'utf8');
else if (args[0] === '--key') script = '//controller ' + args[1];
else script = args.join(' ');
if (!script) {
  console.error('Nothing to run.');
  process.exit(1);
}

const command = join(folder, 'dev-command.js');
const result = join(folder, 'dev-result.json');
try { unlinkSync(result); } catch {}
writeFileSync(command + '.tmp', script);
renameSync(command + '.tmp', command);

const deadline = Date.now() + 15000;
const timer = setInterval(() => {
  if (existsSync(result)) {
    clearInterval(timer);
    const text = readFileSync(result, 'utf8');
    unlinkSync(result);
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
  } else if (Date.now() > deadline) {
    clearInterval(timer);
    try { unlinkSync(command); } catch {}
    console.error('No answer: is a Debug build of TubeBox running?');
    process.exit(1);
  }
}, 100);
