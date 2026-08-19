import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { subscribeRequestActivity } from '../api/core/requestActivity';

const INITIAL_REQUEST_ARMING_MS = 900;
const MIN_VISIBLE_MS = 260;

export function AppRequestLoading() {
  const [activeCount, setActiveCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const armedRef = useRef(true);
  const sawInitialRequestRef = useRef(false);
  const initialRequestIdsRef = useRef(new Set<number>());
  const visibleSinceRef = useRef(0);
  const armingTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    armedRef.current = true;
    sawInitialRequestRef.current = false;
    initialRequestIdsRef.current = new Set();
    visibleSinceRef.current = 0;

    armingTimerRef.current = window.setTimeout(() => {
      armedRef.current = false;
      armingTimerRef.current = null;
    }, INITIAL_REQUEST_ARMING_MS);

    const finishInitialLoading = () => {
      const elapsed = visibleSinceRef.current ? Date.now() - visibleSinceRef.current : MIN_VISIBLE_MS;
      const delay = Math.max(0, MIN_VISIBLE_MS - elapsed);
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false);
        setActiveCount(0);
        armedRef.current = false;
        hideTimerRef.current = null;
      }, delay);
    };

    const unsubscribe = subscribeRequestActivity((count, event) => {
      if (armedRef.current) {
        if (event.requestId !== undefined && event.type !== 'end') {
          initialRequestIdsRef.current.add(event.requestId);
        }
        if (event.type === 'snapshot') {
          event.activeRequestIds.forEach((requestId) => {
            initialRequestIdsRef.current.add(requestId);
          });
        }
      }

      const initialActiveCount = event.activeRequestIds.filter((requestId) => (
        initialRequestIdsRef.current.has(requestId)
      )).length;

      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (initialActiveCount > 0) {
        sawInitialRequestRef.current = true;
        setActiveCount(initialActiveCount);
        setVisible(true);
        if (!visibleSinceRef.current) {
          visibleSinceRef.current = Date.now();
        }
        return;
      }
      if (sawInitialRequestRef.current) {
        finishInitialLoading();
      }
    });

    return () => {
      unsubscribe();
      if (armingTimerRef.current !== null) {
        window.clearTimeout(armingTimerRef.current);
      }
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      visibleSinceRef.current = 0;
    }
  }, [visible]);

  return (
    <div
      aria-hidden={!visible}
      className={`page-request-loading${visible ? ' active' : ''}${activeCount > 0 ? ' running' : ''}`}
      role="status"
    >
      <div className="page-request-loading-card">
        <LoaderCircle size={14} />
        <span>页面加载中</span>
      </div>
    </div>
  );
}
