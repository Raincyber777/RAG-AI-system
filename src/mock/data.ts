/**
 * 模拟数据：智学纪要 — 多模态课堂知识助手（前端演示用，后续替换为真实后端接口）
 * 统一管理：课堂纪要 / 追问会话 / 引用来源 / 用户
 */
import type { UploadKind } from '@/utils/uploadFormats'

// ---------- 课堂纪要 ----------
export interface KeyPoint {
  text: string
  cite: string // 引用来源，如「录音 03:24」「PPT 第2页」「板书 图1」
}

export interface Definition {
  term: string
  detail: string
  cite?: string
}

export interface ClassNote {
  id: string
  title: string
  course: string // 所属课程，如「高等数学」
  date: string
  duration: string // 录音/视频时长
  keyframes: number // 关键帧数量
  chunkCount: number // 入库知识片段数
  questions: number // 追问次数
  status: 'done' | 'processing' | 'failed'
  theme: string // 课程主题概述
  points: KeyPoint[] // 核心知识点
  definitions: Definition[] // 重要定义与公式
  emphasized: string[] // 重点问题
}

export const mockNotes: ClassNote[] = [
  {
    id: 'n1',
    title: '第12讲 泰勒展开与级数',
    course: '高等数学',
    date: '2026-10-13 10:05',
    duration: '录音 45 分钟',
    keyframes: 6,
    chunkCount: 36,
    questions: 5,
    status: 'done',
    theme:
      '本节课围绕泰勒公式与泰勒级数展开。教师首先回顾了麦克劳林公式，推导了常用函数（e^x、sin x、cos x）的展开式，随后讲解了拉格朗日余项与佩亚诺余项的区别与选用场景，最后通过三道例题演示了利用泰勒展开求极限与证明不等式的方法。',
    points: [
      { text: '泰勒公式：f(x) 在 x₀ 处 n 阶可导，可用多项式逼近，余项刻画逼近误差', cite: '录音 03:24' },
      { text: '麦克劳林公式是 x₀ = 0 的特殊情形，e^x = 1 + x + x²/2! + …', cite: 'PPT 第2页' },
      { text: '拉格朗日余项适合定性估计误差，佩亚诺余项适合求极限时的局部展开', cite: '录音 11:47' },
      { text: '利用泰勒展开求极限的关键：确定展开到几阶，让“余项 o(xⁿ)”可以忽略', cite: '录音 18:05' },
      { text: 'sin x 与 cos x 的展开只含奇/偶次幂，利用奇偶性可减少计算量', cite: 'PPT 第5页' },
      { text: '收敛半径 R 由比值判别法确定，端点处需单独讨论', cite: '录音 32:40' },
    ],
    definitions: [
      { term: '泰勒公式', detail: 'f(x) = Σ f⁽ⁿ⁾(x₀)/n! · (x-x₀)ⁿ + Rₙ(x)，其中 Rₙ 为余项', cite: 'PPT 第3页' },
      { term: '拉格朗日余项', detail: 'Rₙ(x) = f⁽ⁿ⁺¹⁾(ξ)/(n+1)! · (x-x₀)ⁿ⁺¹，ξ 介于 x₀ 与 x 之间' },
      { term: '收敛半径', detail: 'R = lim |aₙ/aₙ₊₁|，|x-x₀| < R 时级数绝对收敛' },
    ],
    emphasized: [
      '期末必考：用泰勒展开求 undefined 型极限，至少展开到分母的最高阶',
      '拉格朗日余项中 ξ 的存在性证明是去年真题，注意中值定理的条件',
      '公式不用背全表，记住 e^x、sin x、cos x、ln(1+x)、(1+x)^α 五个即可推导其余',
    ],
  },
  {
    id: 'n2',
    title: '第5讲 进程与线程',
    course: '操作系统',
    date: '2026-10-12 14:20',
    duration: '视频 12 分钟',
    keyframes: 9,
    chunkCount: 28,
    questions: 3,
    status: 'done',
    theme:
      '本节课从“为什么要有多进程”切入，讲解了进程的概念与 PCB 组成，对比了进程与线程的资源占有关系，介绍了用户级线程与内核级线程的差异，并通过 PV 操作示例演示了进程同步的基本方法。',
    points: [
      { text: '进程 = 程序 + PCB，是资源分配的基本单位', cite: '板书 图1' },
      { text: '线程是调度执行的基本单位，同一进程内的线程共享地址空间', cite: '录音 06:12' },
      { text: '用户级线程切换不需内核介入，快但无法利用多核；内核级线程相反', cite: 'PPT 第4页' },
      { text: 'P 操作申请资源，V 操作释放资源；信号量初值表示可用资源数', cite: '录音 09:48' },
      { text: '死锁四个必要条件：互斥、占有且等待、不可抢占、循环等待', cite: '板书 图2' },
    ],
    definitions: [
      { term: 'PCB（进程控制块）', detail: '记录进程 PID、状态、程序计数器、寄存器现场、打开文件表等', cite: 'PPT 第3页' },
      { term: '信号量 S', detail: 'P(S)：S←S-1，若 S<0 阻塞；V(S)：S←S+1，若 S≤0 唤醒一个等待进程' },
    ],
    emphasized: [
      '生产者-消费者问题的 PV 操作写法期末必考，注意信号量顺序防死锁',
      '“进程是资源分配单位、线程是调度单位”这句话选择题年年考',
    ],
  },
  {
    id: 'n3',
    title: '第8讲 二叉树与遍历',
    course: '数据结构',
    date: '2026-10-09 08:00',
    duration: '录音 38 分钟',
    keyframes: 0,
    chunkCount: 24,
    questions: 1,
    status: 'done',
    theme:
      '本节课讲解了二叉树的性质与存储结构，重点推导了满二叉树与完全二叉树的编号关系，对比了先序、中序、后序、层序四种遍历方式，并演示了由先序+中序序列重建二叉树的方法。',
    points: [
      { text: 'n 个节点的完全二叉树高度为 ⌊log₂n⌋ + 1', cite: '录音 05:31' },
      { text: '先序 + 中序 可唯一确定一棵二叉树；先序 + 后序 不能', cite: '录音 15:20' },
      { text: '层序遍历借助队列实现，先序/中序/后序用栈或递归', cite: 'PPT 第6页' },
      { text: 'n₀ = n₂ + 1：叶子数与双分支节点数的恒等关系', cite: '板书 图1' },
    ],
    definitions: [
      { term: '完全二叉树', detail: '除最后一层外每层满，最后一层节点靠左排列', cite: 'PPT 第2页' },
    ],
    emphasized: ['由两种遍历序列重建二叉树的操作题每周实验必考'],
  },
  {
    id: 'n4',
    title: '第6讲 虚拟内存与页面置换',
    course: '操作系统',
    date: '2026-10-07 14:00',
    duration: '视频 15 分钟',
    keyframes: 0,
    chunkCount: 0,
    questions: 0,
    status: 'failed',
    theme: '',
    points: [],
    definitions: [],
    emphasized: [],
  },
]

