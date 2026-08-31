# Remotion Video Plugin

这是 `agent-tool` 内置的视频渲染插件源码。Go 主程序负责安装检测、进程启停、权限、任务持久化和素材管理；本插件只校验 JsonVideo、执行 Remotion 渲染并返回 MP4。

## 开发

```bash
bun install --frozen-lockfile
bun run browser:ensure
bun run test
bun run lint
```

修改动效时同步更新：

- `src/JsonVideo/animations.ts`
- `src/JsonVideo/schema.ts`
- `src/JsonVideo/schema.test.ts`

后台的“启用”只控制已安装插件的运行状态，不会安装依赖。开发依赖通过根目录 `make prepare-plugins` 准备，发布包通过 `make build-with-plugins` 生成。
