<script setup lang="ts">
/**
 * 问答历史页：查看自己的提问记录与引用来源
 */
import { ref, computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { historyItems, spaces } from '@/mock/data'

const search = ref('')
const spaceFilter = ref<'all' | string>('all')

const list = computed(() =>
  historyItems.filter(
    (h) =>
      (spaceFilter.value === 'all' || h.space === spaceFilter.value) &&
      (h.question.includes(search.value.trim()) || h.answer.includes(search.value.trim()))
  )
)

function reAsk(q: string) {
  // 演示：携带问题跳回对话页
  history.replaceState(null, '', '/chat')
  location.href = '/chat?q=' + encodeURIComponent(q)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="h2">问答历史</h1>
        <p class="text-sm">共 {{ historyItems.length }} 条提问记录，点击可回到对话重新提问</p>
      </div>
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="search" class="search-input" placeholder="搜索历史问题" />
      </div>
    </header>

    <!-- 空间筛选 -->
    <div class="pill-tabs mb-md">
      <button class="pill-tab" :class="{ active: spaceFilter === 'all' }" @click="spaceFilter = 'all'">全部</button>
      <button
        v-for="sp in spaces"
        :key="sp.id"
        class="pill-tab"
        :class="{ active: spaceFilter === sp.name }"
        @click="spaceFilter = sp.name"
      >{{ sp.name }}</button>
    </div>

    <!-- 历史列表 -->
    <div class="list">
      <div v-for="h in list" :key="h.id" class="history-card card card-hover">
        <div class="flex items-start justify-between gap-md">
          <div class="flex-1">
            <div class="q-row">
              <span class="q-badge">问</span>
              <span class="q-text">{{ h.question }}</span>
            </div>
            <p class="a-text">{{ h.answer }}</p>
            <div class="flex items-center gap-sm flex-wrap mt-sm">
              <span class="tag tag-purple">{{ h.space }}</span>
              <span v-for="s in h.sources" :key="s" class="source-chip">
                <AppIcon name="file" :size="11" /> {{ s }}
              </span>
            </div>
          </div>
          <div class="flex-col items-end gap-xs flex-shrink-0">
            <span class="text-caption">{{ h.time }}</span>
            <button class="btn btn-ghost btn-sm" @click="reAsk(h.question)">
              <AppIcon name="refresh" :size="13" /> 再问一次
            </button>
          </div>
        </div>
      </div>

      <div v-if="!list.length" class="empty card">
        <AppIcon name="inbox" :size="30" />
        <p>没有找到匹配的记录</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 28px 32px 40px; max-width: 900px; width: 100%; margin: 0 auto; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; }
.search-box {
  display: flex; align-items: center; gap: 8px; width: 260px; padding: 0 12px; height: 40px;
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--radius-md);
  color: var(--stone);
}
.search-input { border: none; outline: none; flex: 1; font-size: 13px; background: transparent; }

.list { display: flex; flex-direction: column; gap: 12px; }
.q-row { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 8px; }
.q-badge {
  width: 22px; height: 22px; border-radius: var(--radius-xs); flex-shrink: 0;
  background: var(--primary); color: #fff; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; margin-top: 1px;
}
.q-text { font-size: 15px; font-weight: 600; line-height: 1.5; }
.a-text { font-size: 13.5px; color: var(--slate); line-height: 1.65; padding-left: 31px; }
.source-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: var(--steel); background: var(--surface);
  border: 1px solid var(--hairline); border-radius: var(--radius-full); padding: 3px 9px;
}
.empty { text-align: center; padding: 48px 0; color: var(--stone); }
.empty p { margin-top: 10px; font-size: 13px; }

@media (max-width: 720px) {
  .page { padding: 20px 16px; }
  .a-text { padding-left: 0; }
}
</style>
