<script setup lang="ts">
/**
 * 公告管理页（用户端 / 游客可看）：
 * 已发布公告列表 —— 标题/内容搜索、时间筛选（近 7/30/90 天）、分页（10/20/30）
 * 打开本页即视为已读：清空侧边栏角标并收起登录提醒弹窗
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import { announcementApi, type ApiAnnouncement } from '@/api'
import { markAllRead } from '@/store/notice'

// ---------- 列表加载 ----------
const items = ref<ApiAnnouncement[]>([])
const loading = ref(true)
const loadError = ref('')

onMounted(async () => {
  try {
    items.value = await announcementApi.list()
  } catch {
    loadError.value = '公告加载失败，请确认后端已启动'
  } finally {
    loading.value = false
  }
  // 浏览公告页即全部已读：角标清零、登录提醒弹窗收起
  await markAllRead()
})

// ---------- 搜索 + 时间筛选 ----------
const keyword = ref('')
const timeFilter = ref('all')
const timeOptions = [
  { label: '全部时间', value: 'all' },
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '近 90 天', value: '90' },
]

function withinDays(a: ApiAnnouncement, days: number) {
  const t = new Date(a.created_at.replace(' ', 'T')).getTime()
  return Date.now() - t <= days * 86400000
}

const filtered = computed(() =>
  items.value.filter((a) => {
    const days = Number(timeFilter.value)
    if (days && !withinDays(a, days)) return false
    const k = keyword.value.trim().toLowerCase()
    if (k && !(a.title.toLowerCase().includes(k) || a.content.toLowerCase().includes(k))) return false
    return true
  }),
)

// ---------- 分页（与其它列表页一致的 10/20/30 段选） ----------
const page = ref(1)
const pageSize = ref(10)
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, totalPages.value))
const paged = computed(() =>
  filtered.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value),
)
watch([keyword, timeFilter], () => {
  page.value = 1
})
</script>

<template>
  <div class="page">
    <header class="mb-md">
      <h1 class="h2">公告管理</h1>
      <p class="text-sm">查看平台公告与最新通知，新公告会通过侧边栏角标和登录弹窗提醒</p>
    </header>

    <section class="card card-lg">
      <!-- 搜索 + 时间筛选 -->
      <div class="toolbar">
        <div class="search-box">
          <AppIcon name="search" :size="15" />
          <input v-model="keyword" placeholder="搜索公告标题或内容" aria-label="搜索公告" />
        </div>
        <AppSelect v-model="timeFilter" :options="timeOptions" aria-label="按时间筛选" class="time-select" />
      </div>

      <!-- 加载 / 出错 / 空态 -->
      <div v-if="loading" class="state-box"><span class="spinner"></span> 正在加载公告…</div>
      <div v-else-if="loadError" class="state-box state-err" role="alert">{{ loadError }}</div>
      <div v-else-if="paged.length === 0" class="state-box state-empty">
        <AppIcon name="horn" :size="26" />
        <p>{{ keyword || timeFilter !== 'all' ? '没有符合条件的公告' : '暂无公告' }}</p>
      </div>

      <!-- 公告列表 -->
      <template v-else>
        <article v-for="a in paged" :key="a.id" class="ann-item">
          <div class="ann-head">
            <span class="ann-tag"><AppIcon name="horn" :size="12" /> 公告</span>
            <h3 class="ann-title">{{ a.title }}</h3>
            <span class="ann-time"><AppIcon name="clock" :size="12" /> {{ a.created_at }}</span>
          </div>
          <p class="ann-content">{{ a.content }}</p>
        </article>

        <div class="pager">
          <span class="pager-total">共 {{ filtered.length }} 条</span>
          <div class="pager-segs">
            <button
              v-for="n in [10, 20, 30]" :key="n" type="button"
              class="pager-seg" :class="{ active: pageSize === n }"
              @click="pageSize = n"
            >{{ n }} 条/页</button>
          </div>
          <span class="pager-page">第 {{ safePage }}/{{ totalPages }} 页</span>
          <div class="pager-btns">
            <button class="pager-btn" :disabled="safePage <= 1" aria-label="上一页" @click="page = safePage - 1">
              <AppIcon name="chevron-left" :size="15" />
            </button>
            <button class="pager-btn" :disabled="safePage >= totalPages" aria-label="下一页" @click="page = safePage + 1">
              <AppIcon name="chevron-right" :size="15" />
            </button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 880px; width: 100%; margin: 0 auto; }

/* 工具栏：搜索框 + 时间筛选 */
.toolbar { display: flex; gap: 10px; margin-bottom: 18px; }
.search-box {
  flex: 1; display: flex; align-items: center; gap: 8px;
  padding: 0 12px; height: 38px;
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-md);
  background: var(--canvas); color: var(--stone);
}
.search-box:focus-within { border-color: var(--primary); color: var(--primary); }
.search-box input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 13.5px; color: var(--ink);
}
.search-box input::placeholder { color: var(--stone); }
.time-select { width: 150px; flex-shrink: 0; }

/* 列表项 */
.ann-item {
  padding: 16px 4px; border-bottom: 1px solid var(--hairline-soft);
}
.ann-item:last-of-type { border-bottom: none; }
.ann-head { display: flex; align-items: center; gap: 10px; }
.ann-tag {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-soft); color: var(--primary);
  font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
}
.ann-title {
  flex: 1; min-width: 0; font-size: 14.5px; font-weight: 700; color: var(--ink-deep);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ann-time { flex-shrink: 0; display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--stone); }
.ann-content { font-size: 13px; line-height: 1.85; color: var(--slate); margin-top: 8px; white-space: pre-line; }

/* 加载 / 出错 / 空态 */
.state-box {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 52px 0; color: var(--steel); font-size: 13.5px;
}
.state-err { color: var(--error); }
.state-empty p { color: var(--steel); }

/* 分页条 */
.pager { display: flex; align-items: center; gap: 14px; padding-top: 16px; margin-top: 4px; border-top: 1px solid var(--hairline-soft); }
.pager-total { font-size: 12.5px; color: var(--stone); }
.pager-segs { display: flex; gap: 4px; background: var(--surface-soft); border-radius: var(--radius-sm); padding: 3px; }
.pager-seg {
  border: none; background: transparent; font-family: inherit; cursor: pointer;
  font-size: 12px; font-weight: 600; color: var(--slate); padding: 4px 10px; border-radius: 6px;
}
.pager-seg.active { background: var(--canvas); color: var(--ink); box-shadow: 0 1px 3px rgba(10, 21, 48, 0.1); }
.pager-page { margin-left: auto; font-size: 12.5px; color: var(--slate); }
.pager-btns { display: flex; gap: 6px; }
.pager-btn {
  width: 28px; height: 28px; border-radius: var(--radius-sm);
  border: 1px solid var(--hairline-strong); background: var(--canvas); color: var(--slate);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pager-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 900px) {
  .page { padding: 20px 16px; }
}
</style>
