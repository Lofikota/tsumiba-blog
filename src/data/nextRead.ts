// 「次に読む」1本指定（リベ大型・正本: ブログ視認性デザイン基準_リベ大型.md 原則7）
// 記事の出口に次の一歩を必ず1つ置く。動線は /start/ の7ステップ順序＝収益導線（比較→開設）に合わせる。
// マップに無い記事はロードマップ（/start/）へ戻す。

export interface NextRead {
  href: string;
  label: string;
  note: string;
}

const NEXT_READ_MAP: Record<string, NextRead> = {
  // 7ステップの学習順序どおりに次へ送る
  'fx-shoshinsha-guide': { href: '/blog/fx-leverage-risk-guide/', label: 'FXのレバレッジとリスクを確認する', note: 'STEP2 リスクを先に知る' },
  'fx-yametoke-reason': { href: '/blog/fx-leverage-risk-guide/', label: 'レバレッジとリスク管理を確認する', note: 'STEP2 リスクを先に知る' },
  'fx-leverage-risk-guide': { href: '/blog/fx-kouza-hikaku/', label: 'FX口座を比較して選ぶ', note: 'STEP3 口座を選ぶ' },
  'fx-kouza-hikaku': { href: '/blog/fx-kouza-kaishi-tejun/', label: '口座開設の手順を確認する', note: 'STEP4 口座を開設する' },
  'fx-osusume-ranking': { href: '/blog/fx-kouza-hikaku/', label: '比較表で条件を最終確認する', note: 'STEP3 口座を選ぶ' },
  'fx-spread-hikaku': { href: '/blog/fx-kouza-hikaku/', label: 'FX口座比較の総合版を見る', note: 'STEP3 口座を選ぶ' },
  'fx-swap-hikaku': { href: '/blog/fx-kouza-hikaku/', label: 'FX口座比較の総合版を見る', note: 'STEP3 口座を選ぶ' },
  'jfx-review': { href: '/blog/jfx-vs-fxtf-hikaku/', label: 'JFXとFXTFを並べて比較する', note: 'STEP3 口座を選ぶ' },
  'fxtf-review': { href: '/blog/jfx-vs-fxtf-hikaku/', label: 'JFXとFXTFを並べて比較する', note: 'STEP3 口座を選ぶ' },
  'jfx-vs-fxtf-hikaku': { href: '/blog/fx-kouza-kaishi-tejun/', label: '口座開設の手順を確認する', note: 'STEP4 口座を開設する' },
  'dmm-fx-review': { href: '/blog/fx-kouza-hikaku/', label: 'いま開設できる口座を比較する', note: 'STEP3 口座を選ぶ' },
  'fx-kouza-kaishi-tejun': { href: '/blog/fx-small-start-guide/', label: '少額スタートの方法を見る', note: 'STEP5 少額で始める' },
  'jfx-kouza-kaisetsu-tejun': { href: '/blog/fx-small-start-guide/', label: '少額スタートの方法を見る', note: 'STEP5 少額で始める' },
  'dmm-fx-kouza-kaisetsu-tejun': { href: '/blog/fx-small-start-guide/', label: '少額スタートの方法を見る', note: 'STEP5 少額で始める' },
  'fxtf-kouza-kaisetsu-tejun': { href: '/blog/fx-small-start-guide/', label: '少額スタートの方法を見る', note: 'STEP5 少額で始める' },
  'fx-kouza-campaign-hikaku': { href: '/blog/fx-kouza-kaishi-tejun/', label: '口座開設の手順を確認する', note: 'STEP4 口座を開設する' },
  'fx-small-start-guide': { href: '/blog/fx-chart-yomikata/', label: 'チャートの読み方を学ぶ', note: 'STEP6 チャートと相場を学ぶ' },
  'fx-demo-tsukaikata': { href: '/blog/fx-small-start-guide/', label: '少額のリアル取引に進む', note: 'STEP5 少額で始める' },
  'fx-demo-koza-osusume': { href: '/blog/fx-demo-tsukaikata/', label: 'デモ口座の使い方を見る', note: 'STEP5 少額で始める' },
  'fx-chart-yomikata': { href: '/blog/fx-technical-indicator/', label: 'テクニカル指標の基本を学ぶ', note: 'STEP6 チャートと相場を学ぶ' },
  'fx-technical-indicator': { href: '/blog/fx-best-time/', label: 'FXの取引時間帯の癖を知る', note: 'STEP6 チャートと相場を学ぶ' },
  'fx-best-time': { href: '/blog/fx-kakuteishinkoku-guide/', label: 'FXの税金・確定申告を確認する', note: 'STEP7 続ける・守る' },
  'fx-kakuteishinkoku-guide': { href: '/blog/fx-company-barenai/', label: '会社に知られたくない人の注意点を見る', note: 'STEP7 続ける・守る' },
  'jfx-fxtf-kakuteishinkoku': { href: '/blog/fx-company-barenai/', label: '会社に知られたくない人の注意点を見る', note: 'STEP7 続ける・守る' },
  'fx-company-barenai': { href: '/blog/fx-kouza-hikaku/', label: '口座選びに進む', note: 'STEP3 口座を選ぶ' },
  'kaigai-fx-risk': { href: '/blog/fx-kouza-hikaku/', label: '国内FX口座の比較を見る', note: 'STEP3 口座を選ぶ' },
  'kaigai-fx-vs-kokunai-fx': { href: '/blog/fx-kouza-hikaku/', label: '国内FX口座の比較を見る', note: 'STEP3 口座を選ぶ' },
};

const DEFAULT_NEXT: NextRead = {
  href: '/start/',
  label: 'FXを始める7ステップ（全体の地図に戻る）',
  note: 'はじめての方へ',
};

export function getNextRead(slug: string): NextRead {
  return NEXT_READ_MAP[slug] ?? DEFAULT_NEXT;
}
