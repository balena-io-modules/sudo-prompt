import { Mac } from './darwin';
import { Linux } from './linux';
import type { Instance, Options } from './utils';
import { Windows } from './win32';

async function Attempt(platform: string, instance: Instance) {
  if (platform === 'darwin') {
    return Mac(instance);
  } else if (platform === 'linux') {
    return Linux(instance);
  } if (platform === 'win32') {
    return Windows(instance);
  }
}

export function exec(
  command: string,
  options: Options = {
    name: process.title,
    env: process.env,
  }
) {
  if (/^sudo/i.test(command)) {
    throw new Error('Command should not be prefixed with "sudo".');
  }
  if (options.name === undefined || !ValidName(options.name)) {
    let error = '';
    error += 'options.name must be alphanumeric only ';
    error += '(spaces are allowed) and <= 70 characters.';
    throw new Error(error);
  }
  if (typeof options.icns !== undefined) {
    if (typeof options.icns !== 'string') {
      throw new Error('options.icns must be a string if provided.');
    } else if (options.icns.trim().length === 0) {
      throw new Error('options.icns must not be empty if provided.');
    }
  }
  if (typeof options.env !== undefined) {
    if (typeof options.env !== 'object') {
      throw new Error('options.env must be an object if provided.');
    } else if (Object.keys(options.env).length === 0) {
      throw new Error('options.env must not be empty if provided.');
    } else {
      for (const key in options.env) {
        const value = options.env[key];
        if (typeof key !== 'string' || typeof value !== 'string') {
          throw new Error('options.env environment variables must be strings.');
        }
        // "Environment variable names used by the utilities in the Shell and
        // Utilities volume of IEEE Std 1003.1-2001 consist solely of uppercase
        // letters, digits, and the '_' (underscore) from the characters defined
        // in Portable Character Set and do not begin with a digit. Other
        // characters may be permitted by an implementation; applications shall
        // tolerate the presence of such names."
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          throw new Error(
            'options.env has an invalid environment variable name: ' +
            JSON.stringify(key)
          );
        }
        if (/[\r\n]/.test(value)) {
          throw new Error(
            'options.env has an invalid environment variable value: ' +
            JSON.stringify(value)
          );
        }
      }
    }
  }
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error('Platform not yet supported.');
  }
  const instance = {
    command: command,
    options: options,
    uuid: '',
    path: '',
    pathElevate: '',
    pathExecute: '',
    pathStatus: '',
    pathStdout: '',
    pathStderr: '',
    pathCommand: '',
  };
  return Attempt(platform, instance);
}

function ValidName(str: string) {
  // We use 70 characters as a limit to side-step any issues with Unicode
  // normalization form causing a 255 character string to exceed the fs limit.
  if (!/^[a-z0-9 ]+$/i.test(str)) return false;
  if (str.trim().length === 0) return false;
  if (str.length > 70) return false;
  return true;
}
