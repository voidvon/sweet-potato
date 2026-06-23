# 运行说明

这个目录是打包后的运行文件，可以用本地方式或 Docker 方式启动。

## 1. 本地运行

本地运行前需要安装：

- Node.js
- pnpm
- Python 3.10 或更高版本

```bash
sh run.sh
```

打开：

```text
http://localhost:${WEB_HOST_PORT:-5689}
```

停止：

```bash
Ctrl+C
```

## 2. Docker 运行

```bash
docker compose up --build -d
```

打开：

```text
http://localhost:${WEB_HOST_PORT:-5689}
```

停止：

```bash
docker compose down
```
