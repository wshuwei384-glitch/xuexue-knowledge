import React, { useEffect, useMemo, useState } from "react";
import { supabase, hasSupabaseConfig } from "./lib/supabase";
import { DEFAULT_CATEGORIES, IMPORTANCE, NAV_ITEMS, SCENES, STATUSES } from "./lib/constants";
import { downloadText, toCsv } from "./lib/csv";

const emptyForm = {
  title: "",
  content: "",
  category_name: "心内科",
  new_category: "",
  tags_text: "",
  importance: "普通",
  source_scene: "上课",
  personal_note: "",
  status: "未复习"
};

function nowFileStamp() {
  return new Date().toISOString().slice(0, 19).replaceAll(":", "-");
}

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function canEdit(item, profile) {
  return Boolean(profile?.role === "admin" || item.created_by_user_id === profile?.id);
}

function normalizeTags(text) {
  return text
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildSummary(categoryName, items, profile) {
  const categoryItems = items.filter((item) => item.category_name === categoryName);
  const tagCounts = new Map();
  categoryItems.flatMap((item) => item.tags || []).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  const highTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => `${tag}(${count})`);

  return {
    category_name: categoryName,
    summary_text: `本次汇总包含 ${categoryItems.length} 条小知识。优先复习“重要”和“必背”的记录，并及时处理需要问老师的问题。`,
    key_points: categoryItems.slice(0, 12).map((item) => `${item.title || item.content.slice(0, 18)}（上传者：${item.created_by_username}）`),
    important_items: categoryItems.filter((item) => item.importance === "重要").map((item) => item.title || item.content.slice(0, 24)),
    must_remember_items: categoryItems.filter((item) => item.importance === "必背").map((item) => item.title || item.content.slice(0, 24)),
    questions_for_teacher: categoryItems.filter((item) => item.status === "需要问老师").map((item) => item.title || item.content.slice(0, 24)),
    tags: highTags,
    item_count: categoryItems.length,
    updated_by_user_id: profile.id,
    updated_by_username: profile.username
  };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "", username: "" });
  const [tab, setTab] = useState("home");
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingItem, setEditingItem] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState({ q: "", category: "", tag: "", importance: "", status: "" });
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return items.filter((item) => new Date(item.created_at).toDateString() === today).length;
  }, [items]);

  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags || []))], [items]);
  const recentItems = useMemo(() => items.slice(0, 4), [items]);
  const reviewItems = useMemo(
    () => items.filter((item) => item.status === "待复习" || item.status === "需要问老师" || item.importance === "必背"),
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = `${item.title} ${item.content} ${item.personal_note} ${(item.tags || []).join(" ")}`.toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (!filters.category || item.category_name === filters.category) &&
        (!filters.tag || (item.tags || []).includes(filters.tag)) &&
        (!filters.importance || item.importance === filters.importance) &&
        (!filters.status || item.status === filters.status)
      );
    });
  }, [filters, items]);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    ensureProfile(session.user);
  }, [session]);

  useEffect(() => {
    if (!profile) return;
    refreshAll();
  }, [profile]);

  async function ensureProfile(user) {
    const { data } = await supabase.from("users").select("*").eq("id", user.id).maybeSingle();
    if (data) {
      setProfile(data);
      return;
    }
    const username = user.user_metadata?.username || user.email?.split("@")[0] || "新同学";
    const { data: created, error } = await supabase
      .from("users")
      .insert({ id: user.id, email: user.email, username, role: "member" })
      .select()
      .single();
    if (error) return showToast(error.message);
    setProfile(created);
  }

  async function refreshAll() {
    setLoading(true);
    const [itemRes, categoryRes, summaryRes] = await Promise.all([
      supabase.from("knowledge_items").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name"),
      supabase.from("summaries").select("*").order("updated_at", { ascending: false })
    ]);
    setLoading(false);
    if (itemRes.error || categoryRes.error || summaryRes.error) {
      showToast(itemRes.error?.message || categoryRes.error?.message || summaryRes.error?.message);
      return;
    }
    setItems(itemRes.data || []);
    setCategories(categoryRes.data?.length ? categoryRes.data : DEFAULT_CATEGORIES.map((name) => ({ name })));
    setSummaries(summaryRes.data || []);
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    const payload = { email: authForm.email, password: authForm.password };
    const result =
      authMode === "login"
        ? await supabase.auth.signInWithPassword(payload)
        : await supabase.auth.signUp({ ...payload, options: { data: { username: authForm.username } } });
    setLoading(false);
    if (result.error) return showToast(result.error.message);
    showToast(authMode === "login" ? "欢迎回来，今天也抓住小知识" : "注册成功，请继续登录或查收确认邮件");
  }

  async function saveItem(event) {
    event.preventDefault();
    const categoryName = form.new_category.trim() || form.category_name;
    const payload = {
      title: form.title.trim(),
      content: form.content.trim(),
      category_name: categoryName,
      tags: normalizeTags(form.tags_text),
      importance: form.importance,
      source_scene: form.source_scene,
      personal_note: form.personal_note.trim(),
      status: form.status,
      updated_at: new Date().toISOString(),
      last_edited_by_user_id: profile.id,
      last_edited_by_username: profile.username
    };
    if (!payload.content) return showToast("正文是必填项");

    const result = editingItem
      ? await supabase.from("knowledge_items").update(payload).eq("id", editingItem.id).select().single()
      : await supabase
          .from("knowledge_items")
          .insert({
            ...payload,
            created_by_user_id: profile.id,
            created_by_username: profile.username
          })
          .select()
          .single();

    if (result.error) return showToast(result.error.message);
    if (form.new_category.trim()) await addCategory(form.new_category.trim(), false);
    setForm({ ...emptyForm, category_name: categoryName });
    setEditingItem(null);
    setSelectedItem(null);
    setTab("items");
    await refreshAll();
    showToast(editingItem ? "更新成功，最近编辑者已记录" : "记录成功，知识被抓住啦");
  }

  async function addCategory(name, refresh = true) {
    if (!name.trim()) return;
    const exists = categories.some((category) => category.name === name.trim());
    if (exists) return;
    const { error } = await supabase.from("categories").insert({
      name: name.trim(),
      created_by_user_id: profile.id,
      created_by_username: profile.username
    });
    if (error) showToast(error.message);
    if (refresh) await refreshAll();
  }

  async function renameCategory(category, name) {
    if (profile.role !== "admin") return showToast("只有管理员可以修改分类");
    const nextName = name.trim();
    if (!nextName) return;
    const { error } = await supabase.from("categories").update({ name: nextName }).eq("id", category.id);
    if (error) return showToast(error.message);
    await supabase.from("knowledge_items").update({ category_name: nextName }).eq("category_name", category.name);
    await refreshAll();
    showToast("分类已更新");
  }

  async function deleteCategory(category) {
    if (profile.role !== "admin") return showToast("只有管理员可以删除分类");
    if (!window.confirm(`确定删除分类“${category.name}”吗？已有知识点不会被删除。`)) return;
    const { error } = await supabase.from("categories").delete().eq("id", category.id);
    if (error) return showToast(error.message);
    await refreshAll();
    showToast("分类已删除");
  }

  async function deleteItem(item) {
    if (!canEdit(item, profile)) return showToast("只能删除自己上传的记录，管理员可以删除全部");
    if (!window.confirm("确定删除这条小知识吗？删除后不能恢复。")) return;
    const { error } = await supabase.from("knowledge_items").delete().eq("id", item.id);
    if (error) return showToast(error.message);
    setSelectedItem(null);
    await refreshAll();
    showToast("已删除");
  }

  async function setItemStatus(item, status) {
    if (!canEdit(item, profile)) return showToast("只能修改自己上传的记录，管理员可以修改全部");
    const { error } = await supabase
      .from("knowledge_items")
      .update({
        status,
        updated_at: new Date().toISOString(),
        last_edited_by_user_id: profile.id,
        last_edited_by_username: profile.username
      })
      .eq("id", item.id);
    if (error) return showToast(error.message);
    await refreshAll();
  }

  function startEdit(item) {
    setEditingItem(item);
    setForm({
      title: item.title || "",
      content: item.content || "",
      category_name: item.category_name || "心内科",
      new_category: "",
      tags_text: (item.tags || []).join("，"),
      importance: item.importance || "普通",
      source_scene: item.source_scene || "上课",
      personal_note: item.personal_note || "",
      status: item.status || "未复习"
    });
    setTab("record");
  }

  async function updateSummary(categoryName) {
    const summary = buildSummary(categoryName, items, profile);
    const existing = summaries.find((row) => row.category_name === categoryName);
    const result = existing
      ? await supabase.from("summaries").update(summary).eq("id", existing.id)
      : await supabase.from("summaries").insert(summary);
    if (result.error) return showToast(result.error.message);
    await refreshAll();
    showToast("总结已更新，小知识排好队了");
  }

  async function importJson(file) {
    if (!file) return;
    const text = await file.text();
    const rows = JSON.parse(text);
    const payload = rows.map((row) => ({
      title: row.title || "",
      content: row.content || "",
      category_name: row.category_name || row.category || "杂项",
      tags: Array.isArray(row.tags) ? row.tags : normalizeTags(row.tags || ""),
      importance: row.importance || "普通",
      source_scene: row.source_scene || "其他",
      personal_note: row.personal_note || "",
      status: row.status || "未复习",
      created_by_user_id: profile.id,
      created_by_username: profile.username,
      last_edited_by_user_id: profile.id,
      last_edited_by_username: profile.username
    }));
    const { error } = await supabase.from("knowledge_items").insert(payload);
    if (error) return showToast(error.message);
    await refreshAll();
    showToast("导入完成");
  }

  if (!hasSupabaseConfig) return <SetupNotice />;
  if (!session || !profile) return <AuthPage mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} onSubmit={handleAuth} loading={loading} />;

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}
      <header className="topbar">
        <div>
          <p className="eyebrow">雪花小本本</p>
          <h1>雪雪老师小知识</h1>
        </div>
        <button className="user-pill" onClick={() => setTab("settings")}>{profile.username}</button>
      </header>

      <main className="screen">
        {tab === "home" && <Home items={items} recentItems={recentItems} todayCount={todayCount} reviewItems={reviewItems} setTab={setTab} />}
        {tab === "record" && <RecordForm form={form} setForm={setForm} categories={categories} editingItem={editingItem} onCancel={() => { setEditingItem(null); setForm(emptyForm); }} onSubmit={saveItem} />}
        {tab === "items" && <ItemsPage items={filteredItems} categories={categories} tags={tags} filters={filters} setFilters={setFilters} selectedItem={selectedItem} setSelectedItem={setSelectedItem} profile={profile} startEdit={startEdit} deleteItem={deleteItem} setItemStatus={setItemStatus} loading={loading} />}
        {tab === "summaries" && <SummariesPage categories={categories} items={items} summaries={summaries} profile={profile} addCategory={addCategory} renameCategory={renameCategory} deleteCategory={deleteCategory} updateSummary={updateSummary} />}
        {tab === "review" && <ReviewPage items={reviewItems} setSelectedItem={setSelectedItem} setTab={setTab} setItemStatus={setItemStatus} />}
        {tab === "settings" && <SettingsPage profile={profile} items={items} onLogout={() => supabase.auth.signOut()} importJson={importJson} />}
      </main>

      <button className="fab" onClick={() => setTab("record")}>＋</button>
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function SetupNotice() {
  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">需要连接云端数据库</p>
        <h1>请先配置 Supabase</h1>
        <p>复制 .env.example 为 .env.local，填入 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY，然后执行 README 里的建表 SQL。</p>
      </div>
    </section>
  );
}

