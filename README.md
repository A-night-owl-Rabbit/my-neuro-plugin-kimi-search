# Kimi 联网搜索插件（kimi-search）

这是给 My Neuro / 肥牛 live-2d 使用的社区插件。它把 Kimi 的联网搜索能力封装成 Function Calling 工具 `kimi_web_search`，主模型在需要查实时信息、新闻、赛事、版本更新、事实核验时可以自动调用。

本仓库已经把插件运行依赖和 Kimi-Free-API 后端放在插件目录内：

- 插件入口：`index.js`
- 插件配置：`plugin_config.json`
- 插件依赖：`node_modules/`
- 内置后端：`backend/kimi-free-api/`
- 后端入口：`backend/kimi-free-api/dist/index.js`

> 发布包里的 `refresh_token` 和 `official_api_key` 都是空值。不要把自己的 token、Cookie、API Key 或任何人设提示词提交到公开仓库。

## 功能特点

- `free_api` 模式：通过 Kimi-Free-API 调用 Kimi 网页版接口，支持 Kimi 自带联网搜索。
- `official` 模式：通过 Moonshot 官方 OpenAI 兼容接口调用，适合需要稳定付费 API 的场景。
- 支持普通联网问答和深度研究模式。
- 支持自动拉起本目录内的 `backend/kimi-free-api` 后端。
- 默认剥离引用列表、URL 脚注和检索中间过程，方便肥牛直接朗读或继续加工。

## 目录应该怎么放

把整个仓库目录作为插件目录放到：

```text
my-neuro-main/live-2d/plugins/community/kimi-search
```

放好后目录应类似：

```text
kimi-search/
  index.js
  metadata.json
  plugin_config.json
  package.json
  node_modules/
  backend/
    kimi-free-api/
      dist/index.js
      node_modules/
      package.json
```

不要只复制 `index.js`，否则依赖和内置后端会缺失。

## 启用插件

编辑：

```text
my-neuro-main/live-2d/plugins/enabled_plugins.json
```

在 `plugins` 数组中加入：

```json
"community/kimi-search"
```

启动肥牛后，日志里应该能看到类似：

```text
插件已加载: kimi-search
[Kimi联网搜索] 初始化完成
```

## free_api 模式配置（默认）

`free_api` 模式需要一个 Kimi 网页版账号的 `refresh_token`。

获取方式：

1. 浏览器打开并登录 `https://kimi.moonshot.cn`。
2. 随便发起一次对话。
3. 按 `F12` 打开开发者工具。
4. 进入 `Application` -> `Local Storage` -> `https://kimi.moonshot.cn`。
5. 找到 `refresh_token`，复制完整字符串。
6. 打开插件设置，或编辑 `plugin_config.json`，把它填到 `refresh_token.value`。

关键配置：

```json
{
  "provider": { "value": "free_api" },
  "base_url": { "value": "http://localhost:8000/v1" },
  "refresh_token": { "value": "你的 Kimi refresh_token" },
  "model": { "value": "kimi-search-silent" },
  "auto_start_backend": { "value": true },
  "backend_path": { "value": "" }
}
```

`backend_path.value` 留空时，插件会自动使用本插件目录里的：

```text
backend/kimi-free-api
```

如果你已经自己用 Docker、PM2 或别的方式启动了 Kimi-Free-API，可以把 `auto_start_backend.value` 设为 `false`，并把 `base_url.value` 改成你的服务地址。

## official 模式配置

如果不想使用逆向网页接口，可以使用 Moonshot 官方 API：

```json
{
  "provider": { "value": "official" },
  "official_api_key": { "value": "sk-你的官方 API Key" },
  "official_base_url": { "value": "https://api.moonshot.cn/v1" },
  "official_model": { "value": "kimi-k2.5" }
}
```

`official` 模式不需要启动 `backend/kimi-free-api`，也不需要 `refresh_token`。

## 工具说明

插件向主模型注册一个工具：

```text
kimi_web_search(query, deep_research?, silent?)
```

参数说明：

- `query`：完整自然语言问题，例如“今天上证指数收盘是多少？”
- `deep_research`：是否启用深度研究模式，适合“详细分析、全面对比、写报告”等需求。
- `silent`：是否隐藏搜索过程，默认隐藏，只返回最终答案。

普通实时问答建议保持 `deep_research=false`。深度研究会更慢，也更容易触发账号频率限制。

## 手动启动后端

正常情况下不需要手动启动，插件会自动拉起：

```powershell
cd my-neuro-main\live-2d\plugins\community\kimi-search\backend\kimi-free-api
node dist\index.js
```

如果你重新安装依赖或修改后端源码，可以运行：

```powershell
cd my-neuro-main\live-2d\plugins\community\kimi-search\backend\kimi-free-api
npm install
npm run build
npm start
```

默认监听地址：

```text
http://localhost:8000/v1
```

健康检查地址：

```text
http://localhost:8000/ping
```

## 常见问题

### 无法连接到 Kimi 后端

确认 `auto_start_backend.value` 是否为 `true`，以及 `backend/kimi-free-api/dist/index.js` 是否存在。也可以按“手动启动后端”里的命令先启动后端，再重启肥牛。

### Kimi 认证失败 401 / 403

通常是 `refresh_token` 过期、复制不完整或账号风控。重新登录 Kimi 网页版后再复制一次。

### 返回空内容或被限流

Kimi 网页版账号可能有频率限制。减少深度研究调用，或等待一段时间后再试。多账号轮询可以用英文逗号分隔多个 token，但请自行承担账号风险。

### 主模型不调用工具

确认主模型支持 Function Calling，并确认 `enabled_plugins.json` 已启用 `community/kimi-search`。

## 安全提醒

- `refresh_token` 等同于账号登录凭据，不要发给别人，不要提交到 GitHub。
- `official_api_key` 会产生费用，不要写进公开仓库。
- 不要把肥牛的人设提示词、私聊记录、Cookie、浏览器缓存、日志上传到公开仓库。
- 本仓库不包含你的本地 token；发布前也应再次搜索 `refresh_token`、`sk-`、`ghp_`、`cookie` 等关键词。
- 如果曾经把 token 发到聊天、日志或公开仓库，建议立刻在对应平台撤销并重新生成。

## 免责声明

本插件的 `free_api` 模式依赖 Kimi-Free-API，该项目通过非官方方式模拟/逆向 Kimi 网页端接口。此类用法可能受到服务条款、账号风控、地区政策或接口变更影响，随时可能失效、限流或导致账号异常。

本插件仅供个人学习、研究和本地测试使用，不建议用于商业服务、批量请求、绕过限制、侵犯第三方权益或任何违反平台规则的用途。使用者需要自行确认其使用行为的合法性、合规性和账号安全风险。因使用本插件或内置后端导致的账号封禁、数据损失、费用损失、服务不可用、法律争议等后果，由使用者自行承担。

## 上游致谢

- Kimi-Free-API：`https://github.com/LLM-Red-Team/kimi-free-api`
- Moonshot / Kimi：`https://kimi.moonshot.cn`
