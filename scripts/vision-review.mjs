// 视觉审查脚本:调用 SenseNova 多模态模型分析截图。
// 用法: node scripts/vision-review.mjs <图片路径> [问题]
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const [, , imgPath, questionArg] = process.argv;
if (!imgPath) {
  console.error('用法: node scripts/vision-review.mjs <图片路径> [问题]');
  process.exit(1);
}

const apiKey = 'sk-Kz4nS2paFBWnnthBmnwlBchtPgGqDoJr';
const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const mime = mimeMap[extname(imgPath).toLowerCase()] ?? 'image/png';
const b64 = readFileSync(imgPath).toString('base64');

const question =
  questionArg ??
  '这是三国杀网页游戏的界面截图。请从资深游戏 UI/UX 设计师角度审查：1) 界面布局与各区块；2) 视觉问题（配色、对比度、层次、字体）；3) 具体样式缺陷（对齐、间距、按钮、边框），逐条列出并注明位置。';

const res = await fetch('https://token.sensenova.cn/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'sensenova-6.8-flash-lite',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: question },
        ],
      },
    ],
    max_tokens: 4096,
    thinking: { mode: 'disabled' },
  }),
});

if (!res.ok) {
  console.error(`API ${res.status}:`, (await res.text()).slice(0, 500));
  process.exit(1);
}
const data = await res.json();
const msg = data.choices?.[0]?.message;
console.log(msg?.content ?? JSON.stringify(data).slice(0, 800));
