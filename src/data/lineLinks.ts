export interface LineRef {
  ref: string;
  label: string;
  source: 'x' | 'blog' | 'lp' | 'line_menu' | 'direct';
  intent: 'general' | 'nisa' | 'tax' | 'card' | 'campaign' | 'fx';
  headline: string;
  description: string;
}

export const lineOfficial = {
  accountId: '@610htila',
  addFriendUrl: 'https://line.me/R/ti/p/@610htila',
  harnessAuthBaseUrl: import.meta.env.PUBLIC_LINE_HARNESS_AUTH_BASE_URL || '',
};

export const lineRefs: LineRef[] = [
  {
    ref: 'blog-main',
    label: 'ブログ共通',
    source: 'blog',
    intent: 'general',
    headline: 'ブログで読んだ内容をLINEで整理する',
    description: '記事の続きや悩み別の見返し方を、テーマごとにまとめて受け取れます。',
  },
  {
    ref: 'x-profile-main',
    label: 'Xプロフィール常設',
    source: 'x',
    intent: 'general',
    headline: 'お金の設定ミスを減らすLINE',
    description: 'NISA、副業税金、クレカ、キャンペーン条件を悩み別に整理して届けます。',
  },
  {
    ref: 'x-post-nisa',
    label: 'X投稿 NISA',
    source: 'x',
    intent: 'nisa',
    headline: 'NISA・証券口座の設定を整理するLINE',
    description: '口座選び、積立設定、ポイント条件を確認する入口です。',
  },
  {
    ref: 'x-post-tax',
    label: 'X投稿 副業税金',
    source: 'x',
    intent: 'tax',
    headline: '副業収入の税金・確定申告を整理するLINE',
    description: '青色申告、経費、iDeCo、ふるさと納税の確認順を届けます。',
  },
  {
    ref: 'x-post-campaign',
    label: 'X投稿 キャンペーン',
    source: 'x',
    intent: 'campaign',
    headline: 'キャンペーン条件を見落とさないLINE',
    description: '特典額だけでなく、対象者、入金、取引条件、期限を整理します。',
  },
  {
    ref: 'blog-nisa-mistake',
    label: 'ブログ NISA記事CTA',
    source: 'blog',
    intent: 'nisa',
    headline: 'NISA設定をあとで見返せるLINE',
    description: '記事で読んだ内容を、LINEで悩み別に復習できます。',
  },
  {
    ref: 'blog-tax-basic',
    label: 'ブログ 副業税金記事CTA',
    source: 'blog',
    intent: 'tax',
    headline: '副業税金のチェックをLINEで続ける',
    description: '確定申告前に見るべき項目を整理して届けます。',
  },
  {
    ref: 'blog-card-roundup',
    label: 'ブログ クレカ記事CTA',
    source: 'blog',
    intent: 'card',
    headline: 'クレカ・ポイントの条件をLINEで整理する',
    description: '年会費、還元率、キャンペーン条件を見返しやすくまとめて届けます。',
  },
  {
    ref: 'blog-fx-roundup',
    label: 'ブログ FX記事CTA',
    source: 'blog',
    intent: 'fx',
    headline: 'FXの口座比較をLINEで整理する',
    description: 'スプレッド、スワップ、口座開設条件の見直しポイントを受け取れます。',
  },
  {
    ref: 'lp-manga-main',
    label: '漫画LP',
    source: 'lp',
    intent: 'general',
    headline: '蓮の失敗談から学ぶお金のLINE',
    description: '借金、家計、副業、資産形成の失敗をもとに、判断材料を届けます。',
  },
];

export function getLineAddUrl(ref?: string): string {
  if (lineOfficial.harnessAuthBaseUrl && ref) {
    const url = new URL(lineOfficial.harnessAuthBaseUrl);
    url.searchParams.set('ref', ref);
    return url.toString();
  }

  return lineOfficial.addFriendUrl;
}

export function getLineRefForArticle(slug: string, category: string): string {
  const normalizedSlug = slug.toLowerCase();

  if (normalizedSlug.includes('fx') || category === 'FX・外貨') {
    return 'blog-fx-roundup';
  }

  if (normalizedSlug.includes('card') || normalizedSlug.includes('epos') || normalizedSlug.includes('sbi-rakuten') || category === 'お得情報') {
    return 'blog-card-roundup';
  }

  if (normalizedSlug.includes('zeikin') || normalizedSlug.includes('tax') || category === '副業・節税') {
    return 'blog-tax-basic';
  }

  if (normalizedSlug.includes('nisa') || category === 'NISA・投資') {
    return 'blog-nisa-mistake';
  }

  return 'blog-main';
}

export function getLineRef(ref: string): LineRef | undefined {
  return lineRefs.find((item) => item.ref === ref);
}
