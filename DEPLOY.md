# 在线部署

应用包含 Node.js 后端、AI 裁判、豆包语音和多人房间。使用支持长连接的 Node 服务或容器主机，运行单个实例。静态网页托管不能提供完整玩法。

## Node 服务

使用 Node.js 24，安装命令为 `npm ci --omit=dev`，启动命令为 `npm start`。服务读取主机提供的 `PORT`，默认端口为 8787，无需前端构建。

在主机的环境变量或密钥管理中配置 `OPENAI_API_KEY`、`OPENAI_MODEL` 和 `VOLC_SPEECH_API_KEY`。豆包音色可通过 `VOLC_TTS_RESOURCE`、`VOLC_TTS_SPEAKER`、`VOLC_TTS_NAME` 调整。变量说明见 `.env.example`；不要把实际 `.env` 文件上传到仓库或构建产物。

可用 `ACCESS_CODE` 设置开局口令，用 `DAILY_LLM_LIMIT` 和 `DAILY_TTS_CHAR_LIMIT` 调整每日额度。未配置模型服务时会使用离线演示裁判。

## Docker

在项目目录构建：

```sh
docker build -t tonight-soup .
docker volume create tonight-soup-data
docker run --name tonight-soup -p 8080:8080 --env-file .env \
  -e PORT=8080 -e DATA_DIR=/app/data \
  -v tonight-soup-data:/app/data tonight-soup
```

镜像使用 Node.js 24，并以非 root 的 `node` 用户运行。容器内部端口为 8080。托管平台可以直接提供环境变量，替代示例中的本机 `--env-file`。

## 连接与数据

- 公网入口启用 HTTPS，浏览器连麦需要安全上下文和麦克风权限。
- 反向代理允许 `/api/rooms/:code/events` 的 SSE 长连接，关闭响应缓冲，空闲超时大于 30 秒。服务每 15 秒发送保活消息。
- 保持单个应用进程和单个副本。房间广播、裁判调用和单人对局使用进程内状态，不能直接横向扩容。
- 将 `DATA_DIR` 指向持久卷。默认目录为项目的 `data/`；Docker 默认为 `/app/data`。目录须允许运行用户写入，绑定宿主目录时给予容器用户 UID 1000 相应权限。
- 多人房间和语音用量保存在数据目录；单人对局仍保存在内存，重启后需要重新开局。数据目录包含房间凭据，不得公开或提交到 GitHub。
- 连麦目前使用 STUN 直连，受限网络可能需要后续接入 TURN；文字讨论和共享推理不依赖麦克风。

部署后访问 `/api/meta` 检查服务、模型模式和语音配置，再创建单人局、验证一次提问，并用两个浏览器加入同一房间检查实时同步。
