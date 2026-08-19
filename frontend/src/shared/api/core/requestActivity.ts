type RequestActivityEvent = {
  type: 'begin' | 'end' | 'snapshot';
  requestId?: number;
  activeRequestIds: number[];
};

type RequestActivityListener = (activeCount: number, event: RequestActivityEvent) => void;

const listeners = new Set<RequestActivityListener>();
let activeRequestCount = 0;
let nextRequestId = 1;
const activeRequestIds = new Set<number>();

function requestActivityEvent(type: RequestActivityEvent['type'], requestId?: number): RequestActivityEvent {
  return {
    type,
    requestId,
    activeRequestIds: Array.from(activeRequestIds),
  };
}

function emitRequestActivity(event: RequestActivityEvent) {
  listeners.forEach((listener) => listener(activeRequestCount, event));
}

export function beginRequestActivity() {
  const requestId = nextRequestId;
  nextRequestId += 1;
  activeRequestCount += 1;
  activeRequestIds.add(requestId);
  emitRequestActivity(requestActivityEvent('begin', requestId));
  return requestId;
}

export function endRequestActivity(requestId?: number) {
  if (requestId !== undefined) {
    activeRequestIds.delete(requestId);
  }
  activeRequestCount = Math.max(0, activeRequestCount - 1);
  emitRequestActivity(requestActivityEvent('end', requestId));
}

export function getActiveRequestCount() {
  return activeRequestCount;
}

export function subscribeRequestActivity(listener: RequestActivityListener) {
  listeners.add(listener);
  listener(activeRequestCount, requestActivityEvent('snapshot'));
  return () => {
    listeners.delete(listener);
  };
}
