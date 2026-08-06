#!/usr/bin/env node
/**
 * FXTFのゼロスプレッド訴求に建玉連動手数料が併記されているかを検査する。
 *
 * 根拠（AI運用/データ正本/brokers_2026-07-12.yaml）:
 *   「ゼロスプレッドは恒常サービスだが建玉連動手数料あり
 *    （スプレッド0でもコストゼロではない。記事で「0銭」と書く場合は手数料併記必須）」
 * 判定単位（AI運用/FXTF広告改善案_2026-07-26.md）:
 *   「『ゼロスプレッド』は、対象時間・原則固定の例外・建玉連動手数料を同じ表示単位で併記する」
 *
 * ＝ 併記の有無は「同じ表示単位」で判定する。表示単位は空行で区切られたブロック
 *   （1つの段落 / 1つの表 / 1つのCTAコンポーネント）とみなす。
 *   読者が離れた場所の注記を読む前提には立たない。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'blog');

/** ゼロスプレッド訴求とみなす表現。0.2銭のような他社の実数値は訴求ではないので除く */
const CLAIM = /ゼロスプレッド|ゼロスプ(?:コース|口座)|スプレッドゼロ|スプレッドが?0(?!\.[1-9]|[-0-9])|0\.0銭|0\.0pips/;
/**
 * 併記の判定は2段階にする。
 * FEE  = 必須ライン。手数料の存在が読者に伝わるか（afbガイドライン・景表法の最低条件）
 * EXACT= 品質ライン。改善案が求める正確な用語になっているか
 */
const FEE = /手数料/;
const EXACT = /建玉(?:連動|数量)/;
/** FXTF文脈の判定 */
const FXTF = /FXTF|ゴールデンウェイ/i;

/** MDXのリンク記法は語を分断する（建玉連動[手数料](/blog/…)）ので表示テキストへ戻してから判定する */
const flatten = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/**
 * 訴求として扱わない行。
 * いずれも読者に対する便益の主張ではなく、ナビゲーション・機械可読フィールド・出典のため。
 */
const isNonClaim = (line) => {
  const t = line.trim();
  return (
    /^target_kw:/.test(t) ||          // frontmatterのKWフィールド（非表示）
    /^#{1,6}\s/.test(t) ||            // 見出し（直後の本文で併記されるべきで、見出し自体は訴求単位ではない）
    /^-?\s*\[?[^[\]]*\]?\(?\/blog\//.test(t) || // 関連記事リンク（他記事のタイトルであり自記事の訴求ではない）
    /https?:\/\//.test(t)             // 出典行
  );
};

const results = [];

for (const file of readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mdx')).sort()) {
  const raw = readFileSync(join(BLOG_DIR, file), 'utf8');
  const source = raw.split('\n');           // 除外判定はリンク記法が残った原文で行う
  const lines = source.map(flatten);        // 語のマッチは表示テキストで行う
  const draft = /^draft:\s*true/m.test(raw);

  // 空行で表示単位（ブロック）に切る
  const blocks = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].trim() === '') {
      if (i > start) blocks.push({ start, lines: lines.slice(start, i) });
      start = i + 1;
    }
  }

  for (const block of blocks) {
    const text = block.lines.join('\n');
    if (!FXTF.test(text)) continue;

    const claimLines = block.lines
      .map((l, k) => ({ l, no: block.start + k + 1 }))
      .filter(({ l, no }) => CLAIM.test(l) && !isNonClaim(source[no - 1]));
    if (claimLines.length === 0) continue;

    results.push({
      file,
      draft,
      line: claimLines[0].no,
      ok: FEE.test(text),
      exact: EXACT.test(text),
      text: claimLines[0].l.trim().slice(0, 150),
    });
  }
}

const ng = results.filter((r) => !r.ok);
const vague = results.filter((r) => r.ok && !r.exact);
for (const r of ng) {
  console.log(`NG    ${r.draft ? '[draft]' : '[公開] '} ${r.file}:${r.line}  ${r.text}`);
}
for (const r of vague) {
  console.log(`VAGUE ${r.draft ? '[draft]' : '[公開] '} ${r.file}:${r.line}  ${r.text}`);
}
console.log(`\n--- 訴求ブロック ${results.length} / 併記なし(NG) ${ng.length} / 併記ありだが用語が曖昧(VAGUE) ${vague.length} ---`);
console.log(`NGファイル(${new Set(ng.map((r) => r.file)).size}): ${[...new Set(ng.map((r) => r.file))].join(', ') || 'なし'}`);

process.exit(ng.length === 0 ? 0 : 1);
