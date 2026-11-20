(() => {
  const $ = id => document.getElementById(id);
  const PRIVATE_PAGE_SIZE = 6;
  const model = { posts: [], categories: [], categoryPage: 0, category: "all", query: "", page: 1, carouselIndex: 0, identity: "", loaded: false, loading: false, revision: 0 };
  const allowed = key => currentUser && hasLevelPermission(key);
  let privateBio = null, bioIdentity = "", bioRevision = 0;
  let introLayout = null, resizeFrame = 0;
  function beginIntroLayout() {
    if (introLayout) return;
    const card = document.querySelector('.profile-card'), panel = $('blogPrivatePanel');
    introLayout = { height: card.style.height, overflow: card.style.overflowY, panelMin: panel.style.minHeight, carouselDisplay: $("carouselBox").style.display };
    const height = card.getBoundingClientRect().height;
    const panelHeight = $('publicPostsPanel').getBoundingClientRect().height;
    card.style.height = `${height}px`; card.style.overflowY = 'auto'; panel.style.minHeight = `${panelHeight}px`;
  }
  function restoreIntroLayout() {
    if (!introLayout) return;
    const card = document.querySelector('.profile-card');
    card.style.height = introLayout.height; card.style.overflowY = introLayout.overflow; $('blogPrivatePanel').style.minHeight = introLayout.panelMin;
    introLayout = null;
  }
  window.addEventListener('resize', () => {
    if (!introLayout || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0; if (!introLayout || state.filter !== 'private') return;
      const carouselDisplay = introLayout.carouselDisplay;
      restoreIntroLayout(); renderProfileIntro(currentProfile);
      $("carouselBox").style.display = carouselDisplay;
      $('publicPostsPanel').hidden = false; $('blogPrivatePanel').hidden = true;
      beginIntroLayout();
      $('publicPostsPanel').hidden = true; $('blogPrivatePanel').hidden = false;
      if (privateBio?.enabled && allowed('private_read')) renderProfileIntro(privateBio);
    });
  });
  const restoreIntro = () => { if (currentProfile) renderProfileIntro(currentProfile); };
  async function syncIntro() {
    if (!allowed("private_read")) { ++bioRevision; privateBio = null; bioIdentity = ""; restoreIntro(); return; }
    const identity = `${currentUser.id}:${currentUser.role}`;
    if (identity === bioIdentity) { if (privateBio?.enabled) renderProfileIntro(privateBio); return; }
    bioIdentity = identity; const revision = ++bioRevision;
    try { const data = await (await api("/api/private-bio")).json(); if (revision !== bioRevision || state.filter !== "private") return; privateBio = data.bio; if (privateBio?.enabled) renderProfileIntro(privateBio); else restoreIntro(); } catch { if (revision === bioRevision) { bioIdentity = ""; restoreIntro(); } }
  }
  const reader = document.createElement("dialog"); reader.className = "blog-private-reader"; reader.setAttribute("aria-labelledby", "blogPrivateReaderTitle");
  reader.innerHTML = '<div class="panel-header"><h2 id="blogPrivateReaderTitle"></h2><button class="tactile-btn" type="button" id="blogPrivateReaderClose">关闭</button></div><p class="tabular" id="blogPrivateReaderMeta"></p><div class="reader-body" id="blogPrivateReaderBody"></div>';
  document.body.append(reader);
  $("blogPrivateReaderClose").addEventListener("click", () => reader.close());
  reader.addEventListener("click", async event => { const button = event.target.closest(".code-copy"); if (!button) return; try { await navigator.clipboard.writeText(button.closest(".code-wrap").querySelector("code").textContent); showToast("代码已复制"); } catch { showToast("无法复制，请检查剪贴板权限"); } });
  async function api(path, options = {}) { const res = await fetch(path, { credentials: "include", cache: "no-store", ...options }); if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || "加载失败"); } return res; }
  function renderCategories() {
    const spaces = model.categories.filter(name => name && name !== "最新动态");
    const pages = Math.max(1, Math.ceil(spaces.length / 8));
    model.categoryPage = Math.min(model.categoryPage, pages - 1);
    const visible = spaces.slice(model.categoryPage * 8, model.categoryPage * 8 + 8);
    const bar = $("blogPrivateCategoryBar");
    const latestPill = `<button class="cat-pill ${model.category === "all" ? "is-active" : ""}" type="button" data-private-category="all" aria-pressed="${model.category === "all"}">最新动态</button>`;
    bar.innerHTML = latestPill + visible.map(name => `<button class="cat-pill ${model.category === name ? "is-active" : ""}" type="button" data-private-category="${escapeHtml(name)}" aria-pressed="${model.category === name}">${escapeHtml(name)}</button>`).join("");
    $("blogPrivateCategoryPages").hidden = pages <= 1;
    $("blogPrivateCategoriesPrev").disabled = model.categoryPage === 0;
    $("blogPrivateCategoriesNext").disabled = model.categoryPage >= pages - 1;
  }
  let carouselPaused = false;
  function getCarouselPosts() {
    const scoped = model.category === "all" ? model.posts : model.posts.filter(post => post.category === model.category);
    if (!scoped.length) return [];
    const featured = scoped.filter(post => post.featured);
    return featured.length > 0 ? featured : scoped;
  }
  function renderCarousel(dir = 0) {
    const box = $("blogPrivateCarouselBox");
    if (!box) return;
    const list = getCarouselPosts();
    const scopeLabel = model.category === "all" ? "最新动态" : model.category;
    if (!list.length) {
      box.classList.add("is-empty");
      $("blogPrivateCarouselBadge").textContent = `${scopeLabel} · 0 / 0`;
      $("blogPrivateCarouselTitle").textContent = "暂无私密手记";
      $("blogPrivateCarouselDesc").textContent = model.category === "all" ? "还没有发布私密手记，发布后将在此轮播展示。" : `「${model.category}」板块下还没有文章，发布后将在此轮播展示。`;
      $("blogPrivateCarouselDate").textContent = "—";
      $("blogPrivateCarouselPrev").disabled = true;
      $("blogPrivateCarouselNext").disabled = true;
      return;
    }
    box.classList.remove("is-empty");
    if (model.carouselIndex >= list.length) model.carouselIndex = 0;
    const post = list[model.carouselIndex];
    if (dir !== 0) {
      box.style.setProperty("--slide-dir", dir > 0 ? "12px" : "-12px");
      box.classList.add("is-switch-prep");
      void box.offsetWidth;
      requestAnimationFrame(() => box.classList.remove("is-switch-prep"));
    }
    $("blogPrivateCarouselBadge").textContent = `${scopeLabel} · ${model.carouselIndex + 1} / ${list.length}`;
    $("blogPrivateCarouselTitle").textContent = post.title;
    $("blogPrivateCarouselDesc").textContent = post.excerpt || "点击阅读完整私密手记";
    $("blogPrivateCarouselDate").textContent = post.date;
    $("blogPrivateCarouselPrev").disabled = list.length <= 1;
    $("blogPrivateCarouselNext").disabled = list.length <= 1;
  }
  async function openPrivatePost(id) {
    try {
      const data = await (await api(`/api/private-posts?id=${encodeURIComponent(id)}`)).json();
      $("blogPrivateReaderTitle").textContent = data.post.title;
      $("blogPrivateReaderMeta").textContent = `${data.post.category} · ${data.post.date}`;
      $("blogPrivateReaderBody").innerHTML = renderMarkdown(data.post.body);
      reader.showModal();
    } catch (error) { $("blogPrivateStatus").textContent = error.message; }
  }
  function render() {
    renderCarousel(0);
    const list = model.posts.filter(post => (model.category === "all" || post.category === model.category) && `${post.title} ${post.excerpt}`.toLowerCase().includes(model.query.toLowerCase()));
    const pages = Math.max(1, Math.ceil(list.length / PRIVATE_PAGE_SIZE)); model.page = Math.min(model.page, pages);
    const visible = list.slice((model.page - 1) * PRIVATE_PAGE_SIZE, model.page * PRIVATE_PAGE_SIZE);
    $("blogPrivateCards").innerHTML = visible.map(post => `<article class="article-card"><button class="private-post-open" type="button" data-private-post="${escapeHtml(post.id)}"><h3 class="article-card-title">${escapeHtml(post.title)}</h3><p class="article-card-desc">${escapeHtml(post.excerpt)}</p></button><div class="article-card-footer tabular"><span>${escapeHtml(post.category)}</span><span>${escapeHtml(post.date)}</span>${allowed("private_export") ? `<button class="tactile-btn" type="button" data-private-export="${escapeHtml(post.id)}">下载</button>` : ""}</div></article>`).join("") + buildArticlePlaceholders(PRIVATE_PAGE_SIZE - visible.length, !list.length);
    $("blogPrivatePage").textContent = `${list.length ? model.page : 0} / ${list.length ? pages : 0}`;
    $("blogPrivatePrev").disabled = model.page <= 1; $("blogPrivateNext").disabled = model.page >= pages;
  }
  async function show(query = "", force = false) {
    if (force) bioIdentity = "";
    syncIntro();
    if (model.query !== query) model.page = 1; model.query = query;
    const unlock = Boolean(allowed("private_read"));
    $("blogPrivateLocked").hidden = unlock; $("blogPrivateContent").hidden = !unlock; $("blogPrivateLogin").hidden = Boolean(currentUser);
    if (!unlock) { if (reader.open) reader.close(); $("blogPrivateReaderBody").replaceChildren(); ++model.revision; model.posts = []; model.carouselIndex = 0; model.loaded = false; model.loading = false; renderCarousel(0); $("blogPrivateCards").replaceChildren(); return; }
    const identity = `${currentUser.id}:${currentUser.role}`;
    if (model.loading && model.identity === identity) return;
    if (model.loaded && model.identity === identity && !force) { render(); return; }
    if (model.identity !== identity) { model.posts = []; model.loaded = false; $("blogPrivateCards").replaceChildren(); }
    const revision = ++model.revision; model.loading = true; model.identity = identity; $("blogPrivateStatus").textContent = "正在读取隐秘文章…";
    try {
      const data = await (await api("/api/private-posts")).json(); if (revision !== model.revision) return;
      model.posts = data.posts || []; model.loaded = true;
      model.categories = [...new Set((data.categories || []).filter(name => name && name !== "最新动态"))];
      if (model.category !== "all" && !model.categories.includes(model.category)) model.category = "all";
      renderCategories();
      render(); $("blogPrivateStatus").textContent = "";
    } catch (error) { if (revision === model.revision) $("blogPrivateStatus").textContent = error.message; }
    finally { if (revision === model.revision) model.loading = false; }
  }
  $("blogPrivateCards").addEventListener("click", async event => {
    const open = event.target.closest("[data-private-post]"), download = event.target.closest("[data-private-export]");
    if (!open && !download) return;
    const id = (open || download).dataset[open ? "privatePost" : "privateExport"];
    try {
      if (download) { const res = await api(`/api/private-posts?id=${encodeURIComponent(id)}&download=1`), post = model.posts.find(item => item.id === id), url = URL.createObjectURL(await res.blob()), a = document.createElement("a"); a.href = url; a.download = `${post?.title || "private-note"}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
      await openPrivatePost(id);
    } catch (error) { $("blogPrivateStatus").textContent = error.message; }
  });
  const privateCarouselBox = $("blogPrivateCarouselBox");
  if (privateCarouselBox) {
    privateCarouselBox.addEventListener("mouseenter", () => { carouselPaused = true; });
    privateCarouselBox.addEventListener("mouseleave", () => { carouselPaused = false; });
    $("blogPrivateCarouselPrev")?.addEventListener("click", event => {
      event.stopPropagation();
      const list = getCarouselPosts();
      if (list.length <= 1) return;
      model.carouselIndex = (model.carouselIndex - 1 + list.length) % list.length;
      renderCarousel(-1);
    });
    $("blogPrivateCarouselNext")?.addEventListener("click", event => {
      event.stopPropagation();
      const list = getCarouselPosts();
      if (list.length <= 1) return;
      model.carouselIndex = (model.carouselIndex + 1) % list.length;
      renderCarousel(1);
    });
    privateCarouselBox.addEventListener("click", () => {
      const list = getCarouselPosts();
      if (list[model.carouselIndex]) openPrivatePost(list[model.carouselIndex].id);
    });
    privateCarouselBox.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const list = getCarouselPosts();
      if (!list[model.carouselIndex]) return;
      event.preventDefault();
      openPrivatePost(list[model.carouselIndex].id);
    });
    setInterval(() => {
      if (carouselPaused || reader.open || state.filter !== "private") return;
      const list = getCarouselPosts();
      if (list.length <= 1) return;
      model.carouselIndex = (model.carouselIndex + 1) % list.length;
      renderCarousel(1);
    }, 5000);
  }
  $("blogPrivateCategoryBar").addEventListener("click", event => {
    const button = event.target.closest("[data-private-category]"); if (!button) return;
    const next = button.dataset.privateCategory;
    if (next === model.category) return;
    model.category = next;
    model.page = 1; model.carouselIndex = 0; renderCategories(); render();
  });
  $("blogPrivateCategoriesPrev").addEventListener("click", () => { --model.categoryPage; renderCategories(); });
  $("blogPrivateCategoriesNext").addEventListener("click", () => { ++model.categoryPage; renderCategories(); });
  $("blogPrivatePrev").addEventListener("click", () => { --model.page; render(); }); $("blogPrivateNext").addEventListener("click", () => { ++model.page; render(); });
  $("blogPrivateLogin").addEventListener("click", () => authTriggerBtn.click());
  const privateBot = $("privateRobotBuddy"), privateBubble = $("privateRobotBubble"), privateEyes = $("privateRobotEyesTrack");
  const botLines = ["哔哔，输入 VIP 邀请码即可解锁", "点我干嘛？快去兑换邀请码啦", "管理员和 VIP 都能直接阅读哦", "还没登录？可以先点击左侧登录 / 注册"];
  let botLineIndex = 0, botTapTimer = 0, botAlertTimer = 0, botEyeFrame = 0;
  const setBotBubble = (text, mode = "") => {
    if (!privateBot || !privateBubble) return;
    privateBubble.textContent = text;
    privateBot.classList.remove("is-alert", "is-happy");
    if (mode) privateBot.classList.add(mode);
    clearTimeout(botAlertTimer);
    if (mode === "is-alert") botAlertTimer = setTimeout(() => privateBot.classList.remove("is-alert"), 2200);
  };
  if (privateBot) {
    privateBot.addEventListener("click", () => {
      botLineIndex = (botLineIndex + 1) % botLines.length;
      setBotBubble(botLines[botLineIndex]);
      privateBot.classList.remove("is-tapped");
      void privateBot.offsetWidth;
      privateBot.classList.add("is-tapped");
      clearTimeout(botTapTimer);
      botTapTimer = setTimeout(() => privateBot.classList.remove("is-tapped"), 440);
    });
    document.addEventListener("pointermove", event => {
      if (event.pointerType !== "mouse" || !privateEyes || $("blogPrivateLocked").hidden || $("blogPrivatePanel").hidden) return;
      if (botEyeFrame) cancelAnimationFrame(botEyeFrame);
      const { clientX, clientY } = event;
      botEyeFrame = requestAnimationFrame(() => {
        botEyeFrame = 0;
        const rect = privateBot.getBoundingClientRect();
        if (!rect.width) return;
        const dx = Math.tanh((clientX - (rect.left + rect.width / 2)) / 180) * 3;
        const dy = Math.tanh((clientY - (rect.top + rect.height / 2)) / 180) * 2;
        privateEyes.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      });
    }, { passive: true });
  }
  const codeInput = $("blogPrivateCode");
  if (codeInput && privateBot) {
    codeInput.addEventListener("focus", () => {
      privateBot.classList.add("is-scanning");
      setBotBubble(codeInput.value.trim() ? "核对好邀请码就可以兑换啦" : "正在等待输入 VIP 邀请码…");
    });
    codeInput.addEventListener("input", () => {
      const len = codeInput.value.trim().length;
      setBotBubble(len ? `已输入 ${len} 位，点击兑换试试` : "正在等待输入 VIP 邀请码…");
    });
    codeInput.addEventListener("blur", () => privateBot.classList.remove("is-scanning"));
  }
  $("blogPrivateUnlock").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser) {
      $("blogPrivateStatus").textContent = "请先登录，或在注册时填写邀请码";
      setBotBubble("请先登录账号，再兑换邀请码", "is-alert");
      $("blogPrivateLogin").click();
      return;
    }
    const submit = event.submitter || $("blogPrivateSubmit"), label = submit ? submit.textContent : "";
    if (submit) { submit.disabled = true; submit.textContent = "兑换中…"; }
    setBotBubble("正在核验邀请码…");
    try {
      const data = await (await api("/api/auth", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({action:"redeem_invite",inviteCode:$("blogPrivateCode").value.trim()}) })).json();
      currentUser = data.user; $("blogPrivateCode").value = ""; levelPermissionIdentity = ""; refreshLevelPermissions(); syncAuthUI();
      setBotBubble("解锁成功！欢迎进入隐秘空间", "is-happy");
      $("blogPrivateStatus").textContent = "邀请码已兑换，正在同步权限…";
    }
    catch(error) {
      setBotBubble(error.message || "邀请码无效或已过期", "is-alert");
      $("blogPrivateStatus").textContent = error.message;
    } finally { if (submit) { submit.disabled = false; submit.textContent = label || "兑换邀请码"; } }
  });
  window.blogPrivateSpace = { show, beginLayout: beginIntroLayout, restoreIntro() { restoreIntroLayout(); ++bioRevision; bioIdentity = ""; restoreIntro(); } };
})();
