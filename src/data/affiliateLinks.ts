export type AffiliateRisk = 'standard' | 'investment' | 'tax' | 'fx' | 'credit' | 'insurance';

export interface AffiliateLink {
  slug: string;
  name: string;
  provider: string;
  category: '証券' | 'クレカ' | 'FX' | '会計' | '保険';
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
    destinationUrl: 'https://rpx.a8.net/svt/ejp?a8mat=3Z4OMV+AEHOAA+2HOM+BW8O1&rakuten=y&a8ejpredirect=http%3A%2F%2Fhb.afl.rakuten.co.jp%2Fhgc%2F0ea62065.34400275.0ea62066.204f04c0%2Fa24040326860_3Z4OMV_AEHOAA_2HOM_BW8O1%3Fpc%3Dhttps%253A%252F%252Fwww.rakuten-card.co.jp%252Fapply%252Fcard%252F%26m%3Dhttps%253A%252F%252Fwww.rakuten-card.co.jp%252Fapply%252Fcard%252F',
    status: 'affiliate',
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
    destinationUrl: 'https://px.a8.net/svt/ejp?a8mat=3Z4OMV+ADW8OI+1WP2+6AJV6', // 2026-05-24 A8 stoplink確認。新しい有効リンク取得まで直接送客しない
    status: 'pending',
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
    destinationUrl: 'https://www.matsui.co.jp/service/fx/', // ValueCommerce承認済み(2026-05-18) → 管理画面でリンク取得後にdestinationUrlを差し替える
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
  // 保険相談（Google Ads出稿可・高単価）
  // 単価比較（2026-05-10 A8.net実測）:
  //   FPに相談 13,000円 EPC411 確定率42% ← 最優先申請
  //   保険ガーデン 10,250円 EPC157 確定率25%
  //   保険見直しラボ 10,000円 EPC29 確定率58%
  //   保険見直し本舗 15,384円 EPC66 確定率不明
  {
    slug: 'fp-soudan',
    name: 'ファイナンシャルプランナーに相談',
    provider: 'ファインドイット株式会社',
    category: '保険',
    destinationUrl: 'https://www.fp-sodan.com/',
    status: 'pending', // A8.net 承認後、destinationUrl を ASP リンクに差し替える（申請コード: s00000026218001）
    risk: 'insurance',
    disclosure: 'FP相談は無料です。提案内容はFPにより異なります。加入を強制するものではありません。',
  },
  {
    slug: 'hoken-garden',
    name: '保険の無料相談サイト「ガーデン」',
    provider: '株式会社Global8',
    category: '保険',
    destinationUrl: 'https://www.hokengarden.com/',
    status: 'pending', // A8.net 承認後、destinationUrl を ASP リンクに差し替える（申請コード: s00000020819004）
    risk: 'insurance',
    disclosure: '保険相談は無料です。相談内容や結果はFPにより異なります。',
  },
  {
    slug: 'hoken-minaoshi-labo',
    name: '保険見直しラボ',
    provider: '保険見直しラボ',
    category: '保険',
    destinationUrl: 'https://www.hoken-minaoshi-lab.jp/',
    status: 'pending', // A8.net 承認後、destinationUrl を ASP リンクに差し替える（申請コード: s00000017791001）
    risk: 'insurance',
    disclosure: '保険相談は無料です。相談内容や結果はFPにより異なります。',
  },
  {
    slug: 'hoken-minaoshi-honpo',
    name: '保険見直し本舗',
    provider: '株式会社保険見直し本舗',
    category: '保険',
    destinationUrl: 'https://www.hoken-minaoshi.jp/',
    status: 'pending', // A8.net 承認後、destinationUrl を ASP リンクに差し替える（申請コード: s00000027364001）
    risk: 'insurance',
    disclosure: '保険相談は無料です。相談内容や結果はFPにより異なります。',
  },
  // afb 即時承認済み（2026-05-24）
  {
    slug: 'takeru-fx-school',
    name: 'タケルFXスクール',
    provider: '一般社団法人日本FX教育機構',
    category: 'FX',
    destinationUrl: 'https://t.afi-b.com/visit.php?a=p15610g-L506779T&p=B9812887',
    status: 'affiliate',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'hoken-shop-mammoth',
    name: '保険ショップマンモス',
    provider: '保険マンモス株式会社',
    category: '保険',
    destinationUrl: 'https://t.afi-b.com/visit.php?a=V81872-3274407P&p=B9812887',
    status: 'affiliate',
    risk: 'insurance',
    disclosure: '保険相談は無料です。相談内容や結果は担当者により異なります。',
  },
  {
    slug: 'minna-seimei',
    name: 'みんなの生命保険アドバイザー',
    provider: 'パワープランニング株式会社',
    category: '保険',
    destinationUrl: 'https://t.afi-b.com/visit.php?a=H17944-K58279T&p=B9812887',
    status: 'affiliate',
    risk: 'insurance',
    disclosure: 'FP相談は無料です。提案内容はFPにより異なります。加入を強制するものではありません。',
  },
  {
    slug: 'nenkin-garden',
    name: '年金・貯蓄の無料相談サイト「ガーデン」',
    provider: '株式会社Global8',
    category: '保険',
    destinationUrl: 'https://t.afi-b.com/visit.php?a=X14272H-D468442l&p=B9812887',
    status: 'affiliate',
    risk: 'insurance',
    disclosure: '保険相談は無料です。相談内容や結果はFPにより異なります。',
  },
];

export function getAffiliateLink(slug: string): AffiliateLink | undefined {
  return affiliateLinks.find((link) => link.slug === slug);
}

export function getAffiliatePath(slug: string): string {
  return `/go/${slug}/`;
}
