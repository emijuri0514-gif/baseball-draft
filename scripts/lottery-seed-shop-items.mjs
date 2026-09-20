#!/usr/bin/env node
// 交換ショップの商品カタログ(js/shop-items.mjs)をFirestoreへ投入する初期セットアップ用スクリプト。
//
// firestore.rules では、ショップ購入(users.unlocksの更新)をshop_items/{itemId}.costと
// 突き合わせて検証しているため、このコレクションが投入されていないと購入が一切できない。
// games/drawsと同様、書き込みはadminのみ許可しているため、信頼された環境で動くこの
// スクリプト(Firebase Admin SDK)から実行する。
//
// 事前準備は scripts/lottery-seed-games.mjs と同じ(lottery-serviceAccountKey.json を配置し、npm install)。
//
// 使い方:
//   node scripts/lottery-seed-shop-items.mjs
//
// available: false の商品(準備中)はあえてFirestoreに投入しない。こうしておくことで、
// 万が一クライアントが準備中の商品IDを指定して購入を試みても、対応するshop_itemsドキュメントが
// 存在せず get().data.cost が取得できないため、ルール側で確実に拒否される。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import admin from 'firebase-admin';
import { SHOP_ITEMS } from '../js/shop-items.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = path.join(__dirname, '..', 'lottery-serviceAccountKey.json');

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
} catch (err) {
  console.error(
    `サービスアカウントキーが見つかりません: ${serviceAccountPath}\n` +
      'Firebaseコンソールから発行したJSONキーをこのパスに配置してください。'
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const available = SHOP_ITEMS.filter((item) => item.available);
  const batch = db.batch();
  for (const item of available) {
    batch.set(db.collection('shop_items').doc(item.id), { cost: item.cost });
  }
  await batch.commit();
  console.log(`Seeded ${available.length} shop items into Firestore:`);
  for (const item of available) {
    console.log(`  - ${item.id}: ${item.cost}pt`);
  }
  const skipped = SHOP_ITEMS.filter((item) => !item.available);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} unavailable item(s) (準備中): ${skipped.map((i) => i.id).join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
