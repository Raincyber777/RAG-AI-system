/**
 * 模拟数据（前端演示用，后续可替换为真实后端接口）
 * 统一管理：会话 / 消息 / 引用来源 / 文档 / 知识空间 / 统计 / 历史 / 反馈
 */

// ---------- 知识空间 ----------
export interface Space {
  id: string
  name: string
  desc: string
  docCount: number
  vectorCount: number
}

export const spaces: Space[] = [
  { id: 'sp1', name: '技术文档', desc: '平台架构、API 手册与开发规范', docCount: 46, vectorCount: 12840 },
  { id: 'sp2', name: '公司规章', desc: '人事制度、考勤与报销流程', docCount: 18, vectorCount: 4210 },
  { id: 'sp3', name: '产品手册', desc: '产品使用说明与常见问题', docCount: 32, vectorCount: 8650 },
  { id: 'sp4', name: '项目资料', desc: '项目立项与评审材料', docCount: 12, vectorCount: 3060 },
]

// ---------- 文档 ----------
export interface Doc {
  id: string
  name: string
  space: string
  type: string
  size: string
  chunks: number
  status: 'queued' | 'parsing' | 'vectorizing' | 'done' | 'failed'
  time: string
}

export const statusText: Record<Doc['status'], string> = {
  queued: '排队中',
  parsing: '正在切片',
  vectorizing: '向量化中',
  done: '解析完成',
  failed: '解析失败',
}

export const docs: Doc[] = [
  { id: 'd1', name: 'RAG系统架构设计说明书_v3.pdf', space: '技术文档', type: 'PDF', size: '4.2 MB', chunks: 128, status: 'done', time: '2026-10-11 14:20' },
  { id: 'd2', name: '员工考勤管理制度.docx', space: '公司规章', type: 'Word', size: '860 KB', chunks: 42, status: 'done', time: '2026-10-11 10:05' },
  { id: 'd3', name: '向量数据库选型对比.md', space: '技术文档', type: 'Markdown', size: '56 KB', chunks: 18, status: 'vectorizing', time: '2026-10-12 09:41' },
  { id: 'd4', name: '智能问答产品白皮书.pdf', space: '产品手册', type: 'PDF', size: '6.8 MB', chunks: 210, status: 'parsing', time: '2026-10-12 09:30' },
  { id: 'd5', name: '2026秋招入职指南.pdf', space: '公司规章', type: 'PDF', size: '1.9 MB', chunks: 0, status: 'queued', time: '2026-10-12 09:52' },
  { id: 'd6', name: '传智杯评审细则（扫描版）.pdf', space: '项目资料', type: 'PDF', size: '3.1 MB', chunks: 0, status: 'failed', time: '2026-10-10 16:44' },
  { id: 'd7', name: 'Embedding模型性能测试报告.docx', space: '技术文档', type: 'Word', size: '1.2 MB', chunks: 64, status: 'done', time: '2026-10-09 11:12' },
  { id: 'd8', name: '产品FAQ常见问题汇总.md', space: '产品手册', type: 'Markdown', size: '88 KB', chunks: 96, status: 'done', time: '2026-10-08 15:30' },
]

// ---------- 会话 ----------
export interface Session {
  id: string
  title: string
  group: '今天' | '昨天' | '更早'
}

export const sessions: Session[] = [
  { id: 's1', title: 'RAG 检索增强生成的核心原理', group: '今天' },
  { id: 's2', title: '新员工报销流程怎么走', group: '今天' },
  { id: 's3', title: '向量数据库 Milvus vs Qdrant', group: '昨天' },
  { id: 's4', title: '年假天数与请假规则', group: '昨天' },
  { id: 's5', title: '系统响应慢如何排查', group: '更早' },
]

// ---------- 消息与引用 ----------
export interface Citation {
  no: number
  doc: string
  space: string
  chunk: string
  score: number
  snippet: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  liked?: boolean
  disliked?: boolean
  time: string
}

export const initialMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'RAG 系统相比直接使用大模型回答，核心优势是什么？',
    time: '10:02',
  },
  {
    id: 'm2',
    role: 'assistant',
    content:
      'RAG（检索增强生成）系统的核心优势在于让模型"开卷考试"，主要体现在三个方面：\n\n1. 知识可更新：无需重新训练模型，只需更新知识库文档即可让 AI 掌握最新内容[1]。\n2. 答案可溯源：每条回答都能标注其依据的文档片段，大幅降低模型幻觉，实现"有据可查"[2]。\n3. 数据更安全：企业私有知识留在本地知识库中，不必进入模型训练集，权限可控[1][3]。\n\n简而言之，RAG = 检索（从知识库找相关片段）+ 生成（把片段交给大模型组织成答案），是企业落地大模型应用性价比最高的方案。',
    citations: [
      { no: 1, doc: 'RAG系统架构设计说明书_v3.pdf', space: '技术文档', chunk: 'chunk_012 · 第1章', score: 0.94, snippet: '检索增强生成（RAG）通过外挂知识库方式，将最新文档切片向量化后存入向量库，推理时先检索后生成，无需重新训练模型即可更新知识。' },
      { no: 2, doc: '智能问答产品白皮书.pdf', space: '产品手册', chunk: 'chunk_087 · 2.3节', score: 0.91, snippet: '系统在生成答案时同步返回引用来源，用户可点击溯源卡片查看原文片段，有效抑制大模型幻觉问题，提升答案可信度。' },
      { no: 3, doc: 'Embedding模型性能测试报告.docx', space: '技术文档', chunk: 'chunk_021 · 实验设置', score: 0.85, snippet: '私有文档仅在本地向量库中存储，不参与模型训练，通过权限隔离保障企业数据安全。' },
    ],
    time: '10:02',
  },
]

