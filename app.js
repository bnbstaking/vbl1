(function () {
  "use strict";

  const cfg = window.CROWDFUND_CONFIG;
  if (!cfg || !cfg.contractAddress) {
    console.error("Missing CROWDFUND_CONFIG");
    return;
  }

  const amountDecimals =
    typeof cfg.amountDisplayDecimals === "number" ? cfg.amountDisplayDecimals : 4;

  const ABI = [
    "function hasContributed(address) view returns (bool)",
    "function treasury() view returns (address)",
    "function minWei() view returns (uint256)",
    "function maxWei() view returns (uint256)",
    "function contributorCount() view returns (uint256)",
    "function MAX_CONTRIBUTORS() view returns (uint256)",
    "function totalRaised() view returns (uint256)",
  ];

  const el = {
    status: document.getElementById("status"),
    connect: document.getElementById("btn-connect"),
    btnOpenParticipate: document.getElementById("btn-open-participate"),
    participateDialog: document.getElementById("participate-dialog"),
    participateAmount: document.getElementById("input-participate-amount"),
    modalRangeHint: document.getElementById("modal-range-hint"),
    modalContractLine: document.getElementById("modal-contract-line"),
    btnParticipateCancel: document.getElementById("btn-participate-cancel"),
    btnParticipatePay: document.getElementById("btn-participate-pay"),
    menu: document.getElementById("btn-menu"),
    navBackdrop: document.getElementById("nav-backdrop"),
    navDrawer: document.getElementById("nav-drawer"),
    switchNetwork: document.getElementById("btn-switch-network"),
    copyShortcut: document.getElementById("btn-copy-shortcut"),
    copy: document.getElementById("btn-copy"),
    contractDisplay: document.getElementById("contract-display"),
    multisigDisplay: document.getElementById("multisig-display"),
    boundsHint: document.getElementById("bounds-hint"),
    alreadyHint: document.getElementById("already-hint"),
    eoaOnlyHint: document.getElementById("eoa-only-hint"),
    raisedAmount: document.getElementById("raised-amount"),
    raisedCaption: document.getElementById("raised-caption"),
    slotMeta: document.getElementById("slot-meta"),
    slotBar: document.getElementById("slot-bar"),
    slotTrack: document.getElementById("slot-track"),
    amountMeta: document.getElementById("amount-meta"),
    amountBar: document.getElementById("amount-bar"),
    amountTrack: document.getElementById("amount-track"),
    progressHint: document.getElementById("progress-hint"),
  };

  let readContract = null;
  let activeProvider = null;
  let account = null;
  let minWeiBn = null;
  let maxWeiBn = null;
  let contributorCapReached = false;

  function setStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.className = "status" + (isError ? " error" : "");
  }

  function isValidAddress(addr) {
    return /^0x[a-fA-F0-9]{40}$/.test(addr) && addr !== "0x0000000000000000000000000000000000000000";
  }

  function formatAddr(a) {
    if (!a || a.length < 10) return a;
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function setNavOpen(open) {
    if (!el.navDrawer || !el.navBackdrop || !el.menu) return;
    el.menu.setAttribute("aria-expanded", open ? "true" : "false");
    el.navBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
    el.navBackdrop.classList.toggle("is-open", open);
    el.navDrawer.classList.toggle("is-open", open);
  }

  async function switchToBsc() {
    if (!window.ethereum) {
      setStatus("请安装钱包后再切换网络。", true);
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + cfg.chainId.toString(16) }],
      });
      setStatus("已请求切换到 BSC（chainId " + cfg.chainId + "）。");
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
  }

  function formatBnbDisplay(weiStr) {
    const n = Number(weiStr);
    if (!Number.isFinite(n)) return weiStr;
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: amountDecimals,
    });
  }

  function updateProgressUi(treasury, minW, maxW, count, cap, totalRaised) {
    minWeiBn = minW;
    maxWeiBn = maxW;
    const nAddr = Number(count);
    const maxNAddr = Number(cap);
    contributorCapReached = maxNAddr > 0 && nAddr >= maxNAddr;

    const minBnb = ethers.formatEther(minW);
    const maxBnb = ethers.formatEther(maxW);
    const raisedStr = ethers.formatEther(totalRaised);
    el.raisedAmount.textContent = formatBnbDisplay(raisedStr);
    el.raisedCaption.textContent =
      "统计口径：链上累计成功入账额（随即转至多签）。满额理论上限约 " +
      formatBnbDisplay(ethers.formatEther(BigInt(cap) * BigInt(maxW.toString()))) +
      " BNB（最多 " +
      String(cap) +
      " 人 × 单笔至多 " +
      formatBnbDisplay(maxBnb) +
      " BNB）。";

    const n = Number(count);
    const maxN = Number(cap);
    const slotPct = maxN <= 0 ? 0 : Math.min(100, (n / maxN) * 100);
    el.slotBar.style.width = slotPct + "%";
    el.slotMeta.textContent = n + " / " + maxN + " · " + slotPct.toFixed(1) + "%";
    el.slotTrack.setAttribute("aria-valuenow", String(Math.round(slotPct)));

    const maxCapWei = BigInt(cap) * BigInt(maxW.toString());
    const tr = BigInt(totalRaised.toString());
    let amountPct = 0;
    if (maxCapWei > 0n) {
      amountPct = Number((tr * 10000n) / maxCapWei) / 100;
      amountPct = Math.min(100, Math.max(0, amountPct));
    }
    el.amountBar.style.width = amountPct + "%";
    el.amountMeta.textContent = amountPct.toFixed(1) + "%";
    el.amountTrack.setAttribute("aria-valuenow", String(Math.round(amountPct)));

    el.progressHint.textContent =
      "数据来自合约 totalRaised() 与 contributorCount()；请以链上为准。";

    const remaining = Math.max(0, maxN - n);
    const capLine =
      n >= maxN
        ? "参与名额已满（" + maxN + " 个地址），新转账将被合约拒绝。"
        : "参与名额：" + n + " / " + maxN + "（剩余 " + remaining + " 个地址）。";
    el.boundsHint.textContent =
      capLine +
      " 链上限额：" +
      formatBnbDisplay(minBnb) +
      " ～ " +
      formatBnbDisplay(maxBnb) +
      " BNB（含边界）。仅接受 EOA：合约地址作为发送方会失败。请在钱包向「众筹合约地址」发起普通 BNB 转账；勿向多签直接转。";

    el.multisigDisplay.textContent = treasury;
    updateParticipateUiState();
  }

  function syncParticipateModal() {
    if (!el.participateAmount || !el.modalRangeHint) return;
    if (minWeiBn != null && maxWeiBn != null) {
      const minB = ethers.formatEther(minWeiBn);
      const maxB = ethers.formatEther(maxWeiBn);
      el.modalRangeHint.textContent =
        "单笔须在 " + minB + " ～ " + maxB + " BNB（含边界），以钱包显示为准。";
      el.participateAmount.min = minB;
      el.participateAmount.max = maxB;
      const step =
        maxWeiBn - minWeiBn <= 10n ** 15n
          ? "0.0000001"
          : "0.01";
      el.participateAmount.step = step;
      const cur = parseFloat(el.participateAmount.value);
      const minN = parseFloat(minB);
      const maxN = parseFloat(maxB);
      if (isNaN(cur) || cur < minN || cur > maxN) {
        el.participateAmount.value = minB;
      }
    } else {
      el.modalRangeHint.textContent = "请先连接钱包或等待链上数据加载后再参与。";
    }
    if (el.modalContractLine && isValidAddress(cfg.contractAddress)) {
      el.modalContractLine.textContent =
        "收款合约：" + ethers.getAddress(cfg.contractAddress);
    }
  }

  function updateParticipateUiState() {
    if (!el.btnParticipatePay) return;
    const blockPay =
      minWeiBn == null ||
      maxWeiBn == null ||
      contributorCapReached ||
      (el.alreadyHint && !el.alreadyHint.hidden) ||
      (el.eoaOnlyHint && !el.eoaOnlyHint.hidden);
    el.btnParticipatePay.disabled = blockPay;
    if (el.btnOpenParticipate) {
      el.btnOpenParticipate.disabled =
        contributorCapReached && minWeiBn != null;
    }
  }

  async function ensureBsc(provider) {
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== cfg.chainId) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + cfg.chainId.toString(16) }],
      });
    }
  }

  async function attachReadContract(provider) {
    const addr = ethers.getAddress(cfg.contractAddress);
    const code = await provider.getCode(addr);
    if (code === "0x") {
      readContract = null;
      activeProvider = null;
      setStatus("该地址无合约代码，请检查 config.js 中的 contractAddress。", true);
      return false;
    }
    activeProvider = provider;
    readContract = new ethers.Contract(addr, ABI, provider);
    return true;
  }

  async function refreshMetaFromContract() {
    if (!readContract) return;
    const [treasury, minW, maxW, count, cap, totalRaised] = await Promise.all([
      readContract.treasury(),
      readContract.minWei(),
      readContract.maxWei(),
      readContract.contributorCount(),
      readContract.MAX_CONTRIBUTORS(),
      readContract.totalRaised(),
    ]);
    updateProgressUi(treasury, minW, maxW, count, cap, totalRaised);
  }

  async function refreshParticipation() {
    el.alreadyHint.hidden = true;
    el.eoaOnlyHint.hidden = true;
    if (!readContract || !account) return;
    if (activeProvider) {
      const code = await activeProvider.getCode(account);
      if (code && code !== "0x") {
        el.eoaOnlyHint.hidden = false;
        setStatus("当前连接地址为合约账户，众筹合约将拒绝入账，请改用普通 EOA 钱包地址转账。");
      }
    }
    const contributed = await readContract.hasContributed(account);
    if (contributed) {
      el.alreadyHint.hidden = false;
      setStatus("该地址已在链上完成众筹；再次向合约转账会失败。");
    }
    updateParticipateUiState();
  }

  function openParticipateDialog() {
    if (!el.participateDialog) return;
    syncParticipateModal();
    updateParticipateUiState();
    try {
      if (typeof el.participateDialog.showModal === "function") {
        el.participateDialog.showModal();
      } else {
        el.participateDialog.setAttribute("open", "");
      }
    } catch (_) {
      el.participateDialog.setAttribute("open", "");
    }
  }

  function closeParticipateDialog() {
    if (!el.participateDialog) return;
    try {
      if (typeof el.participateDialog.close === "function") {
        el.participateDialog.close();
      }
    } catch (_) {}
    el.participateDialog.removeAttribute("open");
  }

  async function participatePay() {
    if (!window.ethereum) {
      setStatus("请安装钱包后再参与。", true);
      return;
    }
    if (!isValidAddress(cfg.contractAddress)) {
      setStatus("请在 config.js 中配置合约地址。", true);
      return;
    }
    if (!account) {
      await connect();
      if (!account) return;
    }
    if (minWeiBn == null || maxWeiBn == null) {
      setStatus("正在读取链上数据，请稍后再试。", true);
      return;
    }
    if (contributorCapReached) {
      setStatus("参与名额已满。", true);
      return;
    }
    if (el.alreadyHint && !el.alreadyHint.hidden) {
      setStatus("当前地址已参与过。", true);
      return;
    }
    if (el.eoaOnlyHint && !el.eoaOnlyHint.hidden) {
      setStatus("合约账户无法参与，请使用 EOA 钱包。", true);
      return;
    }

    const amt = parseFloat(el.participateAmount && el.participateAmount.value);
    if (isNaN(amt)) {
      setStatus("请输入有效金额。", true);
      return;
    }
    let value;
    try {
      value = ethers.parseEther(String(amt));
    } catch (_) {
      setStatus("金额格式无效。", true);
      return;
    }
    if (value < minWeiBn || value > maxWeiBn) {
      setStatus("金额须在链上允许范围内。", true);
      return;
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    try {
      await ensureBsc(provider);
    } catch (e) {
      setStatus(e.message || String(e), true);
      return;
    }

    setStatus("请在钱包中确认交易…");
    el.btnParticipatePay.disabled = true;
    try {
      const signer = await provider.getSigner();
      const to = ethers.getAddress(cfg.contractAddress);
      const tx = await signer.sendTransaction({ to: to, value: value });
      setStatus("已广播：" + tx.hash + "，等待确认…");
      await tx.wait();
      closeParticipateDialog();
      if (readContract) {
        await refreshMetaFromContract();
        await refreshParticipation();
      }
      setStatus("交易已确认，感谢参与。");
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      updateParticipateUiState();
    }
  }

  function resetProgressUiPlaceholder() {
    minWeiBn = null;
    maxWeiBn = null;
    contributorCapReached = false;
    readContract = null;
    activeProvider = null;
    el.raisedAmount.textContent = "—";
    el.raisedCaption.textContent = "";
    el.slotBar.style.width = "0%";
    el.slotMeta.textContent = "—";
    el.amountBar.style.width = "0%";
    el.amountMeta.textContent = "—";
    el.multisigDisplay.textContent = "—";
    updateParticipateUiState();
  }

  async function loadChainDataViaWallet() {
    if (typeof ethers === "undefined") {
      resetProgressUiPlaceholder();
      el.boundsHint.textContent =
        "未加载 ethers 库。请将 vendor 文件夹与 index.html 一并部署，或检查 vendor/ethers.umd.min.js 是否 404。";
      el.progressHint.textContent = "脚本 vendor/ethers.umd.min.js 加载失败时无法连接钱包或读链。";
      setStatus("ethers 未加载，请检查 vendor 路径。", true);
      return;
    }
    if (!isValidAddress(cfg.contractAddress)) return;
    if (!window.ethereum) {
      resetProgressUiPlaceholder();
      el.boundsHint.textContent =
        "未检测到钱包。请安装 MetaMask 等扩展；链上数据仅通过钱包内置 RPC 读取，本页不连接第三方只读节点。";
      el.progressHint.textContent = "安装钱包并打开本页后自动加载；也可直接点击「连接钱包」。";
      setStatus("请安装钱包后查看众筹进度。", true);
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== cfg.chainId) {
        resetProgressUiPlaceholder();
        el.boundsHint.textContent =
          "当前钱包网络为 chainId " +
          String(net.chainId) +
          "，与众筹要求的 " +
          cfg.chainName +
          "（chainId " +
          cfg.chainId +
          "）不一致。请在钱包中切换，或使用顶栏「切换到 BSC」。";
        el.progressHint.textContent = "切换到正确网络后将通过钱包 RPC 自动加载合约数据。";
        setStatus("请在钱包中切换至 " + cfg.chainName + "。", true);
        return;
      }
      if (!(await attachReadContract(provider))) {
        resetProgressUiPlaceholder();
        return;
      }
      await refreshMetaFromContract();
      if (account) {
        await refreshParticipation();
        if (el.alreadyHint.hidden && el.eoaOnlyHint.hidden) {
          setStatus("已连接。可点击「参与众筹」输入金额并支付，或使用复制地址自行转账。");
        }
      } else {
        setStatus("已通过钱包 RPC 加载链上数据。连接钱包可核对参与状态。", false);
      }
    } catch (e) {
      resetProgressUiPlaceholder();
      el.boundsHint.textContent =
        "无法通过钱包读取链上数据（请解锁钱包或检查网络设置）。";
      el.progressHint.textContent = "加载失败：" + (e.message || String(e));
      setStatus(e.message || String(e), true);
    }
  }

  async function connect() {
    if (typeof ethers === "undefined") {
      setStatus("页面未加载 ethers（请确认已部署 vendor/ethers.umd.min.js 且路径正确）。", true);
      return;
    }
    if (!window.ethereum) {
      setStatus("请安装 MetaMask 或其它注入 window.ethereum 的钱包。", true);
      return;
    }
    if (!isValidAddress(cfg.contractAddress)) {
      setStatus("请在 config.js 中配置已部署的 Crowdfund 合约地址。", true);
      return;
    }

    setStatus("连接中…");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      account = await signer.getAddress();
      await ensureBsc(provider);

      if (!(await attachReadContract(provider))) {
        el.connect.textContent = formatAddr(account);
        el.connect.classList.add("is-connected");
        updateParticipateUiState();
        return;
      }

      await refreshMetaFromContract();
      await refreshParticipation();

      el.connect.textContent = formatAddr(account);
      el.connect.classList.add("is-connected");
      if (el.alreadyHint.hidden && el.eoaOnlyHint.hidden) {
        setStatus("已连接。可点击「参与众筹」输入金额并支付，或使用复制地址自行转账。");
      }
      updateParticipateUiState();
    } catch (e) {
      el.connect.textContent = "连接钱包";
      el.connect.classList.remove("is-connected");
      setStatus(e.message || String(e), true);
      updateParticipateUiState();
    }
  }

  async function copyContractAddress() {
    if (!isValidAddress(cfg.contractAddress)) {
      setStatus("请先在 config.js 配置有效合约地址。", true);
      return;
    }
    try {
      const addr = ethers.getAddress(cfg.contractAddress);
      await navigator.clipboard.writeText(addr);
      setStatus("已复制众筹合约地址，请到钱包粘贴为收款地址。");
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
  }

  function getBannerBaseUrl() {
    if (typeof cfg.bannerBase === "string" && cfg.bannerBase.trim() !== "") {
      const b = cfg.bannerBase.trim();
      if (/^https?:\/\//i.test(b)) return b.replace(/\/?$/, "/");
      if (b.startsWith("/")) return window.location.origin + b.replace(/\/?$/, "/");
      return new URL(b.replace(/\/?$/, "/"), document.baseURI).href;
    }
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      const raw = scripts[i].getAttribute("src");
      if (!raw) continue;
      const abs = new URL(raw, document.baseURI).href;
      if (/\/app\.js(\?|#|$)/i.test(abs)) {
        return abs.replace(/\/app\.js(\?[^#]*)?(#.*)?$/i, "/");
      }
    }
    return new URL("./", document.baseURI).href;
  }

  function resolveBannerUrl(path) {
    if (!path) return path;
    const p = String(path).trim();
    if (/^https?:\/\//i.test(p)) return p;
    return new URL(p.replace(/^\//, ""), getBannerBaseUrl()).href;
  }

  function initBanner() {
    const track = document.getElementById("banner-track");
    if (!track) return;
    const urls = Array.isArray(cfg.bannerImages) ? cfg.bannerImages : [];
    if (urls.length === 0) {
      track.parentElement.parentElement.style.display = "none";
      return;
    }
    track.textContent = "";
    function addSlide(src) {
      const img = document.createElement("img");
      img.src = resolveBannerUrl(src);
      img.alt = "";
      img.loading = "lazy";
      img.className = "banner-slide-img";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      track.appendChild(img);
    }
    urls.forEach(addSlide);
    urls.forEach(addSlide);
  }

  el.contractDisplay.textContent = cfg.contractAddress;
  if (el.connect) el.connect.addEventListener("click", connect);
  if (el.copy) el.copy.addEventListener("click", copyContractAddress);
  if (el.switchNetwork) el.switchNetwork.addEventListener("click", switchToBsc);
  if (el.copyShortcut) el.copyShortcut.addEventListener("click", copyContractAddress);

  if (el.btnOpenParticipate) {
    el.btnOpenParticipate.addEventListener("click", openParticipateDialog);
  }
  if (el.btnParticipateCancel) {
    el.btnParticipateCancel.addEventListener("click", closeParticipateDialog);
  }
  if (el.btnParticipatePay) {
    el.btnParticipatePay.addEventListener("click", participatePay);
  }
  if (el.participateDialog) {
    el.participateDialog.addEventListener("cancel", function (e) {
      e.preventDefault();
      closeParticipateDialog();
    });
  }

  if (el.menu && el.navBackdrop && el.navDrawer) {
    el.menu.addEventListener("click", function () {
      const open = !el.navDrawer.classList.contains("is-open");
      setNavOpen(open);
    });
    el.navBackdrop.addEventListener("click", function () {
      setNavOpen(false);
    });
    el.navDrawer.querySelectorAll("a[href^='#']").forEach(function (a) {
      a.addEventListener("click", function () {
        setNavOpen(false);
      });
    });
  }

  if (window.ethereum && typeof window.ethereum.on === "function") {
    window.ethereum.on("chainChanged", function () {
      loadChainDataViaWallet();
    });
  }

  initBanner();
  loadChainDataViaWallet();
  updateParticipateUiState();
})();
