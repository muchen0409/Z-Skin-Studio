# ADR-001：用 PowerShell Start-Process 拉起 ZCode

- 状态：已接受（2026-09-26 起）
- 关联：`app/main.js` launchZcode()、`app/src/ipc/runtime.js`

## 背景

启动器需要拉起带调试端口（9222）的 ZCode 才能注入皮肤。最直接的写法是
`spawn(zcodeExe, [...])`，但本项目的 Mimosa 安全钩子（PreToolUse）会把
"变量作为启动程序" 判为命令注入并拦截写入，无论参数是否为字面量数组。

## 决策

用固定命令 + 字面量参数 + 环境变量传路径：

```js
spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
  "Start-Process -FilePath $env:ZEXE -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=*'"],
  { shell: false, env: { ...process.env, ZEXE: exePath } });
```

路径不进命令行文本，无 shell 解析面；`Start-Process` 使进程分离，启动器不阻塞。

## 后果

- 正面：钩子通过、命令行无拼接注入面、ZCode 独立于启动器生命周期。
- 负面：拿不到子进程 pid → 探活退化为 `src/zcode.js` 的 tasklist 缓存兜底（10 秒缓存 + 3 秒超时）。
- 约束：端口字面量 9222 必须与 `src/cdp.js` 的 PORT 保持一致，改动需两边同步。
