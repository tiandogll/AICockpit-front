# AICockpit 前端（PC + 手机版）

仓库：[tiandogll/AICockpit-front](https://github.com/tiandogll/AICockpit-front)。对应后端为 [AICockpit-end](https://github.com/tiandogll/AICockpit-end)。这是前端源码包，不包含数据库、API 服务或真实模型密钥。

## 目录

- `apps/web/`：原 PC 前端、公共业务组件、请求服务、素材与依赖锁文件。
- `apps/mobile/`：独立手机版入口、布局、样式与测试。
- `SOURCE-MANIFEST.json`：原项目提交及所有归档文件的 SHA-256。

两边源码及相对目录保持原样。手机版复用 `../web/src`、`../web/public` 和 `../web/node_modules`，不要只取 `apps/mobile`，也不要将其中一个目录单独搬到仓库根。没有带入原开发仓库 Git 历史、`.env`、密钥、依赖目录、构建产物或内部提交材料。原 monorepo CI 同时检查后端，未复制到这个前端仓库。

## 安装与本地启动

按 `apps/web/package.json` 的要求安装 Node.js；使用 pnpm 11。先让后端运行在 `http://localhost:18000`，再在仓库根安装前端依赖：

```powershell
pnpm --dir apps/web install --frozen-lockfile
```

PC 与手机分别用两个终端启动：

```powershell
# PC：http://localhost:5173/，符合后端默认开发 CORS
pnpm --dir apps/web dev --host localhost --port 5173 --strictPort
```

```powershell
# 手机样式：http://localhost:5174/
npm --prefix apps/mobile run dev
```

手机版通过 Vite 的 `/api` 代理访问 `127.0.0.1:18000`；PC 开发默认直连 `localhost:18000/api/v1`。连接不同后端时需显式配置对应 API 地址、代理与 CORS，不能只改仓库 URL。PC 与手机共享账号和业务 API，不需要两套数据库。

## 构建检查

```powershell
pnpm --dir apps/web build
npm --prefix apps/mobile run type-check
npm --prefix apps/mobile run build
```

产物分别位于 `apps/web/dist` 和 `apps/mobile/dist`，不提交 Git。生产环境前端默认使用同源 `/api/v1`，部署时需要反向代理到后端；源码上传 GitHub 不等于部署或自动接通 DeepSeek。

## SSH 上传

```powershell
ssh -T git@github.com
git remote -v
git push -u origin main
```

本次已整理的独立上传目录会保留该 GitHub 仓库原有提交，再加入当前前端源码，并配置 `origin=git@github.com:tiandogll/AICockpit-front.git`。从 ZIP 自行解压时不包含 `.git`；若远端已有提交，先 clone 再合并文件和提交，不要强制推送。首次 SSH 提示需核对 [GitHub 官方主机指纹](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)。

独立后端包只带一张共享题图用于离线审题，未混入前端应用代码。部分原应用 README 中的完整项目文档链接不属于这个拆分仓库。
