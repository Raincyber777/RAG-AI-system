/**
 * 课堂纪要页的本地持久化：刷新浏览器后恢复上传队列（含文件本体）与本次生成的纪要清单。
 * - 队列用 IndexedDB：File/Blob 进不了 localStorage，但可以结构化克隆存入 IndexedDB
 * - 生成清单（各份纪要的 id / 状态 / 来源文件名）很小，localStorage 即可
 * - 都按用户 id 隔离：换账号登录不会串现场；游客态（无 uid）不持久化
 * - 全部尽力而为：IndexedDB 不可用 / 配额超限 / JSON 损坏时静默降级，绝不影响正常流程
 */
const DB_NAME = 'zy-studio'
const STORE = 'kv'
const QUEUE_PREFIX = 'queue-'
const RUN_PREFIX = 'run-'
/** 队列总量超过该值不持久化（整段录音 / 长视频的场景），避免撑爆浏览器配额 */
const MAX_PERSIST_TOTAL_MB = 300

/** 与 StudioPage 的 InputFile 结构对齐的最小持久化形状（preview 不落盘，恢复时按需重建） */
export interface PersistFile {
  id: string
  name: string
  kind: string
  size: string
  theme?: string
  course?: string
  folderCount?: number
  file?: File
}

export interface PersistRunItem {
  id: string
  title: string
  status: 'done' | 'processing' | 'failed'
  failReason?: string
  fileName?: string
}

// ---------- IndexedDB 最小封装（单 objectStore 的 keyval） ----------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch {
      res(null)
    }
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => res()
      tx.onerror = () => res() // 配额超限等：放弃持久化，不打断页面
    } catch {
      res()
    }
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => res((req.result as T) ?? null)
      req.onerror = () => res(null)
    } catch {
      res(null)
    }
  })
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => res()
      tx.onerror = () => res()
    } catch {
      res()
    }
  })
}

// ---------- 上传队列（含文件本体） ----------

function stripPreview(f: PersistFile): PersistFile {
  const { preview: _drop, ...rest } = f as PersistFile & { preview?: string }
  return rest
}

/** 保存上传队列；清单为空即清除记录。超大队列（总量 > MAX_PERSIST_TOTAL_MB）不保存 */
export async function saveQueue(uid: number | string, files: PersistFile[]): Promise<void> {
  const key = QUEUE_PREFIX + uid
  if (!files.length) {
    await idbDel(key)
    return
  }
  const totalMB = files.reduce((s, f) => s + (f.file?.size ?? 0), 0) / 1024 / 1024
  if (totalMB > MAX_PERSIST_TOTAL_MB) return // 静默跳过：超大队列宁可不恢复，也不撑爆配额
  await idbSet(key, { savedAt: Date.now(), files: files.map(stripPreview) })
}

/** 读取上传队列（预览 URL 由调用方按需重建——持久化数据里不带 dataURL / objectURL） */
export async function loadQueue(uid: number | string): Promise<PersistFile[]> {
  const rec = await idbGet<{ savedAt: number; files: PersistFile[] }>(QUEUE_PREFIX + uid)
  if (!rec || !Array.isArray(rec.files)) return []
  return rec.files.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
}

// ---------- 本次生成的纪要清单 ----------

/** 保存本次生成的多份纪要快照；items 为空即清除记录 */
export function saveRun(uid: number | string, items: PersistRunItem[], activeIdx: number): void {
  const key = RUN_PREFIX + uid
  try {
    if (!items.length) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items, activeIdx }))
  } catch {
    /* 存储不可用 / 配额：放弃 */
  }
}

export function loadRun(uid: number | string): { items: PersistRunItem[]; activeIdx: number } | null {
  try {
    const raw = localStorage.getItem(RUN_PREFIX + uid)
    if (!raw) return null
    const rec = JSON.parse(raw) as { items?: PersistRunItem[]; activeIdx?: number }
    if (!Array.isArray(rec.items) || !rec.items.length) return null
    return {
      items: rec.items.filter((x) => x && typeof x.id === 'string' && typeof x.title === 'string'),
      activeIdx: typeof rec.activeIdx === 'number' ? rec.activeIdx : 0,
    }
  } catch {
    return null
  }
}