// ---------- 追问会话与消息 ----------
export interface Session {
  id: string
  title: string
  group: '今天' | '昨天' | '更早'
}

export interface Citation {
  no: number
  kind: 'audio' | 'image' // 录音时间戳 / 图片来源
  mark: string // 「03:24」或「PPT 第2页」「板书 图1」
  note: string // 所属课堂纪要
  snippet: string
  score: number
}

/** 智能问答消息附件（前端演示：随消息展示名称 / 类型 / 本地预览） */
export interface ChatAttachment {
  id: string
  name: string
  kind: UploadKind
  size: string
  preview?: string // 图片附件的本地预览地址（objectURL）
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  /** RAG 生成的追问建议（回答下方可点击继续问） */
  followups?: string[]
  attachments?: ChatAttachment[]
  liked?: boolean
  disliked?: boolean
  /** 后端问答记录 id（历史消息点赞同步用；本地新发消息在回答就绪后回填） */
  qaId?: number
  time: string
}

export const initialMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: '泰勒展开求极限的时候，到底要展开到几阶？',
    time: '10:02',
  },
  {
    id: 'm2',
    role: 'assistant',
    content:
      '判断展开阶数有一个实用规则[1]：看分母——分母最高是 x³ 就把分子展开到 3 阶；如果上下阶数相同，再多展开一阶更保险。\n\n以本节课例题 2 为例：分子 e^x - 1 - x 需要展开到 x²（二阶），因为分母是 x²，此时佩亚诺余项 o(x²) 可以安全忽略[2]。\n\n另外注意：如果使用拉格朗日余项做定量误差估计，则需要保留到 n+1 阶[3]。',
    citations: [
      { no: 1, kind: 'audio', mark: '18:05', note: '第12讲 泰勒展开与级数', snippet: '老师：判断展开几阶，就看分母。分母是几次方，分子就展开到几阶，同阶的话就再多写一项，保险。', score: 0.94 },
      { no: 2, kind: 'image', mark: 'PPT 第5页', note: '第12讲 泰勒展开与级数', snippet: '例题2：lim(x→0) [e^x − 1 − x] / x²，分子展开至二阶：e^x = 1 + x + x²/2 + o(x²)', score: 0.91 },
      { no: 3, kind: 'audio', mark: '11:47', note: '第12讲 泰勒展开与级数', snippet: '老师：佩亚诺余项只能说明“是高阶无穷小”，要估计具体误差，得用拉格朗日余项，那就得带到 n+1 阶。', score: 0.87 },
    ],
    time: '10:02',
  },
]

