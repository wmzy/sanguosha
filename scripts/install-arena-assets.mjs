#!/usr/bin/env node
// Install an ignored, local-only asset pack from a pinned QSanguosha-v2 revision.
// Originals are copied byte-for-byte; this script never resizes or recompresses.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'https://github.com/Mogara/QSanguosha-v2';
const COMMIT = 'e8768851bd8054db9fd1b63cd6f1feca813590d7';
const RAW_ROOT = `https://raw.githubusercontent.com/Mogara/QSanguosha-v2/${COMMIT}`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = resolve(SCRIPT_DIR, '..', 'public', 'packs', 'base');
const MANIFEST_PATH = join(PACK_DIR, 'manifest.json');
const CONCURRENCY = 6;

const generals = [
  // 基础标准版与风包（原有31将）
  ['曹操', 'caocao'], ['司马懿', 'simayi'], ['夏侯惇', 'xiahoudun'],
  ['张辽', 'zhangliao'], ['许褚', 'xuchu'], ['郭嘉', 'guojia'], ['甄姬', 'zhenji'],
  ['刘备', 'liubei'], ['关羽', 'guanyu'], ['张飞', 'zhangfei'], ['赵云', 'zhaoyun'],
  ['诸葛亮', 'zhugeliang'], ['黄月英', 'huangyueying'], ['孙权', 'sunquan'],
  ['甘宁', 'ganning'], ['吕蒙', 'lvmeng'], ['黄盖', 'huanggai'], ['周瑜', 'zhouyu'],
  ['大乔', 'daqiao'], ['陆逊', 'luxun'], ['孙尚香', 'sunshangxiang'],
  ['华佗', 'huatuo'], ['吕布', 'lvbu'], ['貂蝉', 'diaochan'],
  ['夏侯渊', 'xiahouyuan'], ['黄忠', 'huangzhong'], ['魏延', 'weiyan'],
  ['小乔', 'xiaoqiao'], ['周泰', 'zhoutai'], ['张角', 'zhangjiao'], ['于吉', 'yuji'],

  // 魏国扩充武将
  ['曹仁', 'caoren'], ['荀彧', 'xunyu'], ['典韦', 'dianwei'],
  ['曹丕', 'caopi'], ['徐晃', 'xuhuang'], ['张郃', 'zhanghe'], ['邓艾', 'dengai'],
  ['于禁', 'yujin'], ['张春华', 'zhangchunhua'], ['曹冲', 'caochong'], ['曹彰', 'caozhang'],
  ['曹植', 'caozhi'], ['李典', 'lidian'], ['王异', 'wangyi'], ['郭淮', 'guohuai'],

  // 蜀国扩充武将
  ['马超', 'machao'], ['马岱', 'madai'], ['卧龙诸葛', 'wolong'],
  ['庞统', 'pangtong'], ['孟获', 'menghuo'], ['祝融', 'zhurong'], ['姜维', 'jiangwei'],
  ['刘禅', 'liushan'], ['关兴张苞', 'guanxingzhangbao'], ['夏侯氏', 'xiahoushi'], ['廖化', 'liaohua'],
  ['张松', 'zhangsong'], ['徐庶', 'xushu'], ['法正', 'fazheng'], ['简雍', 'jianyong'],

  // 吴国扩充武将
  ['太史慈', 'taishici'], ['鲁肃', 'lusu'], ['孙坚', 'sunjian'], ['孙策', 'sunce'],
  ['张昭张纮', 'erzhang'], ['凌统', 'lingtong'], ['吴国太', 'wuguotai'],
  ['徐盛', 'xusheng'], ['程普', 'chengpu'], ['虞翻', 'yufan'],
  ['韩当', 'handang'], ['陆抗', 'lukang'],

  // 群雄扩充武将
  ['袁绍', 'yuanshao'], ['庞德', 'pangde'], ['颜良文丑', 'yanliangwenchou'], ['董卓', 'dongzhuo'],
  ['贾诩', 'jiaxu'], ['左慈', 'zuoci'], ['蔡文姬', 'caiwenji'], ['伏皇后', 'fuhuanghou'],
  ['公孙瓒', 'gongsunzan'], ['刘表', 'liubiao'], ['华雄', 'huaxiong'], ['李儒', 'liru'],
  ['沮授', 'jvshou'], ['蔡夫人', 'caifuren'], ['陈宫', 'chengong'], ['高顺', 'gaoshun'],
  ['袁术', 'yuanshu'], ['许攸', 'wis_xuyou'],
];

