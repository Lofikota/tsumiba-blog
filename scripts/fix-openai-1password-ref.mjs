#!/usr/bin/env node
/**
 * 1PasswordのPrivate VaultからOpenAI APIキーらしきItem/Fieldを探し、
 * .env.1password の OPENAI_API_KEY 参照を自動更新する。
 *
 * - APIキー本文は表示しない
 * - APIキー本文はファイルに保存しない
 * - 書き込むのは op://... の参照だけ
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env.1password');
const opBin = process.env.OP_BIN || '/Users/kudokota/.local/bin/op';
const vault = process.env.OP_VAULT || 'Private';

function op(args) {
  return execFileSync(opBin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function shellEscapeRefPart(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('/', '\\/');
}

function findOpenAiRef() {
  const list = JSON.parse(op(['item', 'list', '--vault', vault, '--format', 'json']));
  const candidates = list.sort((a, b) => {
    const score = (item) => {
      const title = item.title || '';
      if (/auth\.openai\.com|platform\.openai\.com|chatgpt\.com/i.test(title)) return 50;
      if (/openai api key|openai_api_key/i.test(title)) return 0;
      if (/openai|open ai|gpt|chatgpt/i.test(title)) return 5;
      if (/api|key/i.test(title)) return 20;
      return 30;
    };
    return score(a) - score(b) || String(a.title).localeCompare(String(b.title));
  });

  for (const item of candidates) {
    const detail = JSON.parse(op(['item', 'get', item.id, '--vault', vault, '--format', 'json', '--reveal']));
    if (/auth\.openai\.com|chatgpt\.com/i.test(detail.title || '')) continue;
    const fields = detail.fields || [];
    const field = fields.find((field) => {
      const value = String(field.value || '');
      return /^sk-[A-Za-z0-9_-]{20,}/.test(value);
    });
    if (!field?.label) continue;

    return {
      title: detail.title || item.title,
      field: field.label,
      ref: field.id
        ? `op://${shellEscapeRefPart(vault)}/${detail.id}/${field.id}`
        : `op://${shellEscapeRefPart(vault)}/${shellEscapeRefPart(detail.title || item.title)}/${shellEscapeRefPart(field.label)}`,
    };
  }

  return null;
}

function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  if (content.match(new RegExp(`^${key}=`, 'm'))) {
    return content.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  }
  return `${content.replace(/\s*$/, '')}\n${line}\n`;
}

const found = findOpenAiRef();
if (!found) {
  console.error(`sk- で始まるOpenAI APIキーが ${vault} Vault に見つかりませんでした。`);
  console.error('OpenAIログイン用パスワードではなく、platform.openai.com の API keys で作った sk- から始まるキーを1Passwordに保存してください。');
  console.error('推奨: Item名「OpenAI API Key」、Field名「credential」または「API Key」。');
  process.exit(1);
}

let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
content = upsertEnvLine(content, 'OPENAI_API_KEY', found.ref);
content = upsertEnvLine(content, 'OPENAI_IMAGE_MODEL', 'gpt-image-1.5');
content = upsertEnvLine(content, 'OPENAI_IMAGE_SIZE', '1536x1024');
content = upsertEnvLine(content, 'OPENAI_IMAGE_QUALITY', 'high');
fs.writeFileSync(envPath, content, 'utf-8');

console.log(`OPENAI_API_KEY参照を更新しました: ${vault} / ${found.title} / ${found.field}`);
