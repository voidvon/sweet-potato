'use strict';

const { wechatAutomationService } = require('../service/wechat-automation');

class WechatAutomationController {
  runProbe(args) {
    return wechatAutomationService.runProbe(args);
  }

  sendMessage(args) {
    return wechatAutomationService.sendMessage(args);
  }
}

WechatAutomationController.toString = () => '[class WechatAutomationController]';

module.exports = WechatAutomationController;
