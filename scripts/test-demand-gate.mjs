#!/usr/bin/env node
/**
 * 需要ゲートの回帰テスト。
 *
 * 検証するのは「実装がどう書かれているか」ではなく「なぜその判定なのか」（CLAUDE.md Rule 9）。
 * 各ケースの why は、DEMAND-G01 §5 のどの設計判断を守っているかを1行で述べる。
 * ネットワークには出ない（判定は純関数 evaluateDemandGate に隔離してある）。
 */

import { evaluateDemandGate, loadPartneredBrands, THRESHOLDS, brandOf, patternOf } from './demand-gate.mjs';

const results = [];
const check = (name, why, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, name, why, actual, expected });
};

// 判定に必要な最小の周辺状態。個別ケースで上書きする。
const base = {
  article: { slug: 'subject', targetKw: 'jfx 評判', draft: false, noindex: false },
  corpus: [{ slug: 'subject', targetKw: 'jfx 評判', draft: false, noindex: false }],
  suggestCount: 5,
  gscPositions: { subject: 12 },
  partneredBrands: ['jfx'],
  serp: null,
};
const run = over => evaluateDemandGate({ ...base, ...over });
const statusOf = (result, id) => result.checks.find(c => c.id === id)?.status;

// ── 1. G-1 は「需要が実在しないKWに記事を投下しない」ための検査 ───────────
check(
  'G-1: サジェスト1件はBLOCK',
  '検索されていない語に書いても表示は増えない。63%の無駄投下を再生産しないための唯一のBLOCK条件',
  run({ suggestCount: 1 }).verdict,
  'BLOCK',
);
check(
  'G-1: サジェスト2件は通す',
  `閾値 ${THRESHOLDS.G1_MIN_SUGGEST} をピン留めする。1と2で結果が変わらないなら閾値比較が効いていない`,
  run({ suggestCount: 2 }).verdict,
  'PASS',
);

// ── 2. 需要ゲートのFAILは「安全性の失格」ではなく「投資判断」───────────
// 安全ゲート(quality-gate)のFAILは公開不可。需要ゲートはG-1以外を止めない（§5-1の非対称）。
check(
  'G-3 FAILは公開を止めない',
  '自サイト実績が無いのは投資判断の材料であって、記事が有害という意味ではない',
  run({ gscPositions: { subject: 80 } }).verdict,
  'WARN',
);
check(
  'G-4 FAILは公開を止めない',
  '収益に直結しない集客記事は許容する設計（§5-3）。止めると内部リンクの供給元が作れなくなる',
  run({ partneredBrands: [] }).verdict,
  'WARN',
);
check(
  'G-5 FAILは公開を止めない',
  '重複は統合を要求する事象で、公開可否とは別（§5-5）',
  run({
    corpus: [...base.corpus, { slug: 'dup', targetKw: 'jfx 評判', draft: false, noindex: false }],
  }).verdict,
  'WARN',
);

// ── 3. 未取得のデータはゲートを甘い方向へ倒す（誤BLOCKを作らない）───────
// §5-4「未知ドメインは tier_open に倒す」と同じ原則を、データ欠損全般へ適用している。
check(
  'サジェスト未取得はBLOCKにしない',
  'API障害でゲートが記事を止め始めると、ゲート自体が事業の停止装置になる',
  statusOf(run({ suggestCount: null }), 'G-1'),
  'UNAVAILABLE',
);
check(
  'GSCスナップショット未取得はWARNにしない',
  '計測が無いことを「実績が無い」と読み替えない。0と未取得を混同しない（DEMAND-G01 §1-1）',
  run({ gscPositions: {} }).verdict,
  'PASS',
);
check(
  'G-2未実装の間は総合判定に影響しない',
  'SERP取得手段は人間の契約判断待ち。未実装の検査が勝手にBLOCKを増やしてはならない',
  statusOf(run({}), 'G-2'),
  'UNAVAILABLE',
);

