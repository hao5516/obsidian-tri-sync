# Tri Sync 三端同步 — 0.1.1

Sync notes through WebDAV, S3-compatible storage, or Baidu Netdisk, with conflict copies and local backups. The interface currently uses Chinese. This community plugin is not affiliated with Obsidian Sync.

**Submission status:** prepared for community review, not yet listed or approved. Real cloud-account integration and mobile-device testing remain outstanding. See [submission notes](docs/COMMUNITY-SUBMISSION.md).

### Disclosures / 网络与隐私说明

- The plugin is free. A WebDAV/S3 server or a Baidu Netdisk account with the required API permissions is necessary. Storage providers may charge for storage, requests or bandwidth.
- Network requests go only to the storage endpoint you configure or Baidu's API/upload/download servers, to list, upload and download vault contents. No developer-operated relay server is used.
- File contents and relative paths leave your device during sync. HTTPS is required; end-to-end encryption is not implemented. The selected provider can read the uploaded data and may keep its own access logs under its policies.
- Credentials are saved in the plugin's local `data.json` without encryption. Do not share this file. Baidu authorization must be obtained outside the plugin and renewed manually.
- No advertising, analytics, client-side telemetry, remote executable code or self-updater is included. The plugin does not access files outside the active vault. It uses Obsidian's plugin settings storage for settings and baselines.
- Automatic sync is disabled by default. Once enabled it runs while Obsidian is active; mobile background execution is not guaranteed.
- Deletions and renames are not propagated. New attachments sync; updates to existing binary attachments require manual replacement from `_TriSync/incoming`. Remote history is retained without automatic garbage collection.

License: [MIT](LICENSE), copyright 2026 hao5516. Bundled dependencies: `@noble/hashes` (Paul Miller, MIT) and `aws4fetch` (Michael Hart, MIT). Their full notices are embedded in every released `main.js` and included in the ZIP. See [third-party notices](THIRD-PARTY-NOTICES.txt).

面向 Windows、macOS、Android 和 iOS 的 Obsidian 社区插件。三台设备使用同一服务、同一同步目录，即可交换笔记和新附件。运行时代码使用 Obsidian Vault / requestUrl 和浏览器 API，不依赖 Node.js、Electron 或桌面文件路径。

**当前是可构建、可安装的测试版。自动化测试通过不代表已通过四个平台真机测试；所有云服务仍需真实账号联调。请先用测试笔记库验证。**

## 已实现的服务

| 服务 | 接入方式 | 当前边界 |
| --- | --- | --- |
| WebDAV | HTTPS 地址、用户名、应用密码 | 适用于标准 WebDAV 服务，如坚果云、Nextcloud、NAS；需要 MKCOL / PROPFIND / GET / PUT 权限，未逐家认证 |
| S3 兼容存储 | 桶地址、Region、Access key、Secret key | 使用 AWS SigV4 和 ListObjectsV2；可配置 AWS S3、R2、MinIO 等兼容接口，未逐家验证；不支持临时 session token |
| 百度网盘（实验性） | 开放平台 access_token、应用目录 | 实现文件列表、预上传、4 MB 分片、创建文件、获取下载链接；需要自己的开放平台授权和下载权限，尚未实账号联调 |

“支持常见方案”不意味着任何网盘都能直接登录。OneDrive、Google Drive、Dropbox、阿里云盘、夸克、Git 尚无原生适配器；iCloud 也不是本插件的远端接口。若服务提供兼容的 WebDAV / S3 网关，可通过相应适配器接入，具体兼容性需验证。每个笔记库一次只使用一个后端，不会在不同云盘之间自动镜像。

## 安装

