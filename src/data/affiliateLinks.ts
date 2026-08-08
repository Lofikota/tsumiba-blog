export type AffiliateRisk = 'standard' | 'tax' | 'fx';

export interface AffiliateLink {
  slug: string;
  name: string;
  provider: string;
  category: 'FX' | '会計';
  destinationUrl: string;
  status: 'official' | 'affiliate' | 'pending';
  risk: AffiliateRisk;
  disclosure: string;
}

export const affiliateLinks: AffiliateLink[] = [
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
    destinationUrl: 'https://fx.dmm.com/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'dmm-cfd',
    name: 'DMM CFD',
    provider: '株式会社DMM.com証券',
    category: 'FX',
    destinationUrl: 'https://cfd.dmm.com/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'CFDには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
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
    destinationUrl: 'https://www.jfx.co.jp/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'central-tanshi-fx',
    name: 'セントラル短資FX',
    provider: 'セントラル短資FX株式会社',
    category: 'FX',
    destinationUrl: 'https://www.central-tanshifx.com/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
  {
    slug: 'fxtf',
    name: 'FXTF',
    provider: 'FXTF',
    category: 'FX',
    destinationUrl: 'https://www.fxtrade.co.jp/',
    status: 'pending',
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
    slug: 'takeru-fx-school',
    name: 'タケルFXスクール',
    provider: '一般社団法人日本FX教育機構',
    category: 'FX',
    destinationUrl: 'https://www.fxschool.or.jp/',
    status: 'pending',
    risk: 'fx',
    disclosure: 'FXには元本割れや預け入れた資金を上回る損失が発生するリスクがあります。',
  },
];

/**
 * ASP発行の成果リンクはGitへ置かない。
 * tsumiba-blog は公開GitHubリポジトリのため、成果リンクをコミットすると
 * 公開Git履歴に永久に残る。実値はビルド時に環境変数から注入する。
 *   - A8 FXTF: PUBLIC_A8_FXTF_URL
 *   - ValueCommerce GMOクリックFX: PUBLIC_VC_GMO_CLICK_FX_URL
 *   - ValueCommerce 松井FX: PUBLIC_VC_MATSUI_FX_URL
 * 未設定なら下の配列リテラルどおり status:'pending' のまま＝内部導線へ倒れる（フェイルセーフ）。
 *
 * 注意: この昇格処理を配列リテラルの中へ書かないこと。
 * scripts/quality-gate.mjs と scripts/check-affiliate-links.mjs は
 * このファイルを正規表現でテキスト解析しており（status:\s*'([^']+)'）、
 * statusを式にすると両ゲートが黙ってfxtfを認識しなくなる。
 */
const publicEnv =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env) || {};

function activateAffiliateLink(slug: string, destinationUrl: string | undefined): void {
  if (!destinationUrl) return;
  const link = affiliateLinks.find((candidate) => candidate.slug === slug);
  if (!link) return;
  link.destinationUrl = destinationUrl;
  link.status = 'affiliate';
}

activateAffiliateLink('fxtf', publicEnv.PUBLIC_A8_FXTF_URL);
activateAffiliateLink('gmo-click-fx', publicEnv.PUBLIC_VC_GMO_CLICK_FX_URL);
activateAffiliateLink('matsui-fx', publicEnv.PUBLIC_VC_MATSUI_FX_URL);

/**
 * 成果リンクを有効化する「配置ID」のallowlist。
 * status:'affiliate' でも、ここに載っていない配置のCTAは内部導線へ倒す。
 *
 * 目的: FXTFのCTAは公開27記事に33箇所ある。statusだけで制御すると
 * 提携成立と同時に33箇所が一斉に外部送客へ復帰してしまう（BIZ-FIX-ASP01 §3-2B）。
 * 実測EPCが正であることを確認するまで、1配置ずつしか増やさない。
 *
 * 命名規則: '<記事slug>:<配置>' 。GA4のイベントラベルにもこの値をそのまま使う。
 */
export const affiliatePlacementAllowlist: readonly string[] = [
  'fxtf-zero-spread:fee',
];

export function isAllowedAffiliatePlacement(placement?: string): boolean {
  return !!placement && affiliatePlacementAllowlist.includes(placement);
}

export function getAffiliateLink(slug: string): AffiliateLink | undefined {
  return affiliateLinks.find((link) => link.slug === slug);
}

export function getAffiliatePath(slug: string): string {
  return `/go/${slug}/`;
}

/**
 * 提携が成立していない案件（status:'pending'）の代替導線。
 * 2026-07-26 ASP-V02: 旧設計はFXのpendingを /go/dmm-fx/ へ逃がしていたが、
 * afbの現行サイト(SID 987784)では提携が0件で、旧サイト(981288)発行のリンクは
 * 4本がafi-bの404、残りも成果が承認され得ない状態だった。
 * 報酬が発生しない外部リンクへ送客し続けないため、代替導線は必ず自サイト内を指す。
 */
export const pendingFallbackByCategory: Record<AffiliateLink['category'], string> = {
  FX: '/blog/fx-kouza-hikaku/',
  会計: '/blog/fx-kakuteishinkoku-guide/',
};

const pendingCtaTextByCategory: Record<AffiliateLink['category'], string> = {
  FX: 'FX口座の比較条件を確認する（PR）',
  会計: '確定申告の手順を確認する（PR）',
};

export interface ResolvedAffiliateTarget {
  /** 実際にaタグへ入れるhref。pending時は自サイト内ページ。 */
  href: string;
  /** trueなら報酬が発生する外部送客ではない＝文言・rel・計測ラベルを内部導線として扱う。 */
  isPending: boolean;
  /** pending時にCTAラベルを差し替えるための文言。 */
  fallbackText: string;
}

/**
 * slugからCTAの実遷移先を解決する。
 * 外部送客になるのは「提携成立(status:'affiliate')」かつ「配置IDがallowlistにある」場合だけ。
 * どちらかを満たさなければ内部導線へ倒す。
 */
export function resolveAffiliateTarget(slug: string, placement?: string): ResolvedAffiliateTarget {
  const link = getAffiliateLink(slug);
  if (!link) {
    return { href: '/start/', isPending: true, fallbackText: 'FX口座の比較条件を確認する（PR）' };
  }
  if (link.status === 'pending' || !isAllowedAffiliatePlacement(placement)) {
    return {
      href: pendingFallbackByCategory[link.category],
      isPending: true,
      fallbackText: pendingCtaTextByCategory[link.category],
    };
  }
  return { href: getAffiliatePath(slug), isPending: false, fallbackText: '' };
}
