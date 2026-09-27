# ドラフト当日の手順書（答え合わせ公開まで）

10月22日のドラフト会議当日、指名結果を`data/draft-2026-results.json`として公開し、
「12球団1位指名予想」ページ（`draft-predict.html`）の答え合わせ機能を有効にするための手順。

対象読者：オーナー本人（gitを直接操作する場合）と、Claude Codeセッションに代行を頼む場合の両方を想定。
Claude Codeに頼む場合は、この手順書のリンクを渡して「この手順で結果を公開して」と伝えればよい。

---

## 0. 事前準備（前日までに済ませておく）

- [ ] `docs/DRAFT_RESULTS_JSON_SPEC.md`に目を通し、入力する項目（`name`/`org`/`pos`、競合があれば
      `competedWith`/`lottery`/`fallback`）を確認しておく
- [ ] できれば`docs/DRAFT_DAY_RUNBOOK.md`の「付録：リハーサル手順」を1度試しておき、
      答え合わせ画面・シェア画像の見た目を事前に確認しておく

## 1. 指名結果を入力する

リポジトリのルートに`data/draft-2026-results.json`を新規作成（または更新）する。
形式は`docs/DRAFT_RESULTS_JSON_SPEC.md`のとおり。最小構成なら1球団あたり3項目（`name`/`org`/`pos`）だけでよい。

```json
{
  "version": "2026-10-22",
  "updatedAt": "2026-10-22T21:00:00+09:00",
  "picks": {
    "巨人": { "name": "選手名", "org": "所属", "pos": "投手" }
  }
}
```

- 12球団すべて揃うまで待つ必要はない。分かった球団から追記してよい
- 競合・外れ1位があった球団は、`docs/DRAFT_RESULTS_JSON_SPEC.md`の例のとおり
  `competedWith`・`lottery`・`fallback`を追記する
- `updatedAt`は都度、今の日時に更新しておくとページ上の「最終更新」表示が新しくなる

## 2. 検証スクリプトを実行する

```bash
npm run validate:draft-results
```

（`node scripts/validate-draft-results.mjs`でも同じ）

- **❌ エラーが出た場合**：JSONの形式に誤りがある。エラー内容（球団名の誤字、必須項目の抜けなど）を
  直してから、もう一度実行する。エラーが残っている間は公開しないこと
- **⚠️ 警告が出た場合**：多くは想定内（未入力の球団がある、候補リストに無い選手が指名された、など）。
  内容を目で見て問題なければ、そのまま次に進んでよい

## 3. 公開する

このサイトはGitHub Pagesで、`claude/draft-simulator-refactor-2tl4kh`ブランチ（本番）から配信されている。
`data/draft-2026-results.json`を本番ブランチに反映して初めて、答え合わせ機能が実際のサイトに表示される。

**Claude Codeセッションに頼む場合**：「data/draft-2026-results.jsonを更新したので、検証スクリプトを実行して
問題なければ本番ブランチにPRを作ってマージして」と伝えれば、これまでの更新と同じ手順（コミット→PR作成→
マージ）で進めてくれる。

**オーナー自身でgit操作する場合**：
```bash
git add data/draft-2026-results.json
git commit -m "ドラフト結果を追加（◯球団分）"
git push origin <作業ブランチ>
# 本番ブランチ(claude/draft-simulator-refactor-2tl4kh)へのPRを作成してマージする
```

## 4. 公開後の確認

- 本番サイトの`draft-predict.html`を開き、答え合わせセクションが表示されることを確認する
  （表示されない場合、ブラウザのキャッシュを1度リロード（Cmd/Ctrl+Shift+R）してみる）
- 🎯1位入札的中／🏆交渉権獲得的中の数が意図どおりか確認する
- 「答え合わせ結果をシェアする」から𝕏用・ストーリー用の画像がそれぞれ正しく生成されるか確認する

## 5. 追記・修正が必要になったら

指名結果に誤りがあった、追加の球団分が判明した、などの場合は、手順1〜3を繰り返すだけでよい
（`data/draft-2026-results.json`を上書きして、再度検証→コミットし直す）。ページ側は毎回最新のファイルを
取得するので、古いキャッシュが強く残っていなければ反映される。

---

## 付録：リハーサル手順（本番前に見た目を確認する）

本番の`data/draft-2026-results.json`を作る前に、ダミーの結果で答え合わせ画面・シェア画像の見た目を
試すことができる。**この方法なら本番ファイルには一切触れないので、誤公開の心配がない。**

1. `docs/DRAFT_RESULTS_JSON_SPEC.md`の形式で、テスト用のダミー内容を
   `data/draft-2026-results.test.json`という名前で保存する（末尾が`.test.json`）。
   このファイル名は`.gitignore`に登録済みなので、間違ってコミット・公開されることはない
2. ローカルでサイトを配信する（例：リポジトリのルートで`python3 -m http.server 8000`）
3. ブラウザで `http://localhost:8000/draft-predict.html?test_results=1` を開く
   （URLの末尾に`?test_results=1`を付けると、本番ファイルの代わりに
   `data/draft-2026-results.test.json`を読み込む）
4. 答え合わせセクションの表示、称号、シェア画像（𝕏用・ストーリー用）を確認する
5. 確認が終わったら`data/draft-2026-results.test.json`は削除してよい（.gitignore対象なので
   残しておいても本番には影響しない）

`?test_results=1`を付けずに開いた場合は、これまでどおり本番の`data/draft-2026-results.json`
（無ければ非表示）を見に行くので、リハーサル用のURLパラメータを人に共有しない限り、
一般の閲覧者がテストデータを目にすることはない。
