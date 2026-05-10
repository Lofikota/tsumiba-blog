#!/usr/bin/env node
/**
 * ローカル記事生成パイプライン
 * GitHub Actions なしで全工程を手元で実行する
 *
 * 使い方:
 *   node scripts/run-local.mjs           # 次の pending を1件処理
 *   node scripts/run-local.mjs --dry-run # 実際に書き込まず動作確認
 *   node scripts/run-local.mjs --no-push # 生成のみ（git push しない）
 *   node scripts/run-local.mjs --no-x    # X投稿をスキップ
 *   node scripts/run-local.mjs --no-line # LINE通知をスキップ
 *
 * 必要な環境変数 (.env に書く):
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET (X投稿する場合)
 *   LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID (LINE通知する場合)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// .env 読み込み
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of envLines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ───────────────────────────────
// 引数
// ───────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const NO_PUSH = process.argv.includes('--no-push') || DRY_RUN;
const NO_X    = process.argv.includes('--no-x');
const NO_LINE = process.argv.includes('--no-line');

if (DRY_RUN) console.log('\n[DRY-RUN モード] ファイルへの書き込みは行いません\n');

// ───────────────────────────────
// ユーティリティ
// ───────────────────────────────
function step(msg) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ ${msg}`);
  console.log('─'.repeat(50));
}

// execFileSync のラッパー（インジェクション防止：引数を配列で渡す）
function runNode(scriptFile, args = [], label) {
  step(label);
  if (DRY_RUN) {
    console.log(`[DRY] node ${scriptFile} ${args.join(' ')}`);
    return;
  }
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', scriptFile), ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    console.error(`\n❌ 失敗: ${label}`);
    process.exit(1);
  }
}

function runNpm(npmScript, label) {
  step(label);
  if (DRY_RUN) {
    console.log(`[DRY] npm run ${npmScript}`);
    return;
  }
  try {
    execFileSync('npm', ['run', npmScript], { cwd: ROOT, stdio: 'inherit', env: process.env });
  } catch {
    console.error(`\n❌ 失敗: ${label}`);
    process.exit(1);
  }
}

function runGit(args, label) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', env: process.env });
  } catch (e) {
    if (label) console.warn(`⚠️  git ${args[0]} 失敗: ${e.message}`);
    return null;
  }
}

// ───────────────────────────────
// 前提チェック
// ───────────────────────────────
step('前提チェック');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY が設定されていません');
  console.error('   .env ファイルに ANTHROPIC_API_KEY=sk-ant-... を追加してください');
  process.exit(1);
}

const queuePath = path.join(ROOT, 'data/keyword-queue.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
const pending = queue.find(q => q.status === 'pending');

if (!pending) {
  console.log('キューに pending の記事がありません。');
  console.log('node scripts/add-to-queue.mjs "キーワード" でテーマを追加してください。');
  process.exit(0);
}

console.log(`✅ 次の記事: ${pending.slug} (${pending.keyword})`);
console.log(`   タイプ: ${pending.type} / カテゴリ: ${pending.category}`);

// ───────────────────────────────
// Step 1: キュー検証
// ───────────────────────────────
runNode('validate-keyword-queue.mjs', [], 'キュー検証');

// ───────────────────────────────
// Step 2: 記事生成
// ───────────────────────────────
runNode('generate-article.mjs', [], '記事生成 (Claude API)');

// 生成後のslugを再確認
if (!DRY_RUN) {
  const updatedQueue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  const justPublished = updatedQueue.find(q => q.slug === pending.slug && q.status === 'published');
  if (!justPublished) {
    console.error('❌ 記事生成に失敗しました（キューのstatusが published になっていません）');
    process.exit(1);
  }
}

const articlePath = path.join(ROOT, `src/content/blog/${pending.slug}.mdx`);

// ───────────────────────────────
// Step 3: 内部リンク挿入
// ───────────────────────────────
runNode('internal-links.mjs', [], '内部リンク自動挿入');

// ───────────────────────────────
// Step 4: 品質チェック
// ───────────────────────────────
if (!DRY_RUN && fs.existsSync(articlePath)) {
  runNode('quality-gate.mjs', [articlePath], '品質チェック (TETSU/AKIRA)');
}

// ───────────────────────────────
// Step 5: Astro ビルド
// ───────────────────────────────
runNpm('build', 'Astro ビルド');

// ───────────────────────────────
// Step 6: git push
// ───────────────────────────────
if (NO_PUSH) {
  console.log('\n[--no-push] git push をスキップします');
} else {
  step('git コミット & プッシュ');
  if (!DRY_RUN) {
    runGit(['config', 'user.name', 'ren-bot[bot]']);
    runGit(['config', 'user.email', 'bot@ren-money.com']);
    runGit(['add', 'src/content/blog/', 'data/keyword-queue.json', 'KPI管理/automation-runs/']);

    const diff = runGit(['diff', '--staged', '--quiet']);
    if (diff === '') {
      console.log('変更なし（既にコミット済み）');
    } else {
      runGit(['commit', '-m', `feat(auto): 記事自動生成 ${pending.slug}`], 'commit');
      const pushed = runGit(['push'], 'push');
      if (pushed !== null) {
        console.log(`✅ プッシュ完了: ${pending.slug}`);
      } else {
        console.warn('⚠️  git push に失敗しました。手動でプッシュしてください:');
        console.warn('   cd /Users/kudokota/Affiliate/ren-blog- && git push');
      }
    }
  }
}

// ───────────────────────────────
// Step 7: X 投稿
// ───────────────────────────────
if (NO_X || !process.env.X_API_KEY) {
  console.log('\n[スキップ] X投稿 (X_API_KEY が未設定またはフラグあり)');
} else {
  runNode('auto-post-x.mjs', ['--slug', pending.slug], 'X 投稿 (MAKO)');
  runNode('generate-x-stock.mjs', ['--slug', pending.slug], 'X 投稿ストック生成');
}

// ───────────────────────────────
// Step 8: LINE 通知
// ───────────────────────────────
if (NO_LINE || !process.env.LINE_CHANNEL_ACCESS_TOKEN) {
  console.log('\n[スキップ] LINE通知 (LINE_CHANNEL_ACCESS_TOKEN が未設定またはフラグあり)');
} else {
  const charCount = DRY_RUN ? '0' : String(fs.readFileSync(articlePath, 'utf-8').length);
  runNode('notify-line.mjs', ['--type', 'publish', '--slug', pending.slug, '--chars', charCount], 'LINE 通知');
}

// ───────────────────────────────
// 完了サマリー
// ───────────────────────────────
console.log('\n');
console.log('═'.repeat(50));
console.log('✅ パイプライン完了');
console.log(`   記事: src/content/blog/${pending.slug}.mdx`);
console.log(`   URL : https://ren-money.com/blog/${pending.slug}/`);
console.log('═'.repeat(50));
console.log('\n次のアクション:');
console.log('  ① 記事確認: npm run preview でローカルサーバー起動');
console.log('  ② 次の記事を追加: node scripts/add-to-queue.mjs "次のキーワード"');
console.log('  ③ もう1本生成: node scripts/run-local.mjs');
