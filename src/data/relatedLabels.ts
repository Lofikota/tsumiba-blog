// 記事末「用途ラベル付き関連リスト」のデータ（正本: ブログ視認性デザイン基準_リベ大型.md §1 #10）
// 関連記事の羅列を禁止し「▼口座を選ぶ前に／スプレッド比較：〈タイトル〉」の形式にする。
// ラベルが「なぜ今それを読むか」を担う。ラベルが無い記事は従来どおりタイトルのみ表示する
// （推測でラベルを付けない。埋めるのは人間レビュー経由）。

// RELATED_HEADING: いま読んでいる記事から見た「関連記事群をいつ読むか」
const RELATED_HEADING: Record<string, string> = {
  // 比較・ランキング → 決める直前
  'fx-kouza-hikaku': '口座を選ぶ前に',
  'fx-spread-hikaku': '口座を選ぶ前に',
  'fx-swap-hikaku': '口座を選ぶ前に',
  'fx-osusume-ranking': '口座を選ぶ前に',
  'fx-tokudan-jouken': '口座を選ぶ前に',
  'fx-kasegu-koza-erabi': '口座を選ぶ前に',
  'jfx-vs-fxtf-hikaku': '口座を選ぶ前に',
  'dmm-fx-vs-gmo-click': '口座を選ぶ前に',
  'fx-kouza-campaign-hikaku': '口座を選ぶ前に',
  'fx-kouza-fukusuu-merit': '口座を選ぶ前に',

  // 個社レビュー → その1社に決めてよいかの判断材料
  'jfx-review': '決める前に見比べる',
  'fxtf-review': '決める前に見比べる',
  'dmm-fx-review': '決める前に見比べる',
  'central-tanshi-fx-review': '決める前に見比べる',
  'forex-com-review': '決める前に見比べる',
  'gmo-click-fx-review': '決める前に見比べる',
  'matsui-fx-review': '決める前に見比べる',
  'oanda-fx-review': '決める前に見比べる',
  'rakuten-fx-review': '決める前に見比べる',
  'sbi-fx-alpha-review': '決める前に見比べる',

  // 開設手順 → 開設したあとの一歩
  'fx-kouza-kaishi-tejun': '開設したあとに読む',
  'jfx-kouza-kaisetsu-tejun': '開設したあとに読む',
  'fxtf-kouza-kaisetsu-tejun': '開設したあとに読む',
  'dmm-fx-kouza-kaisetsu-tejun': '開設したあとに読む',
  'central-tanshi-fx-kouza-kaisetsu': '開設したあとに読む',
  'fx-kouza-kaisetsu-shinsa': '開設したあとに読む',

  // 学習・練習
  'fx-shoshinsha-guide': 'あわせて学ぶ',
  'fx-chart-yomikata': 'あわせて学ぶ',
  'fx-technical-indicator': 'あわせて学ぶ',
  'fx-best-time': 'あわせて学ぶ',
  'fx-dollar-yen-ugoki': 'あわせて学ぶ',
  'fx-demo-tsukaikata': 'あわせて学ぶ',
  'fx-demo-koza-osusume': 'あわせて学ぶ',
  'fx-small-start-guide': 'あわせて学ぶ',

  // 守る（リスク・税金）
  'fx-leverage-risk-guide': '損を減らすために読む',
  'fx-loss-cut-shikumi': '損を減らすために読む',
  'fx-nanpin-risk': '損を減らすために読む',
  'fx-yametoke-reason': '損を減らすために読む',
  'fx-kakuteishinkoku-guide': '続けるために読む',
  'jfx-fxtf-kakuteishinkoku': '続けるために読む',
  'fx-company-barenai': '続けるために読む',
};

// ARTICLE_PURPOSE: リンク先の記事が「何をくれるか」＝用途ラベル
const ARTICLE_PURPOSE: Record<string, string> = {
  'central-tanshi-fx-kouza-kaisetsu': '口座開設手順',
  'central-tanshi-fx-review': '口座レビュー',
  'dmm-cfd-hajimekata': 'CFDの始め方',
  'dmm-fx-kouza-kaisetsu-tejun': '口座開設手順',
  'dmm-fx-review': '口座レビュー',
  'dmm-fx-tsukaikata': 'アプリの使い方',
  'dmm-fx-vs-gmo-click': '2社の比較',
  'forex-com-review': '口座レビュー',
  'fx-auto-trade-shoshinsha': '自動売買の判断',
  'fx-best-time': '取引時間帯',
  'fx-chart-yomikata': 'チャートの読み方',
  'fx-company-barenai': '会社バレ対策',
  'fx-demo-koza-osusume': 'デモ口座選び',
  'fx-demo-tsukaikata': 'デモ練習の手順',
  'fx-dollar-yen-ugoki': 'ドル円の値動き',
  'fx-ea-jidoubai-hajimekata': 'EAの始め方',
  'fx-funin-shotoku-genjitsu': '収益の現実',
  'fx-kakuteishinkoku-guide': '確定申告の手順',
  'fx-kasegu-koza-erabi': '口座の選び方',
  'fx-kouza-campaign-hikaku': 'キャンペーン比較',
  'fx-kouza-fukusuu-merit': '複数口座の使い分け',
  'fx-kouza-hikaku': '口座比較',
  'fx-kouza-kaisetsu-shinsa': '審査の通し方',
  'fx-kouza-kaishi-tejun': '口座開設手順',
  'fx-leverage-risk-guide': 'レバレッジとリスク',
  'fx-loss-cut-shikumi': 'ロスカットの仕組み',
  'fx-nanpin-risk': 'ナンピンのリスク',
  'fx-osusume-ranking': 'おすすめランキング',
  'fx-shoshinsha-guide': '初心者の全体像',
  'fx-small-start-guide': '少額の始め方',
  'fx-spread-hikaku': 'スプレッド比較',
  'fx-swap-hikaku': 'スワップ比較',
  'fx-technical-indicator': 'テクニカル指標',
  'fx-tokudan-jouken': '条件別の選び方',
  'fx-yametoke-reason': '始める前の注意点',
  'fxtf-cfd-hajimekata': 'CFDの始め方',
  'fxtf-knockout-option': 'ノックアウトOP',
  'fxtf-kouza-kaisetsu-tejun': '口座開設手順',
  'fxtf-review': '口座レビュー',
  'fxtf-swap-point': 'スワップの実態',
  'fxtf-zero-spread': 'ゼロスプレッド解説',
  'gmo-click-fx-review': '口座レビュー',
  'jfx-fxtf-kakuteishinkoku': '2口座の確定申告',
  'jfx-kouza-kaisetsu-tejun': '口座開設手順',
  'jfx-matrix-trader-tsukaikata': '取引ツールの使い方',
  'jfx-review': '口座レビュー',
  'jfx-vs-fxtf-hikaku': '2社の比較',
  'matsui-fx-review': '口座レビュー',
  'oanda-fx-review': '口座レビュー',
  'rakuten-fx-review': '口座レビュー',
  'sbi-fx-alpha-review': '口座レビュー',
  'takeru-fx-school-review': 'スクール評価',
};

/** 関連リストの見出し（未登録なら undefined＝従来のカテゴリ見出しにフォールバック） */
export function getRelatedHeading(slug: string): string | undefined {
  return RELATED_HEADING[slug];
}

/** リンク先記事の用途ラベル（未登録なら undefined＝ラベルなしで表示） */
export function getArticlePurpose(slug: string): string | undefined {
  return ARTICLE_PURPOSE[slug];
}
