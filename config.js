/**
 * 测试版：合约单笔 0.0005～0.001 BNB（以部署网络为准）。
 * 默认 BSC 主网（chainId 56）；若改测测试网请改 chainId / chainName。
 * 只读与发交易均走钱包 RPC；ethers 见站点根目录 vendor/。
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
