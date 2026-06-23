'use strict';

function abortError(message = '任务已取消') {
  return new Error(message);
}

function throwIfAborted(signal, message = '任务已取消') {
  if (signal && signal.aborted) {
    throw abortError(message);
  }
}

function withAbort(signal, promise, message = '任务已取消') {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal, message);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError(message));
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

module.exports = {
  abortError,
  throwIfAborted,
  withAbort,
};
