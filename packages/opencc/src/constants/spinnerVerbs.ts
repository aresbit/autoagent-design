import { getInitialSettings } from '../utils/settings/settings.js'

export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs]
}

// Spinner verbs for loading messages
// 窦唯《高级动物》歌词词汇 - 在加载时随机显示
export const SPINNER_VERBS = [
  '矛盾中',
  '虚伪着',
  '贪婪地',
  '欺骗着',
  '幻想着',
  '疑惑中',
  '简单地',
  '善变着',
  '孤独地',
  '脆弱中',
  '忍让着',
  '气忿地',
  '复杂中',
  '讨厌着',
  '嫉妒地',
  '阴险中',
  '忧郁地',
  '麻木中',
  '势利地',
  '自私着',
  '虚荣中',
  '猜想着',
  '怀疑中',
  '忧患地',
  '伟大着',
  '渺小中',
  '可怜地',
  '潇洒中',
  '残酷地',
  '浪漫着',
  '好色中',
  '善良地',
  '博爱中',
  '诡辩着',
  '空虚中',
  '真诚地',
  '无奈中',
  '好强着',
  '无聊中',
  '思考中',
  '加载中',
]
