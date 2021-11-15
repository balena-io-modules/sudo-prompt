import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UUID, Remove, EscapeDoubleQuotes, PERMISSION_DENIED, Instance } from '../utils';
import { APPLET } from './applet';
import * as child_process from 'child_process';
import { promisify } from 'util';
const exec = promisify(child_process.exec);

export async function Mac(instance: Instance) {
  const temp = os.tmpdir();
  const user = process.env.USER; // Applet shell scripts require $USER.
  if (!user) {
    throw new Error('env[\'USER\'] not defined.');
  }
  try {
    const uuid = await UUID(instance);
    instance.uuid = uuid;
    instance.path = path.join(
      temp,
      instance.uuid,
      instance.options.name + '.app'
    );
    await Remove(path.dirname(instance.path));
    await MacApplet(instance);
    await MacIcon(instance);
    await MacPropertyList(instance);
    await MacCommand(instance);
    await MacOpen(instance);
    return MacResult(instance);
  } catch (error) {
    throw error;
  }
}

async function MacApplet(instance: Instance) {
  const parent = path.dirname(instance.path);
  try {
    await fs.mkdir(parent);
    const zip = path.join(parent, 'sudo-prompt-applet.zip');
    await fs.writeFile(zip, APPLET, 'base64');
    const command = [];
    command.push('/usr/bin/unzip');
    command.push('-o'); // Overwrite any existing applet.
    command.push('"' + EscapeDoubleQuotes(zip) + '"');
    command.push('-d "' + EscapeDoubleQuotes(instance.path) + '"');
    const commandString = command.join(' ');
    return exec(commandString, { encoding: 'utf-8' });
  } catch (error) {
    throw error;
  }
}

function MacCommand(instance: Instance) {
  const pathString = path.join(
    instance.path,
    'Contents',
    'MacOS',
    'sudo-prompt-command'
  );
  const script = [];
  // Preserve current working directory:
  // We do this for commands that rely on relative paths.
  // This runs in a subshell and will not change the cwd of sudo-prompt-script.
  script.push('cd "' + EscapeDoubleQuotes(process.cwd()) + '"');
  // Export environment variables:
  for (const key in instance.options.env) {
    const value = instance.options.env[key] || '';
    script.push('export ' + key + '="' + EscapeDoubleQuotes(value) + '"');
  }
  script.push(instance.command);
  const scriptString = script.join('\n');
  return fs.writeFile(pathString, scriptString, 'utf-8');
}

async function MacIcon(instance: Instance) {
  if (!instance.options.icns) {
    return;
  }
  try {
    const buffer = await fs.readFile(instance.options.icns);
    const icns = path.join(
      instance.path,
      'Contents',
      'Resources',
      'applet.icns'
    );
    return fs.writeFile(icns, buffer);
  } catch (error) {
    throw error;
  }
}

function MacOpen(instance: Instance) {
  // We must run the binary directly so that the cwd will apply.
  const binary = path.join(instance.path, 'Contents', 'MacOS', 'applet');
  // We must set the cwd so that the AppleScript can find the shell scripts.
  const options = {
    cwd: path.dirname(binary),
    encoding: 'utf-8'
  };
  // We use the relative path rather than the absolute path. The instance.path
  // may contain spaces which the cwd can handle, but which exec() cannot.
  return exec('./' + path.basename(binary), options);
}

function MacPropertyList(instance: Instance) {
  try {
    // Value must be in single quotes (not double quotes) according to man entry.
    // e.g. defaults write com.companyname.appname "Default Color" '(255, 0, 0)'
    // The defaults command will be changed in an upcoming major release to only
    // operate on preferences domains. General plist manipulation utilities will
    // be folded into a different command-line program.
    const plist = path.join(instance.path, 'Contents', 'Info.plist');
    const escapedPlist = EscapeDoubleQuotes(plist);
    const key = EscapeDoubleQuotes('CFBundleName');
    const value = instance.options.name + ' Password Prompt';
    if (/'/.test(value)) {
      throw new Error('Value should not contain single quotes.');
    }
    const command = [];
    command.push('/usr/bin/defaults');
    command.push('write');
    command.push('"' + escapedPlist + '"');
    command.push('"' + key + '"');
    command.push("'" + value + "'"); // We must use single quotes for value.
    const commandString = command.join(' ');
    return exec(commandString, { encoding: 'utf-8' });
  } catch (error) {
    throw error;
  }
}

async function MacResult(instance: Instance) {
  try {
    const cwd = path.join(instance.path, 'Contents', 'MacOS');
    const code = await fs.readFile(path.join(cwd, 'code'), 'utf-8');
    const stdout = await fs.readFile(path.join(cwd, 'stdout'), 'utf-8');
    const stderr = await fs.readFile(path.join(cwd, 'stderr'), 'utf-8');
    const codeNum = parseInt(code.trim(), 10); // Includes trailing newline.
    if (codeNum === 0) {
      return { stdout, stderr };
    } else {
      throw new Error(
        'Command failed: ' + instance.command + '\n' + stderr
      );
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(PERMISSION_DENIED);
    }
    throw error;
  }
}