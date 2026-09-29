/* 测试辅助：把 fake electron 注入 require.cache，让主进程模块在纯 Node 下可加载。
   必须在 require 任何 src/ 模块之前调用 install()；node --test 每个文件独立进程，
   因此各测试文件互不污染。fake 覆盖本项目用到的全部 electron 面：
   app.getPath/userVersion、nativeImage（返回空图 → 取色/缩略图走回退路径）、
   ipcMain.handle 收集器（可从 ctx.ipcHandlers 直接调 handler）、dialog。 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zskin-test-"));
}

function install() {
  const ctx = { userDataRoot: freshRoot(), ipcHandlers: {} };
  const fake = {
    app: {
      getPath: name => {
        if (name === "userData") return ctx.userDataRoot;
        throw new Error("fake electron: 未实现的 getPath(" + name + ")");
      },
      getVersion: () => "0.0.0-test",
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true }),
    },
    ipcMain: {
      handle: (name, fn) => { ctx.ipcHandlers[name] = fn; },
    },
    dialog: {
      showOpenDialog: async () => { throw new Error("fake dialog: 测试未模拟对话框"); },
    },
  };
  const id = require.resolve("electron");
  require.cache[id] = { id, filename: id, loaded: true, exports: fake };
  return ctx;
}

module.exports = { install, freshRoot };
