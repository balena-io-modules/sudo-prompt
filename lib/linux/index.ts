import * as child_process from 'child_process';
import { promises as fs } from 'fs';
import { EscapeDoubleQuotes, MAX_BUFFER, NO_POLKIT_AGENT } from '../utils';
import { promisify } from 'util';
const exec = promisify(child_process.exec);

export async function Linux(instance: any) {
  try {
    const binary = await LinuxBinary();
    const command = [];
    // Preserve current working directory:
    command.push('cd "' + EscapeDoubleQuotes(process.cwd()) + '";');
    // Export environment variables:
    for (const key in instance.options.env) {
      const value = instance.options.env[key];
      command.push('export ' + key + '="' + EscapeDoubleQuotes(value) + '";');
    }
    command.push('"' + EscapeDoubleQuotes(binary) + '"');
    if (/kdesudo/i.test(binary)) {
      command.push(
        '--comment',
        '"' + instance.options.name + ' wants to make changes. ' +
        'Enter your password to allow this."'
      );
      command.push('-d'); // Do not show the command to be run in the dialog.
      command.push('--');
    } else if (/pkexec/i.test(binary)) {
      command.push('--disable-internal-agent');
    }
    const magic = 'SUDOPROMPT\n';
    command.push(
      '/bin/bash -c "echo ' + EscapeDoubleQuotes(magic.trim()) + '; ' +
      EscapeDoubleQuotes(instance.command) +
      '"'
    );
    const commandString = command.join(' ');
    let { stdout, stderr } = await exec(commandString, { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
    // ISSUE 88:
    // We must distinguish between elevation errors and command errors.
    //
    // KDESUDO:
    // kdesudo provides no way to do this. We add a magic marker to know
    // if elevation succeeded. Any error thereafter is a command error.
    //
    // PKEXEC:
    // "Upon successful completion, the return value is the return value of
    // PROGRAM. If the calling process is not authorized or an
    // authorization could not be obtained through authentication or an
    // error occured, pkexec exits with a return value of 127. If the
    // authorization could not be obtained because the user dismissed the
    // authentication dialog, pkexec exits with a return value of 126."
    //
    // However, we do not rely on pkexec's return of 127 since our magic
    // marker is more reliable, and we already use it for kdesudo.
    const elevated = stdout && stdout.slice(0, magic.length) === magic;
    if (elevated) {
      stdout = stdout.slice(magic.length);
    }
    // Only normalize the error if it is definitely not a command error:
    // In other words, if we know that the command was never elevated.
    // We do not inspect error messages beyond NO_POLKIT_AGENT.
    // We cannot rely on English errors because of internationalization.
    if (/No authentication agent found/.test(stderr)) {
      throw new Error(NO_POLKIT_AGENT);
    }
    return { stdout, stderr };
  } catch (error) {
    throw error;
  }
}

const paths = ['/usr/bin/kdesudo', '/usr/bin/pkexec'];
async function LinuxBinary(retry: number = 0): Promise<string> {
  // We used to prefer gksudo over pkexec since it enabled a better prompt.
  // However, gksudo cannot run multiple commands concurrently.
  if (retry === paths.length) {
    throw new Error('Unable to find pkexec or kdesudo.');
  }
  const path = paths[retry];
  try {
    await fs.stat(path);
    return path;
  } catch (error) {
    if (['ENOTDIR', 'ENOENT'].includes(error.message)) {
      return LinuxBinary();
    }
    throw error;
  }
}