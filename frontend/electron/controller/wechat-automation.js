'use strict';

const { wechatAutomationService } = require('../service/wechat-automation');

class WechatAutomationController {
  runProbe(args) {
    return wechatAutomationService.runProbe(args);
  }

  identifyCurrentPanel(args) {
    return wechatAutomationService.identifyCurrentPanel(args);
  }

  switchPanel(args) {
    return wechatAutomationService.switchPanel(args);
  }

  openAddFriend(args) {
    return wechatAutomationService.openAddFriend(args);
  }

  probeAddFriendMenu(args) {
    return wechatAutomationService.probeAddFriendMenu(args);
  }

  probeQuickAction(args) {
    return wechatAutomationService.probeQuickAction(args);
  }

  clickAddFriendEntry(args) {
    return wechatAutomationService.clickAddFriendEntry(args);
  }

  focusAddFriendSearch(args) {
    return wechatAutomationService.focusAddFriendSearch(args);
  }

  searchAddFriendAccount(args) {
    return wechatAutomationService.searchAddFriendAccount(args);
  }

  handleAddFriendResult(args) {
    return wechatAutomationService.handleAddFriendResult(args);
  }

  closeAddFriendWindows(args) {
    return wechatAutomationService.closeAddFriendWindows(args);
  }

  sendMessage(args) {
    return wechatAutomationService.sendMessage(args);
  }
}

WechatAutomationController.toString = () => '[class WechatAutomationController]';

module.exports = WechatAutomationController;
