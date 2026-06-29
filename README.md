# 雪雪老师小知识

一个移动端优先的多人协作知识库 MVP。适合多人一起记录老师上课、门诊、病房、组会、聊天或文献里提到的小知识点。

正式数据保存在 Supabase 云端数据库中，不使用 localStorage 作为正式数据源。不同用户登录后会看到同一个知识库。

## 已实现功能

- 邮箱注册、登录、退出登录
- 自动创建用户资料，包含 username、email、role
- 新增、编辑、删除知识点
- 自动记录上传者、上传时间、最近编辑者、最近更新时间
- 知识点列表、详情、搜索和筛选
- 分类、标签、重要程度、来源场景、复习状态
- 分类总结，先用规则汇总，预留后续 AI 总结入口
- 待复习页，支持一键标记已复习/已掌握
- JSON/CSV 导出，JSON 导入
- 手机端优先的清新小本本 UI

## 本地运行

1. 安装 Node.js 18 或更高版本。
2. 在项目目录安装依赖：

```bash
npm install
```

3. 复制环境变量文件：

```bash
cp .env.example .env.local
```

4. 填入 Supabase 信息：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

5. 启动：

```bash
npm run dev
```

## Supabase 配置

1. 打开 Supabase，新建项目。
2. 进入 Project Settings -> API，复制 Project URL 和 anon public key，填入 `.env.local`。
3. 进入 SQL Editor。
4. 打开 `supabase/schema.sql`，整段复制执行。
5. 进入 Authentication -> Providers，确保 Email 登录开启。
6. 如果不想要求邮箱确认，可在 Authentication -> Settings 里关闭 Confirm email。

## 数据保存在哪里

数据保存在 Supabase 的四张表：

- `users`：用户资料和角色
- `knowledge_items`：知识点
- `categories`：分类
- `summaries`：分类总结

## 权限逻辑

- 所有登录用户都可以新增知识点。
- 所有登录用户都可以查看全部知识点。
- 上传者本人可以编辑和删除自己上传的知识点。
- 管理员可以编辑和删除全部知识点。
- 管理员角色通过 `users.role = 'admin'` 判断。
- 删除前前端会二次确认，后端 RLS 也会限制越权删除。

把某个用户设为管理员，可以在 Supabase SQL Editor 里执行：

```sql
update public.users
set role = 'admin'
where email = '你的邮箱@example.com';
```

## 导入导出

在“我的”页面可以：

- 导出 JSON
- 导出 CSV
- 导入 JSON

导出的每条记录包含标题、正文、分类、标签、重要程度、状态、上传者、上传时间、最近编辑者和最近更新时间。

## AI 总结扩展

当前分类总结由 `src/App.jsx` 里的 `buildSummary` 函数生成，规则包括：

- 汇总同分类知识点
- 优先列出重要和必背记录
- 统计高频标签
- 列出需要问老师的问题
- 标明上传者

后续接入 AI 时，可以把 `buildSummary` 替换为调用后端 Edge Function 或自己的 API。建议不要在前端直接放 AI API Key。

## 部署建议

推荐部署到 Vercel、Netlify 或 Cloudflare Pages。

构建命令：

```bash
npm run build
```

构建产物目录：

```bash
dist
```

部署平台里也需要配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 自测清单

- 可以注册和登录。
- 登录后可以新增知识点。
- 新增知识点后列表显示上传者。
- 编辑知识点后显示最近编辑者。
- 只能编辑/删除自己的记录，管理员可以处理全部记录。
- 可以按分类、标签、重要程度、状态筛选。
- 可以查看详情。
- 可以生成分类总结。
- 待复习页能显示待复习、必背、需要问老师的内容。
- 可以导出 JSON 和 CSV。
- 可以导入 JSON。
- 手机宽度下页面不溢出、不遮挡。

## MVP 说明

这个版本优先保证多人协作、云端保存、上传者显示和核心记录流程。分类管理页、自动关键词提取、真正 AI 总结、通知提醒等功能已留出扩展位置，可在后续版本继续加。
