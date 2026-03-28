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
    const minBnb = ethers.formatEther(minW);
    const maxBnb = ethers.formatEther(maxW);
    const raisedStr = ethers.formatEther(totalRaised);
    el.raisedAmount.textContent = formatBnbDisplay(raisedStr);
    el.raisedCaption.textContent =
      "统计口径：链上累计成功入账额（随即转至 treasury）。满额理论上限约 " +
      formatBnbDisplay(ethers.formatEther(BigInt(cap) * BigInt(maxW.toString()))) +
      "（最多 " +
      String(cap) +
      " 人 × 单笔至多 " +
      formatBnbDisplay(maxBnb) +
      "）。";

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
      "（含边界）。仅接受 EOA。请在钱包向「众筹合约地址」转账；勿向 treasury 直接转。";

    el.multisigDisplay.textContent = treasury;
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
  }

  async function loadViaPublicRpc() {
    if (!cfg.readRpcUrl || !isValidAddress(cfg.contractAddress)) return;
    try {
      const provider = new ethers.JsonRpcProvider(cfg.readRpcUrl);
      if (!(await attachReadContract(provider))) return;
      await refreshMetaFromContract();
      setStatus("已加载链上说明。连接钱包可核对网络并查看你的地址是否已参与。");
    } catch (e) {
      el.boundsHint.textContent =
        "无法通过 readRpcUrl 读取（常见于浏览器 CORS）。请连接钱包或检查合约地址 / 网络。";
      el.progressHint.textContent = "加载失败：" + (e.message || String(e));
      setStatus("", false);
    }
  }

  async function connect() {
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

      if (!(await attachReadContract(provider))) return;

      await refreshMetaFromContract();
      await refreshParticipation();

      el.connect.textContent = formatAddr(account);
      el.connect.classList.add("is-connected");
      if (el.alreadyHint.hidden && el.eoaOnlyHint.hidden) {
        setStatus("已连接。请在钱包内向众筹合约地址转账（见上方限额），本页不会发起交易。");
      }
    } catch (e) {
      el.connect.textContent = "连接钱包";
      el.connect.classList.remove("is-connected");
      setStatus(e.message || String(e), true);
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
  el.connect.addEventListener("click", connect);
  el.copy.addEventListener("click", copyContractAddress);
  if (el.switchNetwork) el.switchNetwork.addEventListener("click", switchToBsc);
  if (el.copyShortcut) el.copyShortcut.addEventListener("click", copyContractAddress);

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

  initBanner();
  loadViaPublicRpc();
})();