1. 从 [Releases](https://github.com/hao5516/obsidian-tri-sync/releases) 下载 `tri-sync-0.1.1.zip` 并解压，得到 `tri-sync` 文件夹，内含 `main.js`、`manifest.json` 和许可证声明。
2. 在每台设备的笔记库中，将这个文件夹放到 `.obsidian/plugins/tri-sync/`。不要多嵌套一层目录。
3. 重启 Obsidian，进入「设置 → 第三方插件」，允许并启用 **Tri Sync**。
4. 打开插件设置，三端配置相同的服务和远端目录。使用不同笔记库时必须使用不同远端目录。
5. 在内容最完整的设备上点击「测试连接」，再点「立即同步」。完成后在其他设备分别执行同步。
6. 验证后可开启自动同步，默认间隔 300 秒，最短 60 秒。

插件未上架社区市场。手机需要借助系统文件管理或电脑传输来放置插件文件，具体取决于设备对隐藏目录的访问能力；iOS 手动安装可能需要电脑协助。仅分发上面两个文件；不要把桌面端的 `data.json` 复制给其他设备，因为其中包含凭据和本机同步基线。

## WebDAV 配置示例

- HTTPS 地址：服务商提供的 WebDAV 根地址，例如 `https://dav.example.com/dav`。
- 远端子目录：`tri-sync/personal`，插件会逐层创建这个子目录，根地址本身应当已经存在。
- 用户名：WebDAV 账号。
- 应用密码：服务商生成的应用专用密码。

地址不接受 HTTP、内嵌用户名密码、查询参数或片段。测试连接会创建同步目录并列举对象，只验证目录访问，不验证文件写入权限。第一次手动同步才验证完整读写。

## S3 配置示例

- 桶地址：`https://my-bucket.s3.ap-southeast-1.amazonaws.com`，或服务支持的 `https://storage.example.com/my-bucket`。
- Region：服务商规定的区域。
- 远端子目录：`tri-sync/personal`。
- 密钥：需要目标目录的列举、读取、写入权限。桶需提前创建。

R2 等服务的区域和桶地址请按其文档填写。插件不会创建桶，也不会删除远端对象。

## 百度网盘配置

1. 在 [百度网盘开放平台](https://pan.baidu.com/union) 创建并配置应用，按平台要求取得所需能力及授权。是否可用取决于你的应用权限与账号，插件不绕过平台限制。
2. 按官方授权流程获取包含所需网盘读写能力的 `access_token`；仅将令牌填入插件，**不要填写百度账号密码、Cookie 或应用 Secret key**。
3. 在被授权的应用目录中预先创建同步文件夹，例如 `/apps/你的应用名/tri-sync`，三端均填写完全相同的路径。
4. 测试连接并使用少量文件试同步。下载还需要开放平台下载能力；能列目录并不代表能下载。

当前未提供一键 OAuth 登录、令牌自动刷新或长期断点续传。令牌过期后需重新授权并更新。分片上传与下载协议已有模拟测试，但真实权限、限流和移动端 User-Agent 行为仍待联调。

## 同步和冲突规则

- 同步普通可见文件；忽略隐藏文件、Obsidian 配置目录和 `_TriSync/`。空文件夹不单独同步。
- 对文件内容做 SHA-256 校验，不依据设备时间判断新旧。
- 每次修改先上传内容，再发布不可变版本记录；多端写入不同版本不会覆盖同一个索引。
- 各端对相同版本集合选取同一个主版本。并发编辑产生的其他内容保存在 `_TriSync/conflicts/版本ID/原路径`，**不会自动合并 Markdown 段落**。
- 替换本地文本前保留 `_TriSync/backups/内容哈希/原路径`，通过 `Vault.process()` 检测期间发生的文本修改。若用户继续编辑，跳过覆盖，下一轮重试。
- 支持 UTF-8 Markdown、TXT、Canvas、JSON 等文本自动更新。二进制附件可以首次上传和下载；已有附件的更新保存到 `_TriSync/incoming/内容哈希/原路径`，需要手动确认替换，以避免覆盖其他编辑器正在写入的文件。
- 首次下载附件时若本地已有同名不同内容，也可能产生冲突副本；请保留并检查副本。
- **不传播删除或重命名**。本地删除过的已同步文件不会在本机被恢复，其他设备仍保留。重命名表现为上传新路径，远端旧路径继续保留。
- 文件默认上限 20 MB，可设为 1–100 MB；过大文件跳过。文件全部读入内存，没有流式下载。
- 大小写或 Unicode 规范化后同名的文件会让同步停止；Windows 不允许的路径会被跳过或拒绝。
- 自动同步采用轮询，只在 Obsidian 运行时执行，不能承诺手机锁屏、后台挂起后的同步。

处理冲突时，在原路径编辑并保存最终内容，然后手动同步；新修改会关联该设备已经看到的冲突版本。确认各端内容正确后，可手动清理本机的冲突副本。

## 数据与安全边界

远端保存 `b-<SHA256>` 内容对象和 `r-<ID>.json` 版本记录，**不是可直接浏览编辑的 Markdown 镜像目录**。本插件不覆盖或删除历史，远端占用会增长；暂未实现历史压缩、垃圾回收和版本恢复界面。请不要手动删除远端记录，否则同步可能因历史不完整而停止。

设置和本机同步基线保存在 `.obsidian/plugins/tri-sync/data.json`，凭据为明文。本插件通过 HTTPS 传输，但没有端到端加密，存储服务可读取内容和路径。不应把此文件提交到公开仓库或分享给别人。

第一版每轮扫描本地文件，并重新读取所有远端版本元数据，适合小规模试用。大笔记库或长期积累的版本可能产生明显延迟、请求费用或服务限流；未实现自动退避重试，失败后停止本轮并在下次重试。不要为同一个库同时配置多个同步工具。

## 开发与验证

```sh
npm ci
npm run lint
npm run build
npm test
```

产物位于 `dist/tri-sync/`。`src/core.ts` 是不依赖 Obsidian 的同步核心，`src/stores.ts` 提供远端适配器，`src/main.ts` 是插件入口与设置页。添加其他服务时实现 `Store` 的 `init / list / get / put` 即可；服务必须保留不可变对象且能够完整列举同步目录。

自动化测试覆盖三端收敛、并发编辑、冲突处理、上传中断重试、损坏内容、编辑竞争、本地删除、路径安全、大小限制，以及百度协议的模拟上传下载。未完成 WebDAV / S3 / 百度实账号集成测试和 Android / iOS 真机测试。

## 接口参考

- [Obsidian 移动端开发](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [百度网盘上传接口](https://pan.baidu.com/union/doc/3ksg0s9ye)
- [百度网盘下载接口](https://pan.baidu.com/union/doc/pkuo3snyp)
- [S3 ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)
- [S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
