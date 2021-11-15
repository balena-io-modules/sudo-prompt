import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UUID, Remove, PERMISSION_DENIED, Instance, Options, exec, sleep } from '../utils';

export async function Windows(instance: Instance) {
  try {
    const temp = os.tmpdir();
    const uuid = await UUID(instance);
    instance.uuid = uuid;
    instance.path = path.join(temp, instance.uuid);
    if (/"/.test(instance.path)) {
      // We expect double quotes to be reserved on Windows.
      // Even so, we test for this and abort if they are present.
      throw new Error('Invalid path: instance.path cannot contain double-quotes.')
    }
    instance.pathElevate = path.join(instance.path, 'elevate.vbs');
    instance.pathExecute = path.join(instance.path, 'execute.bat');
    instance.pathCommand = path.join(instance.path, 'command.bat');
    instance.pathStdout = path.join(instance.path, 'stdout');
    instance.pathStderr = path.join(instance.path, 'stderr');
    instance.pathStatus = path.join(instance.path, 'status');
    await fs.mkdir(instance.path);
    await Remove(instance.path);
    await WindowsWriteExecuteScript(instance);
    await WindowsWriteCommandScript(instance);
    await WindowsCopyCmd(instance);
    await WindowsElevate(instance);
    await WindowsWaitForStatus(instance);
    return WindowsResult(instance);
  } catch (error) {
    throw error;
  }
}

function WindowsNeedsCopyCmd(instance: Instance): boolean {
  const specialChars = ['&', '`', "'", '"', '<', '>', '|', '^'];
  for (const specialChar of specialChars) {
    if (instance.path.includes(specialChar)) {
      return true;
    }
  }
  return false;
}

async function WindowsCopyCmd(instance: Instance) {
  const needsCopy = await WindowsNeedsCopyCmd(instance);
  if (!needsCopy) {
    return;
  }
  // Work around https://github.com/jorangreef/sudo-prompt/issues/97
  // Powershell can't properly escape amperstands in paths.
  // We work around this by copying cmd.exe in our temporary folder and running
  // it from here (see WindowsElevate below).
  // That way, we don't have to pass the path containing the amperstand at all.
  // A symlink would probably work too but you have to be an administrator in
  // order to create symlinks on Windows.
  await fs.copyFile(
    path.join(process.env.SystemRoot || '', 'System32', 'cmd.exe'),
    path.join(instance.path, 'cmd.exe'),
  );
}