const generalAliases = [
  ['卧龙诸葛亮', 'wolong'],
  ['张昭张弘', 'erzhang'],
];

const cards = [
  ['杀', 'slash'], ['火杀', 'fire_slash'], ['雷杀', 'thunder_slash'],
  ['闪', 'jink'], ['桃', 'peach'], ['酒', 'analeptic'],
  ['过河拆桥', 'dismantlement'], ['顺手牵羊', 'snatch'], ['无中生有', 'ex_nihilo'],
  ['决斗', 'duel'], ['万箭齐发', 'archery_attack'], ['南蛮入侵', 'savage_assault'],
  ['桃园结义', 'god_salvation'], ['五谷丰登', 'amazing_grace'],
  ['乐不思蜀', 'indulgence'], ['兵粮寸断', 'supply_shortage'], ['闪电', 'lightning'],
  ['无懈可击', 'nullification'], ['铁索连环', 'iron_chain'], ['火攻', 'fire_attack'],
  ['借刀杀人', 'collateral'],
  ['诸葛连弩', 'crossbow'], ['青釭剑', 'qinggang_sword'], ['寒冰剑', 'ice_sword'],
  ['雌雄双股剑', 'double_sword'], ['贯石斧', 'axe'], ['青龙偃月刀', 'blade'],
  ['丈八蛇矛', 'spear'], ['方天画戟', 'halberd'], ['麒麟弓', 'kylin_bow'],
  ['古锭刀', 'guding_blade'], ['朱雀羽扇', 'fan'], ['八卦阵', 'eight_diagram'],
  ['仁王盾', 'renwang_shield'], ['藤甲', 'vine'], ['白银狮子', 'silver_lion'],
  ['骅骝', 'hualiu'], ['赤兔', 'chitu'], ['紫骍', 'zixing'], ['大宛', 'dayuan'],
  ['的卢', 'dilu'], ['绝影', 'jueying'], ['爪黄飞电', 'zhuahuangfeidian'],
];

const assets = [
  ...generals.map(([name, file]) => ({
    id: `character/${name}`,
    source: `image/fullskin/generals/full/${file}.png`,
  })),
  ...generalAliases.map(([name, file]) => ({
    id: `character/${name}`,
    source: `image/fullskin/generals/full/${file}.png`,
  })),
  // 为界限突破武将自动映射复用同名标准版立绘（无独立立绘时）
  ...generals.map(([name, file]) => ({
    id: `character/界${name}`,
    source: `image/fullskin/generals/full/${file}.png`,
  })),
  ...cards.map(([name, file]) => ({ id: `card/art/${name}`, source: `image/card/${file}.png` })),
  { id: 'table/background', source: 'image/system/backdrop/default.jpg' },
];

const metadata = [
  { id: 'upstream-license', source: 'LICENSE', target: 'UPSTREAM-LICENSE' },
  { id: 'upstream-mcfr', source: 'MCFR', target: 'UPSTREAM-MCFR' },
];

