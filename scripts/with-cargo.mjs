/**
 * Prepend %USERPROFILE%\.cargo\bin to PATH, then run the given command.
 * Fixes conda / stale shells where rustup is installed but cargo is not on PATH.
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const cargoBin = path.join(os.homedir(), '.cargo', 'bin')
const sep = path.delimiter
const env = { ...process.env }
const current = env.PATH || env.Path || ''
const parts = current.split(sep).filter(Boolean)
const already = parts.some((p) => path.normalize(p).toLowerCase() === path.normalize(cargoBin).toLowerCase())
if (!already) {
  const next = `${cargoBin}${sep}${current}`
  env.PATH = next
  env.Path = next
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/with-cargo.mjs <cmd> [args...]')
  process.exit(1)
}

const child = spawn(args[0], args.slice(1), {
  env,
  stdio: 'inherit',
  shell: true,
  cwd: process.cwd(),
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
