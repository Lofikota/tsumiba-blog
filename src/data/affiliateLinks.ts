export type AffiliateRisk = 'standard' | 'investment' | 'tax' | 'fx' | 'credit';

export interface AffiliateLink {
  slug: string;
  name: string;
  provider: string;
  category: '証券' | 'クレカ' | 'FX' | '会計';
  destinationUrl: string;
  status: 'official' | 'affiliate' | 'pending';
  risk: AffiliateRisk;
  disclosure: string;
}

export const affiliateLinks: AffiliateLink[] = [
  {
    slug: 'sbi-securities',
    name: 'SBI証券',
    provider: 'SBI証券',
    category: '証券',
    destinationUrl: 'https://www.sbi-securities.co.jp/',
    status: 'pending',
    risk: 'investment',
    disclosure: '投資には元本割れのリスクがあります。NISA口座は1人1口座です。',
  },
  {
    slug: 'rakuten-sec',
    name: '楽天証券',
    provider: '楽天証券',
    category: '証券',
    destinationUrl: 'https://www.rakuten-sec.co.jp/',
    status: 'pending',
    risk: 'investment',
    disclosure: '投資には元本割れのリスクがあります。手数料やポイント条件は変更される場合があります。',
  },
  {
    slug: 'jcb-card-w',
    name: 'JCBカードW',
    provider: 'JCB',
    category: 'クレカ',
    destinationUrl: 'https://www.jcb.co.jp/ordercard/kojin_card/os_card_w.html',
    status: 'pending',
    risk: 'credit',
    disclosure: 'クレジットカードの審査があります。年齢条件や特典条件は公式情報をご確認ください。',
  },
  {
    slug: 'smbc-gold-nl',
    name: '三井住友カード ゴールド（NL）',
    provider: '三井住友カード',
    category: 'クレカ',
    destinationUrl: 'https://www.smbc-card.com/camp/matrix/gold.jsp',
    status: 'pending',
    risk: 'credit',
    disclosure: 'クレジットカードの審査があります。年会費や特典条件は公式情報をご確認ください。',
  },
  {
    slug: 'rakuten-card',
    name: '楽天カード',
    provider: '楽天カード',
    category: 'クレカ',
    destinationUrl: 'https://www.rakuten-card.co.jp/',
    status: 'pending',
    risk: 'credit',
    disclosure: 'クレジットカードの審査があります。キャンペーン条件は変更される場合があります。',
  },
  {
    slug: 'freee',
    name: 'freee会計',
    provider: 'freee',
    category: '会計',
    destinationUrl: 'https://www.freee.co.jp/',
    status: 'pending',
    risk: 'tax',
    disclosure: '税務判断は個別事情により異なります。必要に応じて税理士等へご相談ください。',
  },
  {
    slug: 'dmm-fx',
    name: 'DMM FX',
    provider: '株式会社DMM.com証券',
    category: 'FX',
    destinationUrl: 'https://px.a8.net/svt/ejp?a8mat=3Z4OMV+ADW8OI+1WP2+6J4IA',
    status: 'affiliate',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'epos-card',
    name: 'エポスカード',
    provider: '株式会社エポスカード',
    category: 'クレカ',
    destinationUrl: 'https://px.a8.net/svt/ejp?a8mat=4B3GYE+95U5WY+38L8+BXYE9',
    status: 'affiliate',
    risk: 'credit',
    disclosure: 'クレジットカードの審査があります。年会費や特典条件は公式情報をご確認ください。',
  },
  {
    slug: 'plus500',
    name: 'Plus500証券',
    provider: 'Plus500',
    category: 'FX',
    destinationUrl: 'https://www.plus500.com/ja-JP/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FX・CFDには元本割れや損失拡大のリスクがあります。取引条件を必ずご確認ください。',
  },
  {
    slug: 'jfx',
    name: 'JFX MATRIX TRADER',
    provider: 'JFX',
    category: 'FX',
    destinationUrl: 'https://px.a8.net/svt/ejp?a8mat=4B3G6F+20MWKY+25B2+5YZ76',
    status: 'affiliate',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'fxtf',
    name: 'FXTF',
    provider: 'FXTF',
    category: 'FX',
    destinationUrl: 'https://px.a8.net/svt/ejp?a8mat=4B3G6F+24SXTE+48D0+6A4FM',
    status: 'affiliate',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'lightfx',
    name: 'LIGHT FX',
    provider: 'トレイダーズ証券',
    category: 'FX',
    destinationUrl: 'https://lightfx.jp/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'minnafx',
    name: 'みんなのFX',
    provider: 'トレイダーズ証券',
    category: 'FX',
    destinationUrl: 'https://minnafx.jp/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'sbi-fxtrade',
    name: 'SBI FXトレード',
    provider: 'SBI FXトレード',
    category: 'FX',
    destinationUrl: 'https://www.sbifxt.co.jp/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'gmo-click-fx',
    name: 'GMOクリック証券 FXネオ',
    provider: 'GMOクリック証券',
    category: 'FX',
    destinationUrl: 'https://www.click-sec.com/corp/guide/fx/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'gmo-gaika',
    name: 'GMO外貨',
    provider: 'GMOフィナンシャルホールディングス',
    category: 'FX',
    destinationUrl: 'https://www.gaikaex.com/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'matsui-fx',
    name: '松井証券 MATSUI FX',
    provider: '松井証券',
    category: 'FX',
    destinationUrl: 'https://www.matsui.co.jp/service/fx/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'smbc-card-nl',
    name: '三井住友カード（NL）',
    provider: '三井住友カード',
    category: 'クレカ',
    destinationUrl: 'https://www.smbc-card.com/nyukai/card/numbersless.jsp',
    status: 'pending',
    risk: 'credit',
    disclosure: 'クレジットカードの審査があります。年会費や特典条件は公式情報をご確認ください。',
  },
];

export function getAffiliateLink(slug: string): AffiliateLink | undefined {
  return affiliateLinks.find((link) => link.slug === slug);
}

export function getAffiliatePath(slug: string): string {
  return `/go/${slug}/`;
}