// ── 4. G-2の差込口が「将来つないだら効く」形になっている ────────────────
check(
  'G-2にclosedRatioを渡すとBLOCKに効く',
  '入口を空けただけで配線されていなければ、有料ツールを契約しても何も変わらない',
  run({ serp: { closedRatio: 0.9 } }).verdict,
  'BLOCK',
);
check(
  'G-2は閾値未満なら通す',
  `closed_ratio ${THRESHOLDS.G2_CLOSED_RATIO} 未満＝個人が入る余地があるKW（§5-4）`,
  statusOf(run({ serp: { closedRatio: 0.8 } }), 'G-2'),
  'PASS',
);

// ── 5. G-3「同型パターン」の意味 ────────────────────────────────
// DEMAND-G01 §2-4 は fxtf-review(10.6位) を根拠に fxtf-swap-point を①勝てるへ入れた。
// つまり「同一ブランドなら型が違っても実証になる」が採用済みの推論。これを固定する。
check(
  'G-3: 同ブランドの別型記事の順位が実証になる',
  'ブランド派生語がC-OPENという実証は、レビュー記事からスワップ記事へ引き継げる（§2-4の推論）',
  statusOf(run({
    article: { slug: 'subject', targetKw: 'fxtf スワップポイント', draft: false, noindex: false },
    corpus: [
      { slug: 'subject', targetKw: 'fxtf スワップポイント', draft: false, noindex: false },
      { slug: 'fxtf-review', targetKw: 'fxtf 評判', draft: false, noindex: false },
    ],
    gscPositions: { 'fxtf-review': 10.6 },
    partneredBrands: ['fxtf'],
  }), 'G-3'),
  'PASS',
);
check(
  'G-3: 無関係なブランド・型の実績は実証にならない',
  '「どこかの記事が上位」を実証に数えると検査が常時PASSになり意味を失う',
  statusOf(run({
    article: { slug: 'subject', targetKw: 'fxtf スワップポイント', draft: false, noindex: false },
    corpus: [
      { slug: 'subject', targetKw: 'fxtf スワップポイント', draft: false, noindex: false },
      { slug: 'other', targetKw: 'fx 確定申告 やり方 会社員', draft: false, noindex: false },
    ],
    gscPositions: { other: 3 },
  }), 'G-3'),
  'FAIL',
);
check(
  'G-3: 30位ちょうどは実証・31位は不足',
  `閾値 ${THRESHOLDS.G3_MAX_POSITION} をピン留めする`,
  [statusOf(run({ gscPositions: { subject: 30 } }), 'G-3'), statusOf(run({ gscPositions: { subject: 31 } }), 'G-3')],
  ['PASS', 'FAIL'],
);
check(
  'G-3: 下書き記事は実証に数えない',
  '未公開の記事に順位実績はありえない。draftを peer に入れると実証が水増しされる',
  statusOf(run({
    corpus: [
      { slug: 'subject', targetKw: 'jfx 評判', draft: false, noindex: false },
      { slug: 'wip', targetKw: 'jfx 口座開設', draft: true, noindex: false },
    ],
    gscPositions: { wip: 5 },
  }), 'G-3'),
  'FAIL',
);

// ── 6. G-4「提携済み」の意味 ──────────────────────────────────
check(
  'G-4: 提携済みブランドのKWだけがPASS',
  'リンクを受領していることは提携中であることを証明しない（affiliate_links YAML の handling_rules）',
  [statusOf(run({ partneredBrands: ['jfx'] }), 'G-4'), statusOf(run({ partneredBrands: ['fxtf'] }), 'G-4')],
  ['PASS', 'FAIL'],
);
check(
  'G-4: 実YAMLからjfxとfxtfの両方が提携済みとして読める',
  '最初の実装は最後のプログラム(fxtf)を静かに取りこぼした。件数ではなく中身で固定する',
  loadPartneredBrands().sort(),
  ['fxtf', 'jfx'],
);

