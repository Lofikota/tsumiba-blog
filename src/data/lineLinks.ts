export interface LineRef {
  ref: string;
  label: string;
  source: 'x' | 'blog' | 'lp' | 'campaign' | 'line_menu' | 'direct';
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
    description: '年会費、還元率、キャンペーン条件を見返しやすくまとめて届けます。最初の送客先は三井住友カードゴールド（NL）を優先します。',
  },
  {
    ref: 'blog-fx-roundup',
    label: 'ブログ FX記事CTA',
    source: 'blog',
    intent: 'fx',
    headline: '口座を開く前に3分だけ確認してほしいこと',
    description: 'DMM FX → JFX → FXTFの順で、比較ポイント、初心者が見落としやすい条件、開設後に最初にやることを整理して届けます。「開いてから気づいた」をなくすためのチェックリストです。',
  },
  {
    ref: 'lp-manga-main',
    label: '漫画LP',
    source: 'lp',
    intent: 'general',
    headline: '失敗しない順番を整理するLINE',
    description: '副業・FX・保険のどこから始めるべきか、7日間で順番に整理して届けます。',
  },
  {
    ref: 'lp-fx-main',
    label: 'FX特化LP',
    source: 'lp',
    intent: 'fx',
    headline: 'FX口座を作る前に3分だけ確認するLINE',
    description: '特典額だけで選んで失敗しないように、DMM FX → JFX → FXTFの順で条件、リスク、見るポイントを整理して届けます。',
  },
  {
    ref: 'campaign-dmm-fx',
    label: '案件 DMM FX',
    source: 'campaign',
    intent: 'campaign',
    headline: 'DMM FXの条件を先に整理するLINE',
    description: '最初の比較先として、口座開設条件、スプレッド、初心者が迷いやすい点を短く整理します。',
  },
  {
    ref: 'campaign-jfx',
    label: '案件 JFX',
    source: 'campaign',
    intent: 'campaign',
    headline: 'JFXを見る前に条件を整理するLINE',
    description: '2番目の比較先として、短期売買向きか、ツールの使いやすさ、取引条件を先に見直します。',
  },
  {
    ref: 'campaign-fxtf',
    label: '案件 FXTF',
    source: 'campaign',
    intent: 'campaign',
    headline: 'FXTFの迷いを先に潰すLINE',
    description: '3番目の比較先として、スプレッド、手数料、商品幅を見てから判断したい人向けです。',
  },
  {
    ref: 'campaign-smbc-gold-nl',
    label: '案件 三井住友カードゴールド（NL）',
    source: 'campaign',
    intent: 'card',
    headline: '三井住友カードゴールド（NL）の条件を整理するLINE',
    description: '年会費実質無料の条件、NISA積立との相性、申し込む前に見るポイントを先に整理します。',
  },
  {
    ref: 'campaign-epos-card',
    label: '案件 エポスカード',
    source: 'campaign',
    intent: 'campaign',
    headline: 'エポスカードの条件を整理するLINE',
    description: '年会費、ポイントの使い道、普段使いしやすさを先に確認します。',
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
