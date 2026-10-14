/**
 * 课堂纪要导出：结构化 Markdown（工作台 / 我的纪要共用）
 * 录音时间戳在真实接入后可替换为可点击的回跳链接
 */
import type { ClassNote } from '@/mock/data'

export function buildNoteMarkdown(note: ClassNote): string {
  const lines: string[] = []
  lines.push(`# ${note.title}`)
  lines.push('')
  lines.push(`> 课程：${note.course} ｜ 时间：${note.date} ｜ 时长：${note.duration}`)
  lines.push('')
  lines.push('## 课程主题')
  lines.push(note.theme || '（待生成）')
  lines.push('')
  if (note.points.length) {
    lines.push('## 核心知识点')
    for (const p of note.points) lines.push(`- ${p.text} _[${p.cite}]_`)
    lines.push('')
  }
  if (note.definitions.length) {
    lines.push('## 重要定义与公式')
    for (const d of note.definitions) {
      lines.push(`- **${d.term}**：${d.detail}${d.cite ? ` _[${d.cite}]_` : ''}`)
    }
    lines.push('')
  }
  if (note.emphasized.length) {
    lines.push('## 重点问题')
    for (const e of note.emphasized) lines.push(`- ⭐ ${e}`)
    lines.push('')
  }
  lines.push('---')
  lines.push('_由 智学纪要 · 多模态课堂知识助手 生成_')
  return lines.join('\n')
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.md') ? filename : filename + '.md'
  a.click()
  URL.revokeObjectURL(a.href)
}
