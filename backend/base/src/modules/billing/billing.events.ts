import { publishAppEvent } from '../app-events/app.events.js';

export type CreditBalanceUpdatedEvent = {
  type: 'credit-balance-updated';
  userId: string;
  creditBalance: number;
  creditDelta: number;
  at: string;
};

export function publishCreditBalanceUpdated(event: Omit<CreditBalanceUpdatedEvent, 'type' | 'at'>) {
  publishAppEvent({
    ...event,
    type: 'credit-balance-updated',
    at: new Date().toISOString(),
  });
}
