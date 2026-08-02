/**
 * Affiliate/ ルートの解決。scripts/ 配下の共通ヘルパー。
 *
 * なぜ関数にするか:
 *   各スクリプトが AFFILIATE_ROOT を「リポジトリの1つ上」と決め打ちしていたため、
 *   git worktree（tsumiba-blog/.claude/worktrees/<name>）から実行すると
 *   .claude/worktrees/ を Affiliate ルートとみなし、AI運用/ 配下の正本を見失っていた。
 *   例外にならず existsSync が false になるだけなので、正本との突合や各種チェックが
 *   「このマシンには無い」で沈黙する＝気づけない壊れ方をする。
 *
 *   目印（AI運用/）が実在するディレクトリまで親を辿ることで、階層の深さに依存しなくなる。
 *   見つからない環境（CIなど Affiliate/ ごと存在しない）では従来どおりの解決へフォールバックし、
 *   既存の「正本が無い環境ではスキップ」の挙動を保つ。
 *
 * 初出: e00b604 fix(doctor) — ops-doctor.mjs 内の resolveAffiliateRoot() を切り出したもの。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} start 探索の起点（通常はリポジトリルート）
 * @returns {string} Affiliate/ の絶対パス
 */
export function resolveAffiliateRoot(start) {
  if (process.env.AFFILIATE_ROOT) return path.resolve(process.env.AFFILIATE_ROOT);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'AI運用'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start, '..'); // 見つからないマシンは従来どおり
    dir = parent;
  }
}
