#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInjectionSafety } from './quality-gate.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// P0-C11の正規7ケースと、P0-C12Bで固定するscope言い換え・否定の回帰fixture。
const CASES = [
  { group: 'canonical', expected: 'ALLOW', text: 'JFXのMT4は分析専用、発注・EA自動売買は不可' },
  { group: 'canonical', expected: 'REJECT', text: 'JFXはEA運用に向いている' },
  { group: 'canonical', expected: 'REJECT', text: 'JFXのMT4ではEAを動かせる' },
  { group: 'canonical', expected: 'REJECT', text: 'JFXのMT4で自動売買できる' },
  { group: 'canonical', expected: 'REJECT', text: '編集部が口座を開設して使った' },
  { group: 'canonical', expected: 'REJECT', text: '読者のAさんは口座開設後3か月で利益を出した' },
  { group: 'canonical', expected: 'REJECT', text: '成果報酬は33,000円/件' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDが強みです' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDで使い分けられます' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDにはメリットがあります' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDも選択肢です' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDに挑戦したい人' },
  { group: 'variant', expected: 'REJECT', text: 'CFDは推奨対象外ですが、FXTFのCFDが強みです' },
  { group: 'variant', expected: 'REJECT', text: 'CFDにはメリットがありますが、リスクもあります' },
  { group: 'variant', expected: 'REJECT', text: 'CFDはリスクが高いですが、選択肢です' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDは推奨対象外で、リスクが高いため紹介しません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDのデメリットとリスクを説明します' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDにはメリットがありません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDを強みとは評価していません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDも選択肢に含めません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDで使い分けることは推奨しません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDに挑戦したい人にも、当サイトでは紹介しません' },
  { group: 'safe', expected: 'ALLOW', text: '海外FXの危険性と注意点を説明します' },
];

function actualForArticle(text) {
  return checkInjectionSafety(text).length > 0 ? 'REJECT' : 'ALLOW';
}

const python = String.raw`
import importlib.util
import json
import sys

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("generate_tweets_scope_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.load(sys.stdin)
print(json.dumps([
    "REJECT" if module.unsafe_content_reason(case["text"]) else "ALLOW"
    for case in cases
], ensure_ascii=False))
`;
const pythonResult = spawnSync(
  'python3',
  ['-c', python, path.join(ROOT, 'x-automation/generate_tweets.py')],
  { cwd: ROOT, input: JSON.stringify(CASES), encoding: 'utf8' },
);
if (pythonResult.status !== 0) {
  process.stderr.write(pythonResult.stderr);
  process.exit(pythonResult.status ?? 1);
}

const xActuals = JSON.parse(pythonResult.stdout);
let failed = 0;
for (const [index, testCase] of CASES.entries()) {
  const articleActual = actualForArticle(testCase.text);
  const xActual = xActuals[index];
  const ok = articleActual === testCase.expected && xActual === testCase.expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK' : 'NG'} [${testCase.group}] expected=${testCase.expected} `
    + `article=${articleActual} x=${xActual} | ${testCase.text}`,
  );
}

const canonical = CASES.filter(testCase => testCase.group === 'canonical');
console.log(`SUMMARY total=${CASES.length - failed}/${CASES.length} canonical=${canonical.length}/7 failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
