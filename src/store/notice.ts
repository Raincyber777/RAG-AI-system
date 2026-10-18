/**
 * 公告状态（用户端）：
 * - unreadCount  侧边栏「公告管理」角标（未读 = 已发布 ∧ 非本人发布 ∧ 无已读记录，游客恒为 0）
 * - pendingAnnouncement  登录后要弹一次的最新公告；点「我知道了」即全部已读，之后不再弹
 */
import { ref } from 'vue'
import { announcementApi, type ApiAnnouncement } from '@/api'

export const unreadCount = ref(0)
export const pendingAnnouncement = ref<ApiAnnouncement | null>(null)

export async function refreshUnread() {
  try {
    const r = await announcementApi.unread()
    unreadCount.value = r.count
    pendingAnnouncement.value = r.latest
  } catch {
    // 公告拉取失败不打扰主流程
  }
}

export async function markAllRead() {
  pendingAnnouncement.value = null
  try {
    await announcementApi.markAllRead()
  } catch {
    // 忽略：本地已先收起弹窗
  }
  unreadCount.value = 0
}
