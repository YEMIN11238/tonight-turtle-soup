# 在线部署

应用包含 Node.js 后端、AI 裁判、豆包语音和多人房间。使用支持长连接的 Node 服务或容器主机，运行单个实例。静态网页托管不能提供完整玩法。

## Node 服务

使用 Node.js 24，安装命令为 `npm ci --omit=dev`，启动命令为 `npm start`。服务读取主机提供的 `PORT`，默认端口为 8787，无需前端构建。

在主机的环境变量或密钥管理中配置 `OPENAI_API_KEY`、`OPENAI_MODEL` 和 `VOLC_SPEECH_API_KEY`。豆包音色可通过 `VOLC_TTS_RESOURCE`、`VOLC_TTS_SPEAKER`、`VOLC_TTS_NAME` 调整。变量说明见 `.env.example`；不要把实际 `.env` 文件上传到仓库或构建产物。

可用 `ACCESS_CODE` 设置开局口令，用 `DAILY_LLM_LIMIT` 和 `DAILY_TTS_CHAR_LIMIT` 调整每日额度。未配置模型服务时会使用离线演示裁判。

## 跨部署续玩

在已有服务器上，把 `DATA_DIR` 指向**代码目录之外的固定数据目录**，例如 `/opt/tonight-soup/shared/data`，或 Docker 中持续复用的命名数据卷。服务器重启和替换应用代码时，始终保留并挂载同一目录。无需额外注册数据库服务。

确认该目录确实保留在现有服务器磁盘后，设置 `DATA_PERSISTENT=1`。`/api/meta` 的 `storage` 字段会报告 `{ kind: "file", durable: true, retentionDays: 30 }`。未显式确认时 `durable` 默认是 `false`；这个开关只报告部署事实，不能把临时目录变成持久磁盘。

单人存档默认在最后一次活动后保留 **30 天**，可用 `SESSION_TTL_DAYS` 调整。浏览器只保存不可猜测的续玩凭据，服务器保存真实问答、次数和线索；不要清除浏览器站点数据。结案分享链接不包含续玩凭据。服务必须保持一个实例；更新时先停止旧实例，再让新实例使用同一数据目录，避免两个文件写入进程互相覆盖。

只有原子写入成功后才确认一次操作；目录不可写时会明确报错，不会假装保存成功。已经被旧临时磁盘清理的对局无法找回，部署迁移不会伪造旧进度。

配置后的验收步骤：玩到第十个问题，记下剩余次数、提示和线索；刷新并关闭重开浏览器，确认可以续玩；再重启或重新部署应用，仍应恢复同一局。最后检查数据目录不可写时，操作不会被当作保存成功。

## Docker

仓库提供 Dockerfile，可部署到已有服务器。将密钥文件放在代码目录之外，例如 `/opt/tonight-soup/shared/.env`，权限设为仅部署用户可读。将数据放在持久目录或命名卷里，代码更新与数据保存互不覆盖。

在项目目录构建：

```sh
docker build -t tonight-soup .
docker volume create tonight-turtle-soup-data
docker run --name tonight-soup -p 8080:8080 --env-file .env \
  -e PORT=8080 -e DATA_DIR=/app/data -e DATA_PERSISTENT=1 \
  -v tonight-turtle-soup-data:/app/data tonight-soup
```

镜像使用 Node.js 24，并以非 root 的 `node` 用户运行。容器内部端口为 8080。托管平台可以直接提供环境变量，替代示例中的本机 `--env-file`。

更新时重新构建镜像并替换应用容器，继续使用 `tonight-turtle-soup-data` 卷。仓库的 `compose.yaml` 固定项目名和同一数据卷，替换代码目录不会另建一套应用。不要删除或重建这个卷，也不要在清理旧镜像时清理它。使用宿主机绑定目录时，目录必须允许容器 UID 1000 读写。

