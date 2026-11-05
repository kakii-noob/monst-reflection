# monst-reflection

## 回帰テスト

Node.jsの標準機能だけで、角・角付近の反射、画像読み込みと再描画、
音声コントロール用ジェスチャの時間変換を確認できます。

```sh
node --test tests/regressions.test.cjs
```

このテストはゲーム実機での発射角度や、iOSでのジェスチャ再生を保証するものではありません。