// 新提问的演示回答
export const demoReply = {
  content:
    '根据知识库中的资料，为您总结如下：\n\n1. 文档上传后会经历「解析切片 → 向量化 → 入库」三个阶段，切片策略默认按 512 token 滑动窗口并保留 10% 重叠[1]。\n2. 检索阶段采用混合检索：向量语义检索 + BM25 关键词检索，再经重排序模型精排，取 Top-K 片段进入上下文[2]。\n3. 生成阶段将检索片段与问题一同交给大模型，并要求答案标注引用编号，保证可追溯[1]。\n\n如果您想调整回答风格，可以在「个人设置 → RAG 参数调优」中修改参考文档数量与引用严格度。',
  citations: [
    { no: 1, doc: 'RAG系统架构设计说明书_v3.pdf', space: '技术文档', chunk: 'chunk_034 · 第3章', score: 0.93, snippet: '系统默认按 512 token 滑动窗口切片，相邻切片保留 10% 上下文重叠，兼顾召回率与向量库存储成本。' },
    { no: 2, doc: '向量数据库选型对比.md', space: '技术文档', chunk: 'chunk_007 · 混合检索', score: 0.89, snippet: '推荐采用向量检索与 BM25 关键词检索并行的混合方案，配合交叉编码器重排序，Top-5 精度较纯向量检索提升 12.6%。' },
  ],
}

// ---------- 问答历史 ----------
export interface HistoryItem {
  id: string
  question: string
  answer: string
  space: string
  sources: string[]
  time: string
}

export const historyItems: HistoryItem[] = [
  { id: 'h1', question: 'RAG 系统相比直接使用大模型回答，核心优势是什么？', answer: 'RAG 的核心优势在于知识可更新、答案可溯源、数据更安全……', space: '技术文档', sources: ['RAG系统架构设计说明书_v3.pdf', '智能问答产品白皮书.pdf'], time: '2026-10-12 10:02' },
  { id: 'h2', question: '出差报销的流程和所需材料有哪些？', answer: '出差报销需在 OA 系统提交差旅报销单，附行程单、发票原件……', space: '公司规章', sources: ['员工考勤管理制度.docx', '财务报销操作手册.pdf'], time: '2026-10-12 09:15' },
  { id: 'h3', question: 'Milvus 和 Qdrant 在百万级向量下的性能差异？', answer: '测试数据显示，百万级向量下 Milvus 的 QPS 更高，Qdrant 内存占用更低……', space: '技术文档', sources: ['向量数据库选型对比.md', 'Embedding模型性能测试报告.docx'], time: '2026-10-11 17:40' },
  { id: 'h4', question: '年假有几天？未休完的年假怎么处理？', answer: '入职满 1 年享有 5 天年假，满 10 年 10 天；未休完可在次年 Q1 补休……', space: '公司规章', sources: ['员工考勤管理制度.docx'], time: '2026-10-11 11:23' },
  { id: 'h5', question: '系统响应慢应该如何排查？', answer: '建议依次检查：向量库负载、Embedding 服务延迟、大模型接口限流……', space: '技术文档', sources: ['RAG系统架构设计说明书_v3.pdf'], time: '2026-10-10 15:08' },
  { id: 'h6', question: '产品支持哪些文件格式的上传？', answer: '当前支持 PDF / Word / Markdown / TXT，扫描件需开启 OCR 解析……', space: '产品手册', sources: ['产品FAQ常见问题汇总.md'], time: '2026-10-10 09:47' },
]

// ---------- 反馈 ----------
export interface FeedbackItem {
  id: string
  type: string
  title: string
  desc: string
  status: 'pending' | 'processing' | 'resolved'
  time: string
}

export const feedbackStatusText: Record<FeedbackItem['status'], string> = {
  pending: '已提交',
  processing: '处理中',
  resolved: '已解决',
}

export const myFeedbacks: FeedbackItem[] = [
  { id: 'f1', type: '功能异常', title: '扫描版 PDF 解析失败', desc: '上传扫描版 PDF 后提示"解析失败"，希望支持 OCR。', status: 'processing', time: '2026-10-11 16:20' },
  { id: 'f2', type: '体验建议', title: '希望支持导出对话记录', desc: '建议增加将整段会话导出为 Markdown 的功能。', status: 'resolved', time: '2026-10-09 10:05' },
]

// ---------- 用户 ----------
export const currentUser = {
  name: '林小智',
  email: 'linxz@zhiyuan.ai',
  color: '#5645d4',
}