function assertSafeRelative(file) {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Unsafe package-relative path: ${file}`);
  }
  const absolute = resolve(PACK_DIR, normalized);
  const prefix = `${resolve(PACK_DIR)}${sep}`;
  if (!absolute.startsWith(prefix)) throw new Error(`Path escapes pack directory: ${file}`);
  return absolute;
}

async function existingManifest() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (!Array.isArray(manifest.resources)) {
      throw new Error('existing manifest.json has no resources array');
    }
    return manifest;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        manifestVersion: 1,
        id: 'base',
        name: '基础资源包',
        version: '1.0.0',
        author: 'QSanguosha-v2 local asset installer',
        description: '本机演武场资源；素材来源与授权说明见 UPSTREAM-SOURCE.txt。',
        homepage: REPOSITORY,
        priority: 0,
        resources: [],
      };
    }
    throw error;
  }
}

async function downloadOne(item) {
  const target = assertSafeRelative(item.target ?? item.source);
  await mkdir(dirname(target), { recursive: true });
  try {
    await readFile(target);
    return { status: 'skipped', path: relative(PACK_DIR, target) };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const url = `${RAW_ROOT}/${item.source}`;
  let response;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      response = await fetch(url, { redirect: 'error' });
      if (response && response.ok) break;
      if (attempt === 4) {
        throw new Error(`${response?.status ?? 'error'} ${response?.statusText ?? 'failed'}: ${url}`);
      }
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const temporary = `${target}.download-${process.pid}`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    // A concurrent installer may have created the target meanwhile. Keep it intact.
    try {
      await readFile(target);
      await rm(temporary, { force: true });
      return { status: 'skipped', path: relative(PACK_DIR, target) };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { status: 'downloaded', path: relative(PACK_DIR, target), bytes: bytes.length };
}

async function runPool(items, workerCount) {
  const results = new Array(items.length);
  let next = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await downloadOne(items[index]);
      } catch (error) {
        errors.push({ item: items[index], error });
      }
    }
  }));
  if (errors.length) {
    throw new AggregateError(
      errors.map(({ item, error }) => new Error(`${item.source} → ${item.target ?? item.source}: ${error.message}`)),
      `Resource installation failed for ${errors.length} item(s); manifest was not updated.`,
    );
  }
  return results;
}

async function main() {
  await mkdir(PACK_DIR, { recursive: true });
  const manifest = await existingManifest();
  const results = await runPool([...assets, ...metadata], CONCURRENCY);

  const knownIds = new Set(manifest.resources.map((entry) => entry.id));
  const additions = assets
    .filter((asset) => !knownIds.has(asset.id))
    .map((asset) => ({ id: asset.id, type: 'image', file: asset.source }));
  manifest.resources.push(...additions);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const sourceLines = [
    'Local-only QSanguosha-v2 asset package',
    `Repository: ${REPOSITORY}`,
    `Pinned commit: ${COMMIT}`,
    `Raw source root: ${RAW_ROOT}`,
    '',
    'The files are stored byte-for-byte under their original upstream paths.',
    'The upstream root LICENSE and MCFR are copied verbatim as UPSTREAM-LICENSE and UPSTREAM-MCFR.',
    'No separate image-asset license was found in the upstream repository root. This installer makes no claim that the images are openly licensed; keep this pack local and obtain permission before redistribution or commercial use.',
    '',
    'Resource ID mappings:',
    ...assets.map((asset) => `${asset.id} -> ${asset.source}`),
  ];
  await writeFile(join(PACK_DIR, 'UPSTREAM-SOURCE.txt'), `${sourceLines.join('\n')}\n`, 'utf8');

  const downloaded = results.filter((result) => result.status === 'downloaded');
  const skipped = results.filter((result) => result.status === 'skipped');
  console.log(`Asset files: ${assets.length}; manifest IDs added: ${additions.length}`);
  console.log(`Downloaded: ${downloaded.length}; existing files skipped: ${skipped.length}`);
  console.log(`Pinned source: ${REPOSITORY}/tree/${COMMIT}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  if (skipped.length) console.log(`Skipped existing files: ${skipped.map((item) => item.path).join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  if (error instanceof AggregateError) {
    for (const item of error.errors) console.error(`  - ${item.message}`);
  }
  process.exitCode = 1;
});
