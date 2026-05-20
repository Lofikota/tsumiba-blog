export const CATEGORIES: Record<string, { slug: string; label: string; description: string }> = {
  'FX・外貨': {
    slug: 'fx',
    label: 'FX・外貨',
    description: 'FX口座の選び方・比較・レビュー。初心者が知っておくべきリスクと始め方を解説します。',
  },
  'NISA・投資': {
    slug: 'nisa',
    label: 'NISA・投資',
    description: 'つみたてNISA・新NISA・iDeCoの始め方から証券口座比較まで、資産形成の基礎を解説。',
  },
  '副業・節税': {
    slug: 'fukugyo',
    label: '副業・節税',
    description: '在宅副業・確定申告・節税の実践情報。田中蓮が実際にやってみた方法をまとめています。',
  },
  '保険': {
    slug: 'hoken',
    label: '保険',
    description: '保険の見直し・選び方・FP相談の活用方法。無駄な保険料を減らすための実践情報。',
  },
  'お得情報': {
    slug: 'otoku',
    label: 'お得情報',
    description: 'クレジットカード・ポイ活・キャンペーン情報。日常のお得を賢く活用する方法。',
  },
  '投資・資産運用': {
    slug: 'toshi',
    label: '投資・資産運用',
    description: '株式投資・投資信託・証券口座の選び方など、資産運用の基礎知識を解説。',
  },
  'クレジットカード': {
    slug: 'credit-card',
    label: 'クレジットカード',
    description: 'クレジットカードの選び方・比較・ポイント活用術。',
  },
  '家計・節約': {
    slug: 'kakei',
    label: '家計・節約',
    description: '家計管理・節約術・固定費の見直し方法。',
  },
};

// slug → カテゴリ名の逆引き
export const SLUG_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORIES).map(([cat, { slug }]) => [slug, cat])
);
