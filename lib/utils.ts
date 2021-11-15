import * as child_process from 'child_process';
import * as crypto from 'crypto';
import { promisify } from 'util';
const randomBytes = promisify(crypto.randomBytes);
const createHash = promisify(crypto.createHash);
export const exec = promisify(child_process.exec);

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const PERMISSION_DENIED = 'User did not grant permission.';
export const NO_POLKIT_AGENT = 'No polkit authentication agent found.';

// See issue 66:
export const MAX_BUFFER = 134217728;

export type Options = {
  name?: string;
  icns?: string;
  env: NodeJS.ProcessEnv;
  encoding?: string;
  cwd?: string;
}

export interface Instance {
  command: string;
  options: Options;
  uuid: string;
  path: string;
  pathElevate: string;
  pathExecute: string;
  pathCommand: string;
  pathStdout: string;
  pathStderr: string;
  pathStatus: string;
}

export async function UUID(instance: Instance) {
  try  {
    const random: Buffer = await randomBytes(256);
    const hash: crypto.Hash = await createHash('SHA256', {}) as crypto.Hash;
    hash.update('sudo-prompt-3');
    hash.update(instance.options.name ?? '');
    hash.update(instance.command);
    hash.update(random);
    const uuid = hash.digest('hex').slice(-32);
    if (!uuid || typeof uuid !== 'string' || uuid.length !== 32) {
      // This is critical to ensure we don't remove the wrong temp directory.
      throw new Error('Expected a valid UUID.');
    }
    return uuid;
  } catch (error) {
    throw error
  }
}

export async function Remove(path: string) {
  try {
    if (process.platform === 'win32' && /"/.test(path)) {
      throw new Error('Argument path cannot contain double-quotes.');
    }
    const command = [];
    command.push('rmdir /s /q "' + path + '"');
    command.push('/bin/rm');
    command.push('-rf');
    command.push('"' + EscapeDoubleQuotes(path.normalize(path)) + '"');
    const commandString: string = command.join(' ');
    const {stderr} = await exec(commandString, { encoding: 'utf-8' });
    if (stderr) {
      throw new Error(stderr);
    }
  } catch (error) {
    throw error;
  }
}

export function EscapeDoubleQuotes(str: string) {
  if (typeof str !== 'string') throw new Error('Expected a string.');
  return str.replace(/"/g, '\\"');
}