// 新提问的演示回答
export const demoReply: { content: string; citations: Citation[] } = {
  content:
    '根据「第12讲 泰勒展开与级数」的课堂纪要，回答如下：\n\n1. 五个基础展开式必须熟记：e^x、sin x、cos x、ln(1+x)、(1+x)^α，其余都可以现场推导[1]。\n2. 教师特别强调，期末最常考的是“undefined 型极限”，解题步骤：定阶 → 展开 → 约分 → 取极限[2]。\n3. sin x 的展开只含奇次幂、cos x 只含偶次幂，利用奇偶性可以少算一半的项[3]。\n\n如果需要看例题 2 的完整板书推导，可以查看 PPT 第 5 页的原始照片。',
  citations: [
    { no: 1, kind: 'image', mark: 'PPT 第2页', note: '第12讲 泰勒展开与级数', snippet: '常用麦克劳林公式表：e^x、sin x、cos x、ln(1+x)、(1+x)^α 五个基础展开式', score: 0.93 },
    { no: 2, kind: 'audio', mark: '26:14', note: '第12讲 泰勒展开与级数', snippet: '老师：期末就考 undefined 型极限，记住四步：定阶、展开、约分、取极限，别一上来就洛必达。', score: 0.9 },
    { no: 3, kind: 'audio', mark: '20:03', note: '第12讲 泰勒展开与级数', snippet: '老师：sin x 只有奇数次项，cos x 只有偶数次项，奇偶性用好了，计算量少一半。', score: 0.88 },
  ],
}

// 课堂追问侧边栏（按课堂分组）
export function buildQaSessions(notes: ClassNote[]): Session[] {
  const sessions: Session[] = []
  for (const n of notes) {
    if (n.status !== 'done') continue
    const group = n.date.startsWith('2026-10-13') ? '今天' : n.date.startsWith('2026-10-12') ? '昨天' : '更早'
    sessions.push({ id: n.id, title: n.title, group })
  }
  return sessions
}

// ---------- 用户 ----------
export const currentUser = {
  name: '林小智',
  email: 'linxz@zhiyuan.ai',
  color: '#5645d4',
}
