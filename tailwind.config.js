// Tailwind CSS のビルド設定（css/tailwind.css を生成する）。
// 以前は各ページで Play CDN（cdn.tailwindcss.com）を読み込み、ブラウザ上でCSSを生成していたが、
// 表示速度改善のため、ビルド済みのCSS1ファイルを全ページで共有する形に切り替えた（2026-09-30）。
// ページやJSで新しいクラスを使ったら `npm run build:css` で再生成してコミットすること。
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './*.html',
    './*.js',
    './js/**/*.{js,mjs}',
  ],
  // JSで文字列を組み立てて作るクラス名はビルド時に見つけられないので、ここに列挙する。
  safelist: [],
  theme: { extend: {} },
  plugins: [],
};