async function WindowsElevate(instance: Instance) {
  try {
    // We used to use this for executing elevate.vbs:
    // const command = 'cscript.exe //NoLogo "' + instance.pathElevate + '"';
    const command = [];
    command.push('powershell.exe');
    command.push('Start-Process');
    command.push('-FilePath');
    const options: Options = { encoding: 'utf8', env: process.env };
    if (WindowsNeedsCopyCmd(instance)) {
      // path.join('.', 'cmd.exe') would return 'cmd.exe'
      command.push(['.', 'cmd.exe'].join(path.sep));
      command.push('-ArgumentList');
      command.push('"/C","execute.bat"');
      options.cwd = instance.path;
    } else {
      // Escape characters for cmd using double quotes:
      // Escape characters for PowerShell using single quotes:
      // Escape single quotes for PowerShell using backtick:
      // See: https://ss64.com/ps/syntax-esc.html
      command.push('"\'' + instance.pathExecute.replace(/'/g, "`'") + '\'"');
    }
    command.push('-WindowStyle hidden');
    command.push('-Verb runAs');
    const commandString = command.join(' ');
    const child = await exec(commandString, options);
    // @ts-ignore - child.stdin is not typed
    child.stdin.end(); // Otherwise PowerShell waits indefinitely on Windows 7.
  } catch (error) {
    throw new Error(PERMISSION_DENIED);
  }
}

async function WindowsResult(instance: Instance) {
  try {
    await fs.readFile(instance.pathStatus, 'utf-8');
    const stdout = await fs.readFile(instance.pathStdout, 'utf-8');
    const stderr = await fs.readFile(instance.pathStderr, 'utf-8');
    return { stdout, stderr };
  } catch (error) {
    const code = parseInt(error.code.trim(), 10);
    if (code === 0) {
      return;
    } else {
      error = new Error(
        'Command failed: ' + instance.command + '\r\n' + error.message,
      );
      error.code = code.toString();
    }
    throw error;
  }
}

async function WindowsWaitForStatus(instance: Instance) {
  try {
    // VBScript cannot wait for the elevated process to finish so we have to poll.
    // VBScript cannot return error code if user does not grant permission.
    // PowerShell can be used to elevate and wait on Windows 10.
    // PowerShell can be used to elevate on Windows 7 but it cannot wait.
    // powershell.exe Start-Process cmd.exe -Verb runAs -Wait
    const stats = await fs.stat(instance.pathStatus);
    if ( stats.size < 2) {
      await retryWaitForStatus(instance);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // Retry if file does not exist or is not finished writing.
      // We expect a file size of 2. That should cover at least "0\r".
      // We use a 1 second timeout to keep a light footprint for long-lived
      // sudo-prompt processes.
      await retryWaitForStatus(instance);
    } else {
      throw error;
    }
  }
}

async function retryWaitForStatus(instance: Instance) {
  await sleep(1000);
  await fs.stat(instance.pathStatus);
  await WindowsWaitForStatus(instance);
}

function WindowsWriteCommandScript(instance: Instance) {
  const cwd = process.cwd();
  if (/"/.test(cwd)) {
    // We expect double quotes to be reserved on Windows.
    // Even so, we test for this and abort if they are present.
    throw new Error('process.cwd() cannot contain double-quotes.');
  }
  const script = [];
  script.push('@echo off');
  // Set code page to UTF-8:
  script.push('chcp 65001>nul');
  // Preserve current working directory:
  // We pass /d as an option in case the cwd is on another drive (issue 70).
  script.push('cd /d "' + cwd + '"');
  // Export environment variables:
  for (const key in instance.options.env) {
    // "The characters <, >, |, &, ^ are special command shell characters, and
    // they must be preceded by the escape character (^) or enclosed in
    // quotation marks. If you use quotation marks to enclose a string that
    // contains one of the special characters, the quotation marks are set as
    // part of the environment variable value."
    // In other words, Windows assigns everything that follows the equals sign
    // to the value of the variable, whereas Unix systems ignore double quotes.
    const value = instance.options.env[key];
    if (value) {
      script.push('set ' + key + '=' + value.replace(/([<>\\|&^])/g, '^$1'));
    }
  }
  script.push(instance.command);
  const scriptString = script.join('\r\n');
  return fs.writeFile(instance.pathCommand, scriptString, 'utf-8');
}

// @ts-ignore
function WindowsWriteElevateScript(instance: Instance) {
  // We do not use VBScript to elevate since it does not return an error if
  // the user does not grant permission. This is here for reference.
  // const script = [];
  // script.push('Set objShell = CreateObject("Shell.Application")');
  // script.push(
  // 'objShell.ShellExecute "' + instance.pathExecute + '", "", "", "runas", 0'
  // );
  // script = script.join('\r\n');
  // fs.writeFile(instance.pathElevate, script, 'utf-8');
}

function WindowsWriteExecuteScript(instance: Instance) {
  const script = [];
  script.push('@echo off');
  script.push(
    'call "' + instance.pathCommand + '"' +
    ' > "' + instance.pathStdout + '" 2> "' + instance.pathStderr + '"'
  );
  script.push('(echo %ERRORLEVEL%) > "' + instance.pathStatus + '"');
  const scriptString = script.join('\r\n');
  fs.writeFile(instance.pathExecute, scriptString, 'utf-8');
}