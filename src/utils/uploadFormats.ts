/**
 * 全站统一的文件上传格式注册表
 * 工作台材料上传 / 智能问答附件 / 反馈截图 / 头像上传共用同一份定义，
 * 保证任何页面展示与过滤的格式完全一致（单一来源，避免多处维护漂移）
 *
 * 格式取舍（只保留后端流水线可真实解析的）：
 * - 音频剔除 oga / opus / amr / wma：少用，且 amr / wma 解码依赖额外组件
 * - 图片剔除 bmp / svg / heic / heif：过时少用，或 <img> 预览与模型解析难以支持
 * - 视频剔除 m4v / avi / wmv / flv / ts：过时、专用或面向流媒体的容器
 * - 文档剔除 rtf / doc / xls / ppt / pps：老版二进制格式后端无法解析，
 *   统一引导另存为 OOXML（docx / xlsx / pptx）或 PDF / 文本类
 * - zip 压缩包：后端逐个解出内嵌文档（txt / md / pdf / docx / pptx / xlsx / csv）
 *   解析后合并生成纪要，嵌套压缩包与系统垃圾文件自动跳过
 */
export type UploadKind = 'audio' | 'image' | 'video' | 'ppt' | 'doc' | 'zip'

export const UPLOAD_EXTS: Record<UploadKind, string[]> = {
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  video: ['mp4', 'webm', 'mov', 'mkv'],
  ppt: ['pptx', 'ppsx'],
  doc: ['pdf', 'docx', 'txt', 'md', 'xlsx', 'csv'],
  zip: ['zip'],
}

/** 文件选择器的 accept 过滤（显式扩展名，避免 image/* 等宽过滤放进不支持的格式） */
export const UPLOAD_ACCEPT: Record<UploadKind, string> = Object.fromEntries(
  (Object.keys(UPLOAD_EXTS) as UploadKind[]).map((k) => [
    k,
    UPLOAD_EXTS[k]
      .map((e) => '.' + e)
      .join(','),
  ])
) as Record<UploadKind, string>

/** 工作台上传区：全部格式合并的 accept */
export const uploadAcceptAttr = Object.values(UPLOAD_ACCEPT).join(',')

export const UPLOAD_KIND_META: Record<UploadKind, { label: string; icon: string; tint: string }> = {
  audio: { label: '音频', icon: 'headphones', tint: 'tint-sky' },
  image: { label: '图片', icon: 'image', tint: 'tint-mint' },
  video: { label: '视频', icon: 'film', tint: 'tint-rose' },
  ppt: { label: 'PPT', icon: 'layers', tint: 'tint-yellow-bold' },
  doc: { label: '文档', icon: 'file', tint: 'tint-peach' },
  zip: { label: '压缩包', icon: 'folder', tint: 'tint-sky' },
}

/** 各类型单文件大小上限（MB），与后端校验一致：
 * 录音 / 视频对齐 DashScope 转写约束，图片放宽到 20MB（服务端压缩后送视觉模型） */
export const UPLOAD_MAX_MB: Record<UploadKind, number> = {
  audio: 500,
  image: 20,
  video: 1024,
  ppt: 100,
  doc: 100,
  zip: 100,
}

/** zip / 文件夹内会被真正解析的文档扩展名（对齐后端 notes/services.py 的 ZIP_DOC_EXTS），
 * 打包文件夹时只收这些格式，其余文件（音视频 / 图片 / 可执行等）不参与合并生成 */
export const ZIP_DOC_EXTS = ['txt', 'md', 'markdown', 'pdf', 'docx', 'pptx', 'ppsx', 'xlsx', 'csv']

/** zip 内单文件解压上限（对齐后端 ZIP_INNER_MAX） */
export const ZIP_INNER_MAX_MB = 20

/** 按扩展名识别格式类别；不在支持列表内返回 null（扩展名即规则，与 accept 完全一致） */
export function detectUploadKind(name: string): UploadKind | null {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (UPLOAD_EXTS.ppt.includes(ext)) return 'ppt'
  if (UPLOAD_EXTS.audio.includes(ext)) return 'audio'
  if (UPLOAD_EXTS.image.includes(ext)) return 'image'
  if (UPLOAD_EXTS.video.includes(ext)) return 'video'
  if (UPLOAD_EXTS.zip.includes(ext)) return 'zip'
  if (UPLOAD_EXTS.doc.includes(ext)) return 'doc'
  return null
}

/** 仅图片上传处（头像 / 反馈截图）使用：按扩展名校验 */
export function isSupportedImage(name: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return UPLOAD_EXTS.image.includes(ext)
}

/** 文件大小展示（列表去重也依赖该格式化结果） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
