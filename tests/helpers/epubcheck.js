import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function resolveEpubCheckRunner() {
  const candidates = [
    process.env.EPUBCHECK_JAR,
    path.resolve('.tools/epubcheck/epubcheck-5.4.0/epubcheck.jar'),
    path.resolve('.tools/epubcheck/epubcheck.jar'),
    path.join(os.tmpdir(), 'wpb-epubcheck', 'epubcheck-5.4.0', 'epubcheck.jar')
  ].filter(Boolean);

  for (const jar of candidates) {
    if (fs.existsSync(jar)) {
      return { type: 'jar', path: jar };
    }
  }

  try {
    execFileSync('epubcheck', ['--version'], { stdio: 'pipe' });
    return { type: 'bin', path: 'epubcheck' };
  } catch {
    return null;
  }
}

export function runEpubCheck(epubPath) {
  const runner = resolveEpubCheckRunner();
  if (!runner) {
    return { available: false, ok: false, output: 'epubcheck not installed' };
  }

  const cmd = runner.type === 'jar' ? 'java' : runner.path;
  const args = runner.type === 'jar' ? ['-jar', runner.path, epubPath] : [epubPath];

  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' });
    return { available: true, ok: true, output: stdout };
  } catch (err) {
    const combined = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
    return { available: true, ok: false, output: combined || err.message };
  }
}
