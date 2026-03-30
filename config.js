/**
 * 微波炉火种众筹计划 — 前端配置（与正式站同源 UI，合约为小额 minWei/maxWei）。
 * BSC 主网 chainId 56；只读与发交易走钱包 RPC；vendor/ethers.umd.min.js 须与 index 一并部署。
 */
window.CROWDFUND_CONFIG = {
  contractAddress: "0xD36c1B175A4d7688F8a6e6Fb16E3101090Aa950E",
  chainId: 56,
  chainName: "BNB Smart Chain",
  /**
   * 横幅图片与 index.html 同目录（根目录）。若 GitHub Pages 子路径仍 404，可设：
   * bannerBase: "/仓库名/test-version/"
   */
  bannerImages: ["banner-1.png", "banner-2.png", "banner-3.png"],
  /** 小额展示用小数位数 */
  amountDisplayDecimals: 8,
};
