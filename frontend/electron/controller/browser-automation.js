'use strict';

const { browserAutomationService } = require('../service/browser-automation');

class BrowserAutomationController {
  listAdapters() {
    return browserAutomationService.listAdapters();
  }

  listTasks() {
    return browserAutomationService.listTasks();
  }

  startTask(args) {
    return browserAutomationService.startTask(args);
  }

  cancelTask(args) {
    return browserAutomationService.cancelTask(args);
  }

  resumeTask(args) {
    return browserAutomationService.resumeTask(args);
  }

  getTask(args) {
    return browserAutomationService.getTask(args);
  }

  closeWindows(args) {
    return browserAutomationService.closeWindows(args);
  }

  stopProfile(args) {
    return browserAutomationService.stopProfile(args);
  }
}

BrowserAutomationController.toString = () => '[class BrowserAutomationController]';

module.exports = BrowserAutomationController;
