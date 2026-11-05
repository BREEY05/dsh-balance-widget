# @breey05/dsh-balance-widget

在 DeepSeek Harness 输入框下显示当前模型供应商的余额。切换模型供应商时，余额入口立即切换并重新读取对应接口。

## 支持的供应商

| 模型供应商 ID | 余额来源 | 凭据 |
|---|---|---|
| `aigocode` | `https://api.aigocode.dev/v1/usage` 的 `balance`，USD | 本地 `AIGOCODE_API_KEY` |
| `taffy` | `https://taffy.work/v1/usage` 的 remaining / quota.remaining / balance，USD | 本地 `TAFFY_API_KEY` |
| `tafy` | 同上（旧 ID，保留兼容） | 本地 `TAFFY_API_KEY` |
| `ds` | 同上，但使用该路由自己的密钥 | 本地 `DS_API_KEY` |
| `deepseek-official` | `https://api.deepseek.com/user/balance` 的 `balance_infos[].total_balance`，CNY | 本地 `DEEPSEEK_API_KEY` |
| `deepseek-account` | DSH 账号 Remote 的充值与赠金钱包 | 设置中的 DeepSeek 登录 |

上表是内置的常见供应商 ID。多个 ID 可能指向同一钱包但配置不同密钥（例如 `taffy`、`tafy`、`ds` 都走 `taffy.work`），插件按 ID 各自读取，因此改 ID 后余额不会静默变空。不同模型如果属于同一供应商，使用同一钱包。

**不在表中的供应商会自动发现。** 插件从 `~/.dsh/profiles/*/cordis.patch.yml`（及 `cordis.yml`）读取该 ID 的 `baseURL`、`apiKeyEnv`，再用这把 Key 依次探测公开的余额接口：`/user/balance`、`/v1/usage`、`/v1/credits`、`/v1/dashboard/billing/subscription`、`/api/user/self`、`/v1/balance`、`/api/usage`、`/usage`。命中后就地解析余额（支持 `balance`、`remaining`、`total_balance`、`credits`、One-API 的 `quota/500000` 等常见字段与 `CNY`/`USD`）。同一个域名只探测一次并缓存结果，轮询时不再重复试探。

注意两点：需要余额接口使用同一把 API Key 做 Bearer 认证（大多数中转/官方实现如此）；若该供应商只提供网页登录态才能看的额度，或未声明 `baseURL`/`apiKeyEnv`，后端会返回“没有可用余额接口 / 缺少凭据”，此时在 `index.js` 的 `SOURCES` 中显式加一行 `usageUrl` 即可。`client.js` 的 `PROVIDERS` 只影响显示名称，未列出的 ID 直接用 ID 本身作标签。

## 安装与更新

在 DSH 的插件安装框输入：

```
@breey05/dsh-balance-widget@1.4.0
```

也可使用 GitHub 仓库地址 `git+https://github.com/BREEY05/dsh-balance-widget.git`，或安装本地目录。需要 DSH `>=0.2.1-rc.2 <0.3.0`。安装后刷新当前页面。

在本机 DSH 凭据管理中配置 API Key，切勿将密钥粘贴到聊天或提交到仓库。无需为账号路由配置 API Key。

## 行为与限制

- 使用会话的 `modelSelection` projection 订阅模型选择；空白会话使用 Host 模型目录提供的默认供应商。
- 每个供应商、每个会话分别保存消费记录，切换后不会把不同钱包的差额记作消费。切换期间迟到的请求不会污染新供应商数据。
- 点余额入口查看余额、观察到的会话消耗、今日消耗和刷新按钮。
- 余额来自供应商结算快照，并非逐 token 实时计费。消耗按观察到的余额下降估算；同账号其他设备的使用也可能计入，切换后首次读取仅建立基线。
- 每五分钟轮询，聊天节点变化后延迟读取，普通读取最少间隔 45 秒；失败后退避 2–15 分钟。切换供应商立即启动新读取，手动刷新可主动读取。
- 消耗计数保存在浏览器 localStorage/sessionStorage，不包含密钥。卸载后可通过清除站点数据移除。多个标签页同时观察同一钱包可能重复计数，跨标签页同时写入也可能竞争；这些记录仅作估算，账单以供应商为准。
- Host 通过受保护路由请求供应商接口；API Key 留在 Host，浏览器只拿到余额数字。自动发现时会用同一把 Key 依次探测该供应商 `baseURL` 下的若干常见余额路径，这会出现在供应商的访问日志里。无遥测，无外部脚本，无运行时依赖。
- 本插件在 DSH Host 进程内运行；只安装你信任的插件。

原账号版截图（当前版本额外显示供应商名称）：

![Composer balance](docs/dock.png)
![Balance details](docs/popover.png)

## 开发与发布

`npm test` 检查路由选择、账户钱包合计、未知/重命名供应商、自动发现与缓存、profile YAML 解析、消费隔离和迟到请求。测试使用模拟响应，不代表真实供应商连通性。

`client.js` 注册 `conversation.composer.dock`；`index.js` 按 `SOURCES` 为每个供应商注册一条受保护路由（`/api/aigocode-usage`、`/api/taffy-usage`、`/api/tafy-usage`、`/api/ds-usage`、`/api/deepseek-usage`），并额外注册一条通用路由 `/api/provider-balance?provider=<id>` 负责自动发现。保留原始图标及中英文本地化。

社区市场收录通过向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 提交目录 PR；npm 发布本身不会自动完成首次收录。后续版本由市场定期探测。

MIT License. 仓库：https://github.com/BREEY05/dsh-balance-widget