function AuthPage({ mode, setMode, form, setForm, onSubmit, loading }) {
  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="eyebrow">多人协作小知识库</p>
        <h1>雪雪老师小知识</h1>
        {mode === "signup" && <input placeholder="显示名称，例如阿婷" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}
        <input type="email" placeholder="邮箱" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input type="password" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
        <button className="primary" disabled={loading}>{mode === "login" ? "登录" : "注册"}</button>
        <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "还没有账号，去注册" : "已有账号，去登录"}
        </button>
      </form>
    </section>
  );
}

function Home({ items, recentItems, todayCount, reviewItems, setTab }) {
  return (
    <>
      <section className="hero">
        <p>今天也捕捉到新的小知识了吗？</p>
        <button onClick={() => setTab("record")}>快速记录</button>
      </section>
      <section className="stats-grid">
        <Stat label="今日新增" value={todayCount} />
        <Stat label="总记录" value={items.length} />
        <Stat label="待复习" value={reviewItems.length} />
        <Stat label="问老师" value={items.filter((item) => item.status === "需要问老师").length} />
      </section>
      <SectionTitle title="最近记录" action="看全部" onClick={() => setTab("items")} />
      <ItemList items={recentItems} compact />
    </>
  );
}

function Stat({ label, value }) {
  return <div className="stat"><b>{value}</b><span>{label}</span></div>;
}

