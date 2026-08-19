"use strict";

const path = require("path");
const { getBaseDir } = require("ee-core/ps");

/**
 * 默认配置
 */
module.exports = () => {
  return {
    openDevTools: false,
    singleLock: true,
    windowsOption: {
      title: "萌猫",
      width: 1280,
      height: 820,
      minWidth: 1080,
      minHeight: 720,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        devTools: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, '..', 'preload', 'bridge.js'),
      },
      frame: true,
      show: true,
      icon: path.join(getBaseDir(), "public", "images", "logo-32.png"),
    },
    logger: {
      level: "INFO",
      outputJSON: false,
      appLogName: "ee.log",
      coreLogName: "ee-core.log",
      errorLogName: "ee-error.log",
    },
    remote: {
      enable: false,
      url: "http://electron-egg.kaka996.com/",
    },
    socketServer: {
      enable: false,
      port: 7070,
      path: "/socket.io/",
      connectTimeout: 45000,
      pingTimeout: 30000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e8,
      transports: ["polling", "websocket"],
      cors: {
        origin: true,
      },
      channel: "socket-channel",
    },
    httpServer: {
      enable: false,
      https: {
        enable: false,
        key: "/public/ssl/localhost+1.key",
        cert: "/public/ssl/localhost+1.pem",
      },
      host: "127.0.0.1",
      port: 7071,
    },
    mainServer: {
      indexPath: "/public/dist/index.html",
      channelSeparator: "/",
    },
  };
};