更新前暂停应用并备份固定数据目录，备份保存在服务器上代码目录之外，使用仅管理员可读的权限。备份包含会话凭据、问答与用量，不应上传公开仓库。恢复时先停应用，恢复到同一个数据目录，再启动并检查续玩。密钥文件单独妥善保存。

## 连接与数据

当前正式入口为 `https://47.114.42.94/`，应用目录为 `/opt/tonight-turtle-soup/app`，私有运行配置在上一级的 `runtime.env`。游戏使用固定命名卷 `tonight-turtle-soup-data`，回环端口8787；公网仅由Nginx提供80/443入口。Compose把游戏限制在0.75核、512MiB内存，并限制日志大小。

当前杭州主机不能直连OpenAI，因此通过原有Render服务的 `/internal/ai/responses` 转接。阿里云仅持有独立中继凭据和豆包语音Key；真实OpenAI Key保留在Render。中继默认关闭，必须配置独立的 `RELAY_SERVER_TOKEN`，只接受固定模型、结构化裁判请求、1400输出上限和最多4个并发。两端通过HTTPS传输，不能把凭据放进前端。Render空闲后可能冷启动，首次裁判响应会较慢。旧入口设置 `PUBLIC_GAME_URL` 后首页会转到新入口，并保留案件参数。

`deploy/aliyun/nginx.conf` 是当前IP证书和SSE代理配置，部署时复制到 `/opt/tonight-turtle-soup/nginx/default.conf`。Nginx容器名为 `tonight-soup-web`，使用host网络访问游戏回环端口，挂载该配置、`acme`目录及只读的整个`letsencrypt`目录。当前已核验镜像为 `nginx:1.28-alpine` 与 `certbot/certbot:v5.4.0`，不要假定镜像源的 `latest` 一定是新版。

IP证书有效期短，服务器的 `tonight-soup-cert-renew.timer` 每12小时检查续签。对应脚本和systemd单元在 `deploy/aliyun/`，必须安装并启用timer；续签保留HTTP挑战目录，完成后检查配置并重载Nginx。证书、账户私钥和私有运行配置均在代码目录之外，不进入仓库。新增主机时需先用Certbot的webroot模式、`--preferred-profile shortlived --ip-address <公网IP>`签发证书，再启用TLS配置。[IP证书官方说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)

- 公网入口启用 HTTPS，浏览器连麦需要安全上下文和麦克风权限。
- 反向代理允许 `/api/rooms/:code/events` 的 SSE 长连接，关闭响应缓冲，空闲超时大于 30 秒。服务每 15 秒发送保活消息。
- 保持单个应用进程和单个副本。房间广播、裁判调用和单人对局使用进程内状态，不能直接横向扩容。
- 将 `DATA_DIR` 指向持久卷。默认目录为项目的 `data/`；Docker 默认为 `/app/data`。目录须允许运行用户写入，绑定宿主目录时给予容器用户 UID 1000 相应权限。
- 单人对局、每日模型调用量、多人房间和语音用量保存在数据目录。单人操作写入成功才确认，默认最后活动后保留 30 天；损坏文件会阻止启动，避免静默覆盖旧记录。
- 多人房间记录可从该目录恢复，但 WebRTC 通话和 SSE 连接需要浏览器重新连接，不代表实时语音跨服务器重启不中断。
- 仓库保留 `render.yaml` 以兼容现有入口，但 Render 免费实例的临时文件系统不保证跨部署保留数据。正式续玩应以已确认的现有服务器固定数据目录为准，不能仅设置 `DATA_PERSISTENT=1` 就宣称已经持久化。
- 数据目录包含会话凭据与问答记录，不得公开或提交到 GitHub。
- 连麦目前使用 STUN 直连，受限网络可能需要后续接入 TURN；文字讨论和共享推理不依赖麦克风。

部署后访问 `/api/meta` 检查服务、模型模式和语音配置，再创建单人局、验证一次提问，并用两个浏览器加入同一房间检查实时同步。