// ── 7. G-5「重複」の意味 ────────────────────────────────────
check(
  'G-5: 表記ゆれでも同一KWとして検出する',
  '全角・大小文字・空白の違いで共食いを見逃すと、統合すべき2本が両方生き残る',
  statusOf(run({
    corpus: [
      { slug: 'subject', targetKw: 'jfx 評判', draft: false, noindex: false },
      { slug: 'dup', targetKw: 'ＪＦＸ　評判', draft: false, noindex: false },
    ],
  }), 'G-5'),
  'FAIL',
);
check(
  'G-5: 下書きは重複相手に数えない',
  '未公開記事はまだ検索結果を食い合っていない',
  statusOf(run({
    corpus: [
      { slug: 'subject', targetKw: 'jfx 評判', draft: false, noindex: false },
      { slug: 'wip', targetKw: 'jfx 評判', draft: true, noindex: false },
    ],
  }), 'G-5'),
  'PASS',
);

// ── 8. 検査の対象外・入力欠落 ──────────────────────────────────
check(
  'noindex記事は需要を問わない',
  '検索評価を求めていない記事に「需要がない」と言っても意味がない（§2-7）',
  run({ article: { slug: 'subject', targetKw: 'fxtf cfd 始め方', draft: false, noindex: true }, suggestCount: 0 }).verdict,
  'SKIP',
);
check(
  'target_kw欠落はPASSではなくBLOCK',
  '入力が無い記事を素通りさせると、ゲートを付けた意味が「書き忘れれば回避できる」に変わる',
  run({ article: { slug: 'subject', targetKw: null, draft: false, noindex: false } }).verdict,
  'BLOCK',
);

// ── 9. 分類ロジックが決定論であること（モデルの主観を入れない・§5-4）─────
check(
  'ブランド判定は長い別名を優先する',
  '"dmm fx" を "dmm" より先に当てないと、別ブランドへ誤って同型判定が伝播する',
  [brandOf('dmm fx 評判'), brandOf('matrix trader 使い方'), brandOf('fx 少額 始め方')],
  ['dmm-fx', 'jfx', null],
);
check(
  '型判定は税務をhowtoより優先する',
  '"fx 確定申告 やり方" は操作手順ではなく税務クラスタ。順序が崩れると同型判定が壊れる',
  [patternOf('fx 確定申告 やり方 会社員'), patternOf('jfx 口座開設'), patternOf('fx おすすめ ランキング')],
  ['tax', 'howto', 'compare'],
);

// ── 10. 完了条件そのものの回帰 ────────────────────────────────
// DEMAND-G01 ③「需要なし」5記事の実測サジェスト件数（2026-07-26 本タスクで再取得）。
// この4件をG-1が機械的に弾けることが DEMAND-G02 の完了条件。
const DEMAND_NONE_FIXTURE = [
  { slug: 'jfx-vs-fxtf-hikaku', targetKw: 'jfx fxtf 比較', suggestCount: 0 },
  { slug: 'fx-tokudan-jouken', targetKw: 'fx 特単 条件', suggestCount: 0 },
  { slug: 'fx-demo-koza-osusume', targetKw: 'fx デモ口座 おすすめ', suggestCount: 1 },
  { slug: 'fx-kasegu-koza-erabi', targetKw: 'fx 稼ぐ 口座 選び方', suggestCount: 0 },
  { slug: 'kaigai-fx-risk', targetKw: '海外fx 出金できない', suggestCount: 2 },
];
const blockedCount = DEMAND_NONE_FIXTURE
  .filter(f => run({
    article: { slug: f.slug, targetKw: f.targetKw, draft: false, noindex: false },
    corpus: [{ slug: f.slug, targetKw: f.targetKw, draft: false, noindex: false }],
    suggestCount: f.suggestCount,
  }).verdict === 'BLOCK').length;
check(
  '③需要なし5記事のうち4件以上をG-1が弾く',
  'DEMAND-G02の完了条件。人間のSERP目視なしで、無料APIだけで需要なしを機械判定できることの実証',
  blockedCount >= 4,
  true,
);

// ── 出力 ───────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`✅ ${r.name}`);
  } else {
    failed += 1;
    console.log(`❌ ${r.name}`);
    console.log(`   why: ${r.why}`);
    console.log(`   expected: ${JSON.stringify(r.expected)}`);
    console.log(`   actual  : ${JSON.stringify(r.actual)}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} 合格`);
process.exit(failed === 0 ? 0 : 1);
