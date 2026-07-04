export const CATEGORIES: Record<string, { slug: string; label: string; description: string; matchSlugs?: string[] }> = {
  'FX口座比較': {
    slug: 'fx',
    label: 'FX口座比較',
    description: 'JFX・FXTFを優先し、DMM FX・松井証券FXなども参考情報として、FX口座の条件、ツール、スプレッド、注意点を比較します。',
    matchSlugs: ['fx-kouza-hikaku', 'jfx-review', 'fxtf-review', 'dmm-fx-review', 'matsui-fx-review'],
  },
  'FX初心者ガイド': {
    slug: 'fx-beginner',
    label: 'FX初心者ガイド',
    description: 'FXを始める前に確認したい仕組み、少額スタート、レバレッジ、損失リスクを整理します。',
    matchSlugs: ['fx-shoshinsha-guide', 'fx-small-start-guide', 'fx-yametoke-reason', 'fx-company-barenai'],
  },
  'DMM FX': {
    slug: 'dmm-fx',
    label: 'DMM FX',
    description: 'DMM FXはリンク確認中です。条件、ツール、スプレッド、向いている人、申し込み前の注意点を参考情報として整理します。',
    matchSlugs: ['dmm-fx-review'],
  },
  'JFX': {
    slug: 'jfx',
    label: 'JFX',
    description: 'JFXの取引環境、ツール、短期売買との相性、初心者が見るべき注意点を整理します。',
    matchSlugs: ['jfx-review'],
  },
  'FXTF': {
    slug: 'fxtf',
    label: 'FXTF',
    description: 'FXTFの取引単位、ツール、口座条件、比較時に確認したいポイントを整理します。',
    matchSlugs: ['fxtf-review'],
  },
  'FXリスク管理': {
    slug: 'fx-risk',
    label: 'FXリスク管理',
    description: '会社員がFXを始める前に確認したいレバレッジ、損失管理、税金、勤務先への注意点を整理します。',
    matchSlugs: ['fx-leverage-risk-guide', 'fx-kakuteishinkoku-guide', 'fx-company-barenai', 'fx-yametoke-reason'],
  },
  // ── 行動動詞4分類（リベ大型・正本: ブログ視認性デザイン基準_リベ大型.md 原則2）──
  // トップ・ナビの主役はこの4分類。既存6カテゴリは記事frontmatter互換のため残す。
  '選ぶ': {
    slug: 'erabu',
    label: '選ぶ（口座比較）',
    description: 'スプレッド、取引単位、ツール、スワップを比較して、自分の取引スタイルに合うFX口座を選びます。',
    matchSlugs: ['fx-kouza-hikaku', 'fx-osusume-ranking', 'fx-spread-hikaku', 'fx-swap-hikaku', 'jfx-vs-fxtf-hikaku', 'jfx-review', 'fxtf-review', 'dmm-fx-review', 'central-tanshi-fx-review', 'fx-kasegu-koza-erabi', 'fx-tokudan-jouken'],
  },
  '始める': {
    slug: 'hajimeru',
    label: '始める（開設・少額スタート）',
    description: 'FXの仕組みの理解から、口座開設の手順、1,000通貨の少額スタート、デモ口座の使い方までを整理します。',
    matchSlugs: ['fx-shoshinsha-guide', 'fx-small-start-guide', 'fx-kouza-kaishi-tejun', 'jfx-kouza-kaisetsu-tejun', 'fx-demo-koza-osusume', 'fx-demo-tsukaikata'],
  },
  '増やす': {
    slug: 'fuyasu',
    label: '増やす（手法・ツール）',
    description: 'チャートの読み方、テクニカル指標、取引時間帯、自動売買など、取引の引き出しを増やす記事です。',
    matchSlugs: ['fx-chart-yomikata', 'fx-technical-indicator', 'fx-best-time', 'fx-dollar-yen-ugoki', 'fx-ea-jidoubai-hajimekata', 'fx-auto-trade-shoshinsha', 'jfx-matrix-trader-tsukaikata', 'fxtf-zero-spread', 'fxtf-swap-point'],
  },
  '守る': {
    slug: 'mamoru',
    label: '守る（リスク・税金）',
    description: 'レバレッジのリスク管理、損失への備え、確定申告、会社員が勤務先に知られたくない場合の注意点を整理します。',
    matchSlugs: ['fx-leverage-risk-guide', 'fx-kakuteishinkoku-guide', 'jfx-fxtf-kakuteishinkoku', 'fx-company-barenai', 'fx-yametoke-reason', 'kaigai-fx-risk', 'kaigai-fx-vs-kokunai-fx'],
  },
};

// slug → カテゴリ名の逆引き
export const SLUG_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORIES).map(([cat, { slug }]) => [slug, cat])
);