function SectionTitle({ title, action, onClick }) {
  return <div className="section-title"><h2>{title}</h2>{action && <button onClick={onClick}>{action}</button>}</div>;
}

function RecordForm({ form, setForm, categories, editingItem, onCancel, onSubmit }) {
  const update = (key, value) => setForm({ ...form, [key]: value });
  return (
    <form className="form-page" onSubmit={onSubmit}>
      <h2>{editingItem ? "编辑小知识" : "快速记录"}</h2>
      <input placeholder="标题，可选" value={form.title} onChange={(e) => update("title", e.target.value)} />
      <textarea placeholder="老师原话/知识点正文，必填" value={form.content} onChange={(e) => update("content", e.target.value)} required rows={7} />
      <div className="two-col">
        <select value={form.category_name} onChange={(e) => update("category_name", e.target.value)}>{categories.map((category) => <option key={category.name}>{category.name}</option>)}</select>
        <input placeholder="新分类，可选" value={form.new_category} onChange={(e) => update("new_category", e.target.value)} />
      </div>
      <input placeholder="标签，用逗号分隔，例如 AMI，心衰" value={form.tags_text} onChange={(e) => update("tags_text", e.target.value)} />
      <div className="two-col">
        <select value={form.importance} onChange={(e) => update("importance", e.target.value)}>{IMPORTANCE.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={form.source_scene} onChange={(e) => update("source_scene", e.target.value)}>{SCENES.map((x) => <option key={x}>{x}</option>)}</select>
      </div>
      <textarea placeholder="自己的理解或补充，可选" value={form.personal_note} onChange={(e) => update("personal_note", e.target.value)} rows={4} />
      <select value={form.status} onChange={(e) => update("status", e.target.value)}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
      <div className="actions"><button className="primary">保存</button>{editingItem && <button type="button" onClick={onCancel}>取消编辑</button>}</div>
    </form>
  );
}

function ItemsPage(props) {
  const { items, categories, tags, filters, setFilters, selectedItem, setSelectedItem, profile, startEdit, deleteItem, setItemStatus, loading } = props;
  if (selectedItem) return <Detail item={selectedItem} profile={profile} startEdit={startEdit} deleteItem={deleteItem} setItemStatus={setItemStatus} onBack={() => setSelectedItem(null)} />;
  return (
    <>
      <FilterBar filters={filters} setFilters={setFilters} categories={categories} tags={tags} />
      {loading ? <Empty text="正在整理小知识..." /> : items.length ? <ItemList items={items} onOpen={setSelectedItem} /> : <Empty text="这里还没有小知识，快去记录第一条吧~" />}
    </>
  );
}

function FilterBar({ filters, setFilters, categories, tags }) {
  const update = (key, value) => setFilters({ ...filters, [key]: value });
  return (
    <section className="filters">
      <input placeholder="搜索关键词" value={filters.q} onChange={(e) => update("q", e.target.value)} />
      <div className="filter-row">
        <select value={filters.category} onChange={(e) => update("category", e.target.value)}><option value="">全部分类</option>{categories.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        <select value={filters.tag} onChange={(e) => update("tag", e.target.value)}><option value="">全部标签</option>{tags.map((x) => <option key={x}>{x}</option>)}</select>
      </div>
      <div className="filter-row">
        <select value={filters.importance} onChange={(e) => update("importance", e.target.value)}><option value="">重要程度</option>{IMPORTANCE.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={filters.status} onChange={(e) => update("status", e.target.value)}><option value="">全部状态</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
      </div>
    </section>
  );
}

function ItemList({ items, onOpen, compact = false }) {
  if (!items.length) return <Empty text="暂时没有记录" />;
  return <section className="card-list">{items.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={onOpen} compact={compact} />)}</section>;
}

function KnowledgeCard({ item, onOpen, compact }) {
  return (
    <article className={`knowledge-card ${item.status === "需要问老师" ? "question" : ""}`} onClick={() => onOpen?.(item)}>
      <div className="card-head"><h3>{item.title || "未命名小知识"}</h3><span className={`badge ${item.importance}`}>{item.importance}</span></div>
      <p>{compact ? item.content.slice(0, 80) : item.content}</p>
      <div className="tags"><span>{item.category_name}</span>{(item.tags || []).slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <footer>上传者：{item.created_by_username} · {formatTime(item.created_at)}<br />最近编辑：{item.last_edited_by_username || item.created_by_username} · {formatTime(item.updated_at)}</footer>
    </article>
  );
}

function Detail({ item, profile, startEdit, deleteItem, setItemStatus, onBack }) {
  return (
    <article className="detail">
      <button onClick={onBack}>返回列表</button>
      <h2>{item.title || "未命名小知识"}</h2>
      <p className="main-content">{item.content}</p>
      <div className="meta-grid">
        <span>分类：{item.category_name}</span><span>重要：{item.importance}</span><span>场景：{item.source_scene}</span><span>状态：{item.status}</span>
      </div>
      {!!item.personal_note && <section><h3>我的理解/补充</h3><p>{item.personal_note}</p></section>}
      <div className="tags">{(item.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <footer>上传者：{item.created_by_username} · {formatTime(item.created_at)}<br />最近编辑者：{item.last_edited_by_username} · {formatTime(item.updated_at)}</footer>
      <div className="actions wrap">
        {STATUSES.filter((status) => status !== item.status).map((status) => <button key={status} onClick={() => setItemStatus(item, status)}>标记{status}</button>)}
        {canEdit(item, profile) && <button className="primary" onClick={() => startEdit(item)}>编辑</button>}
        {canEdit(item, profile) && <button className="danger" onClick={() => deleteItem(item)}>删除</button>}
      </div>
    </article>
  );
}

function SummariesPage({ categories, items, summaries, profile, addCategory, renameCategory, deleteCategory, updateSummary }) {
  const [newName, setNewName] = useState("");
  const [renameMap, setRenameMap] = useState({});

  return (
    <>
      <section className="category-manager">
        <div className="card-head"><h2>分类管理</h2><span>{profile.role === "admin" ? "管理员" : "成员"}</span></div>
        <div className="filter-row">
          <input placeholder="新增分类" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="primary" onClick={() => { addCategory(newName); setNewName(""); }}>新增</button>
        </div>
      </section>
      <section className="summary-grid">
        {categories.map((category) => {
          const summary = summaries.find((row) => row.category_name === category.name);
          const count = items.filter((item) => item.category_name === category.name).length;
          const canManage = profile.role === "admin";
          return (
            <article className="summary-card" key={category.name}>
              <div className="card-head"><h3>{category.name}</h3><span>{count} 条</span></div>
              {summary ? <SummaryBody summary={summary} /> : <p>还没有总结，小知识正在排队。</p>}
              <div className="actions wrap">
                <button className="primary" onClick={() => updateSummary(category.name)}>更新总结</button>
                {canManage && category.id && <input className="rename-input" placeholder="输入新分类名" value={renameMap[category.id] || ""} onChange={(e) => setRenameMap({ ...renameMap, [category.id]: e.target.value })} />}
                {canManage && category.id && <button onClick={() => renameCategory(category, renameMap[category.id] || "")}>改名</button>}
                {profile.role === "admin" && category.id && <button className="danger" onClick={() => deleteCategory(category)}>删除</button>}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

function SummaryBody({ summary }) {
  return (
    <div className="summary-body">
      <p>{summary.summary_text}</p>
      <b>高频标签</b><p>{(summary.tags || []).join("、") || "暂无"}</p>
      <b>核心知识点</b><ul>{(summary.key_points || []).slice(0, 5).map((x) => <li key={x}>{x}</li>)}</ul>
      <b>需要问老师</b><p>{(summary.questions_for_teacher || []).join("、") || "暂无"}</p>
      <small>最后更新：{formatTime(summary.updated_at)} · {summary.updated_by_username}</small>
    </div>
  );
}

function ReviewPage({ items, setSelectedItem, setTab, setItemStatus }) {
  return (
    <>
      <SectionTitle title="待复习" />
      {items.length ? <section className="card-list">{items.map((item) => (
        <article className="knowledge-card review" key={item.id}>
          <KnowledgeCard item={item} />
          <div className="actions"><button onClick={() => { setSelectedItem(item); setTab("items"); }}>详情</button><button onClick={() => setItemStatus(item, "已掌握")}>已掌握</button><button onClick={() => setItemStatus(item, "已复习")}>已复习</button></div>
        </article>
      ))}</section> : <Empty text="暂时没有待复习内容，脑子今天逃过一劫。" />}
    </>
  );
}

function SettingsPage({ profile, items, onLogout, importJson }) {
  return (
    <section className="settings">
      <h2>我的</h2>
      <div className="profile-box"><b>{profile.username}</b><span>{profile.email}</span><span>角色：{profile.role}</span></div>
      <div className="actions wrap">
        <button onClick={() => downloadText(`xuexue-${nowFileStamp()}.json`, JSON.stringify(items, null, 2), "application/json")}>导出 JSON</button>
        <button onClick={() => downloadText(`xuexue-${nowFileStamp()}.csv`, toCsv(items), "text/csv;charset=utf-8")}>导出 CSV</button>
        <label className="file-btn">导入 JSON<input type="file" accept="application/json" onChange={(e) => importJson(e.target.files?.[0])} /></label>
        <button className="danger" onClick={onLogout}>退出登录</button>
      </div>
      <p className="note">数据保存在 Supabase 云端数据库中。后续可以在总结模块接入 AI，总结函数入口已预留在 buildSummary。</p>
    </section>
  );
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}
