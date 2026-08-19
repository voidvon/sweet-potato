import type { LlmBillingSettings, LlmModelPricing } from '../../../types';
import { toNumericValue } from './modelSettingsHelpers';

export type LlmPriceTableRow = {
  key: string;
  billing: Partial<LlmBillingSettings>;
  multiplier: number;
};

function currencySymbol(currency?: LlmBillingSettings['priceCurrency']) {
  return currency === 'CNY' ? '¥' : '$';
}

function formatOfficialPer1MTokens(value: unknown, currency?: LlmBillingSettings['priceCurrency']) {
  return `${currencySymbol(currency)}${toNumericValue(value, 0).toFixed(4)} / 1M Tokens`;
}

function formatCreditPer1MTokens(value: unknown) {
  return `${toNumericValue(value, 0).toFixed(4)} Credit / 1M Tokens`;
}

export function renderLlmPriceLines(
  billing: Partial<LlmBillingSettings>,
  options: { multiplier?: number; official?: boolean } = {},
) {
  const priceRows = [
    { label: '输入价格', value: billing.inputCreditsPer1M },
    { label: '补全价格', value: billing.outputCreditsPer1M },
    { label: '缓存价格', value: billing.cachedInputCreditsPer1M },
  ];
  const multiplier = options.multiplier ?? 1;

  return (
    <div className="llm-price-lines">
      {priceRows.map((item) => (
        <div className="llm-price-line" key={item.label}>
          <span>{item.label}</span>
          <strong>
            {options.official
              ? formatOfficialPer1MTokens(item.value, billing.priceCurrency)
              : formatCreditPer1MTokens(toNumericValue(item.value, 0) * multiplier)}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function renderCompactLlmOfficialPriceLines(pricing: LlmModelPricing) {
  const priceRows = [
    { label: '输入价格', value: pricing.inputPricePer1M },
    { label: '补全价格', value: pricing.outputPricePer1M },
    { label: '缓存价格', value: pricing.cachedInputPricePer1M },
  ];

  return (
    <div className="llm-price-lines">
      {priceRows.map((item) => (
        <div className="llm-price-line-compact" key={item.label}>
          <span>{item.label}</span>
          <strong>{formatOfficialPer1MTokens(item.value, pricing.currency)}</strong>
        </div>
      ))}
    </div>
  );
}
