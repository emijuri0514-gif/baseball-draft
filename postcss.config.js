// css/tailwind.css のビルド用。Play CDNと同じく autoprefixer をかける
// （iOS 17以前のSafariは backdrop-filter などに -webkit- 付きの指定が必要なため）。
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
