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
};

// slug → カテゴリ名の逆引き
export const SLUG_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORIES).map(([cat, { slug }]) => [slug, cat])
);
