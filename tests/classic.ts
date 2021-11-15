import * as assert from 'assert';
import * as fs from 'fs';
import { resolve } from 'path';
import * as sudo from '../lib';
import { exec } from '../lib/utils';

function kill() {
  if (process.platform === 'win32') {
    return;
  }
  exec('sudo -k');
}

function icns() {
  if (process.platform !== 'darwin') {
    return undefined;
  }
  const iconsPath = resolve(__dirname, '../assets/electron.icns');
  try {
    fs.statSync(iconsPath);
    return iconsPath;
  } catch (error) {
    throw error;
  }
}

main();

async function main() {
  const options = {
    env: { 'SUDO_PROMPT_TEST_ENV': 'hello world' },
    icns: icns(),
    name: 'Electron'
  };
  console.log(options);
  let command, expected;
  if (process.platform === 'win32') {
    command = 'echo %SUDO_PROMPT_TEST_ENV%';
    expected = 'hello world\r\n';
  } else {
    // We use double quotes to tell echo to preserve internal space:
    command = 'echo "$SUDO_PROMPT_TEST_ENV"';
    expected = 'hello world\n';
  }
  console.log(
    'sudo.exec(' +
      JSON.stringify(command) + ', ' +
      JSON.stringify(options) +
    ')'
  );
  try { 
    const { stderr, stdout } = await sudo.exec(command, options);
    console.log('stdout: ' + JSON.stringify(stdout));
    console.log('stderr: ' + JSON.stringify(stderr));
    assert(stdout === undefined || typeof stdout === 'string');
    assert(stderr === undefined || typeof stderr === 'string');
    if (stdout !== expected) {
      throw new Error('stdout != ' + JSON.stringify(expected));
    }
    if (stderr !== '') {
      throw new Error('stderr != ""');
    }
    console.log('OK');
    kill();
  } catch (error) {
    console.error(error);
    assert(error === undefined || typeof error === 'object');
  }
}
