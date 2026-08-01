/**
 * 验证 markdownMinimalMerge：零改动字节保留、单行编辑、增删块、锚点失败。
 * 运行：node scripts/verify-md-minimal-merge.mjs
 */
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(root, 'src/lib/markdownMinimalMerge.ts')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-md-merge-'))
const outFile = path.join(outDir, 'markdownMinimalMerge.mjs')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function countChangedLines(a, b) {
  const A = a.replace(/\r\n/g, '\n').split('\n')
  const B = b.replace(/\r\n/g, '\n').split('\n')
  const n = A.length
  const m = B.length
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return n + m - 2 * dp[0][0]
}

async function main() {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: outFile,
    logLevel: 'silent',
  })

  const mod = await import(pathToFileURL(outFile).href)
  const {
    mergeSerializedEdit,
    detectDominantEol,
    withDominantEol,
    splitLinesWithEol,
    inferRemarkStringifyOptions,
    normalizeLineForAnchor,
  } = mod

  // --- split / dominant EOL ---
  {
    const lines = splitLinesWithEol('a\r\nb\r\n')
    assert(lines.length === 2 && lines[0].eol === '\r\n' && lines[1].eol === '\r\n', 'split CRLF')
    assert(detectDominantEol('a\r\nb\r\nc\n') === '\r\n', 'dominant CRLF')
    assert(detectDominantEol('a\nb\nc') === '\n', 'dominant LF')
    assert(withDominantEol('a\nb\n', '\r\n') === 'a\r\nb\r\n', 'withDominantEol')
  }

  // --- infer + normalize ---
  {
    assert(inferRemarkStringifyOptions('* a\n* b\n').bullet === '*', 'infer bullet *')
    assert(inferRemarkStringifyOptions('- a\n- b\n').bullet === '-', 'infer bullet -')
    assert(inferRemarkStringifyOptions('***\n***\n').rule === '*', 'infer rule *')
    assert(inferRemarkStringifyOptions('---\n---\n').rule === '-', 'infer rule -')
    assert(normalizeLineForAnchor('* **优先采用**: x') === normalizeLineForAnchor('- **优先采用**: x'), 'norm bullet')
    assert(normalizeLineForAnchor('***') === normalizeLineForAnchor('---'), 'norm hr')
    assert(
      normalizeLineForAnchor('| A | B |') === normalizeLineForAnchor('| A | B |'),
      'norm table pad self',
    )
    assert(
      normalizeLineForAnchor('| A | B |') === normalizeLineForAnchor('| A  |  B |'),
      'norm table pad',
    )
  }

  // --- 零改动：字节相同 ---
  {
    const original = '# Title\r\n\r\n***\r\n\r\nline\r\n'
    const r = mergeSerializedEdit(original, 'serialized-same', 'serialized-same')
    assert(r != null && r.body === original && r.changedLines === 0, 'zero edit keeps bytes')
  }

  // --- CRLF 文档改一行：远处 *** / 表格不动 ---
  {
    const original = [
      '# Title',
      '',
      '***',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      'hello world',
      '',
      'tail',
      '',
    ].join('\r\n')
    // 基线：序列化改了 hr 与表格对齐，但语义行仍可锚
    const baseline = [
      '# Title',
      '',
      '---',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'hello world',
      '',
      'tail',
      '',
    ].join('\n')
    const next = baseline.replace('hello world', 'hello there')
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r != null, 'single-line merge not null')
    assert(r.body.includes('***'), 'keep original hr ***')
    assert(r.body.includes('|---|---|'), 'keep original table sep')
    assert(r.body.includes('hello there'), 'apply edit')
    assert(!r.body.includes('hello world'), 'old line gone')
    assert(/\r\n/.test(r.body) && !/(^|[^\r])\n/.test(r.body.replace(/\r\n/g, '')), 'pure CRLF out')
    // 只有被编辑行附近变化，*** 与表格行应与原文相同
    const origLines = original.split('\r\n')
    const outLines = r.body.split('\r\n')
    assert(outLines[2] === '***', 'hr line identical')
    assert(outLines[4] === '| A | B |', 'table header identical')
    assert(outLines[5] === '|---|---|', 'table sep identical')
    assert(countChangedLines(original, r.body) <= 2, `few lines changed, got ${countChangedLines(original, r.body)}`)
    void origLines
  }

  // --- 段落新增 ---
  {
    const original = 'A\r\n\r\nB\r\n'
    const baseline = 'A\n\nB\n'
    const next = 'A\n\nNEW\n\nB\n'
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r != null && r.body.includes('NEW'), 'insert paragraph')
    assert(r.body.startsWith('A\r\n'), 'keep CRLF after A')
  }

  // --- 块删除 ---
  {
    const original = 'A\r\n\r\nB\r\n\r\nC\r\n'
    const baseline = 'A\n\nB\n\nC\n'
    const next = 'A\n\nC\n'
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r != null && !r.body.includes('B'), 'delete block')
    assert(r.body.includes('A') && r.body.includes('C'), 'keep A C')
  }

  // --- 首尾边界 ---
  {
    const original = 'only\r\n'
    const baseline = 'only\n'
    const next = 'first\nonly\nlast\n'
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r != null, 'edge insert')
    assert(r.body.includes('first') && r.body.includes('last'), 'head and tail')
  }

  // --- 表格内改一格：整表块可被替换（不报错） ---
  {
    const original = '| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\nafter\r\n'
    const baseline = '| A | B |\n| -- | -- |\n| 1 | 2 |\n\nafter\n'
    const next = '| A | B |\n| -- | -- |\n| 1 | 9 |\n\nafter\n'
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r != null, 'table cell edit')
    assert(r.body.includes('9') && r.body.includes('after'), 'table edit applied')
  }

  // --- * 列表 vs 基线 - 列表：只改标题，保留原文 * ---
  {
    const original = [
      '# L1T00 通用软件开发（默认栈选择）',
      '',
      '* **优先采用**: Electron + React + Vite + TypeScript',
      '* **不要**默认改用 WPF、WinForms、纯脚本或其它未约定栈',
      '* UI 库（如 Tailwind）可选，不强制',
      '',
    ].join('\r\n')
    const baseline = [
      '# L1T00 通用软件开发（默认栈选择）',
      '',
      '- **优先采用**: Electron + React + Vite + TypeScript',
      '- **不要**默认改用 WPF、WinForms、纯脚本或其它未约定栈',
      '- UI 库（如 Tailwind）可选，不强制',
      '',
    ].join('\n')
    const next = baseline.replace(
      '# L1T00 通用软件开发（默认栈选择）',
      '# L1T00 通用软件开发（默认栈选择）阿萨德饭',
    )
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r != null, 'star-list title edit not null')
    assert(r.body.includes('阿萨德饭'), 'title edit applied')
    assert(r.body.includes('* **优先采用**'), 'keep star bullet 1')
    assert(r.body.includes('* **不要**'), 'keep star bullet 2')
    assert(r.body.includes('* UI 库'), 'keep star bullet 3')
    assert(!r.body.includes('- **优先采用**'), 'no dash rewrite')
    assert(countChangedLines(original, r.body) <= 2, `star-list few changes, got ${countChangedLines(original, r.body)}`)
  }

  // --- 锚点缺失导致区间交叉 → null ---
  {
    // 原文与基线无公共行；两处改动块在空 map 下都会落到 oriStart=0 → 第二块交叉
    const original = 'keep\r\n'
    const baseline = 'a\nb\nc\n'
    const next = 'X\nb\nY\n'
    const r = mergeSerializedEdit(original, baseline, next)
    assert(r == null, 'anchor miss / cross → null')
  }

  console.log('verify-md-minimal-merge: all assertions passed')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    try {
      fs.rmSync(outDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })
