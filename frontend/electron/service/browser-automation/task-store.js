'use strict';

const tasks = new Map();

function toPublicTask(task) {
  return {
    id: task.id,
    adapter: task.adapter,
    profileId: task.profileId,
    status: task.status,
    input: task.input,
    result: task.result,
    error: task.error,
    logs: task.logs,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function setTask(task) {
  tasks.set(task.id, task);
  return task;
}

function getTask(taskId) {
  return tasks.get(taskId);
}

function listTasks() {
  return Array.from(tasks.values()).map(toPublicTask);
}

module.exports = {
  setTask,
  getTask,
  listTasks,
  toPublicTask,
};
