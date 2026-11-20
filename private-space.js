(() => {
  const $ = id => document.getElementById(id);
  const model = { posts: [], category: "all", query: "", page: 1, identity: "", loaded: false, loading: false, revision: 0 };
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
  function render() {
    const list = model.posts.filter(post => (model.category === "all" || post.category === model.category) && `${post.title} ${post.excerpt}`.toLowerCase().includes(model.query.toLowerCase()));
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); model.page = Math.min(model.page, pages);
    const visible = list.slice((model.page - 1) * PAGE_SIZE, model.page * PAGE_SIZE);
    $("blogPrivateCards").innerHTML = visible.map(post => `<article class="article-card"><button class="private-post-open" type="button" data-private-post="${escapeHtml(post.id)}"><h3 class="article-card-title">${escapeHtml(post.title)}</h3><p class="article-card-desc">${escapeHtml(post.excerpt)}</p></button><div class="article-card-footer tabular"><span>${escapeHtml(post.category)}</span><span>${escapeHtml(post.date)}</span>${allowed("private_export") ? `<button class="tactile-btn" type="button" data-private-export="${escapeHtml(post.id)}">下载</button>` : ""}</div></article>`).join("") + buildArticlePlaceholders(PAGE_SIZE - visible.length, !list.length);
    $("blogPrivatePage").textContent = `${list.length ? model.page : 0} / ${list.length ? pages : 0}`;
    $("blogPrivatePrev").disabled = model.page <= 1; $("blogPrivateNext").disabled = model.page >= pages;
  }
  async function show(query = "", force = false) {
    if (force) bioIdentity = "";
    syncIntro();
    if (model.query !== query) model.page = 1; model.query = query;
    const unlock = Boolean(allowed("private_read"));
    $("blogPrivateLocked").hidden = unlock; $("blogPrivateContent").hidden = !unlock; $("blogPrivateLogin").hidden = Boolean(currentUser);
    if (!unlock) { if (reader.open) reader.close(); $("blogPrivateReaderBody").replaceChildren(); ++model.revision; model.posts = []; model.loaded = false; model.loading = false; $("blogPrivateCards").replaceChildren(); return; }
    const identity = `${currentUser.id}:${currentUser.role}`;
    if (model.loading && model.identity === identity) return;
    if (model.loaded && model.identity === identity && !force) { render(); return; }
    if (model.identity !== identity) { model.posts = []; model.loaded = false; $("blogPrivateCards").replaceChildren(); }
    const revision = ++model.revision; model.loading = true; model.identity = identity; $("blogPrivateStatus").textContent = "正在读取隐秘文章…";
    try {
      const data = await (await api("/api/private-posts")).json(); if (revision !== model.revision) return;
      model.posts = data.posts || []; model.loaded = true;
      const select = $("blogPrivateCategory"); select.replaceChildren(new Option("全部分类", "all"), ...(data.categories || []).map(name => new Option(name, name)));
      if (![...select.options].some(option => option.value === model.category)) model.category = "all"; select.value = model.category;
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
      const data = await (await api(`/api/private-posts?id=${encodeURIComponent(id)}`)).json();
      $("blogPrivateReaderTitle").textContent = data.post.title; $("blogPrivateReaderMeta").textContent = `${data.post.category} · ${data.post.date}`; $("blogPrivateReaderBody").innerHTML = renderMarkdown(data.post.body); reader.showModal();
    } catch (error) { $("blogPrivateStatus").textContent = error.message; }
  });
  $("blogPrivateCategory").addEventListener("change", event => { model.category = event.target.value; model.page = 1; render(); });
  $("blogPrivatePrev").addEventListener("click", () => { --model.page; render(); }); $("blogPrivateNext").addEventListener("click", () => { ++model.page; render(); });
  $("blogPrivateRefresh").addEventListener("click", () => show(model.query, true));
  $("blogPrivateLogin").addEventListener("click", () => authTriggerBtn.click());
  $("blogPrivateUnlock").addEventListener("submit", async event => {
    event.preventDefault(); if (!currentUser) { $("blogPrivateStatus").textContent = "请先登录，或在注册时填写邀请码"; $("blogPrivateLogin").click(); return; }
    const submit = event.submitter; if (submit) submit.disabled = true;
    try { const data = await (await api("/api/auth", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({action:"redeem_invite",inviteCode:$("blogPrivateCode").value.trim()}) })).json(); currentUser = data.user; $("blogPrivateCode").value = ""; levelPermissionIdentity = ""; refreshLevelPermissions(); syncAuthUI(); $("blogPrivateStatus").textContent = "邀请码已兑换，正在同步权限…"; }
    catch(error) { $("blogPrivateStatus").textContent = error.message; } finally { if (submit) submit.disabled = false; }
  });
  window.blogPrivateSpace = { show, beginLayout: beginIntroLayout, restoreIntro() { restoreIntroLayout(); ++bioRevision; bioIdentity = ""; restoreIntro(); } };
})();
