export type UpstreamModelErrorCode =
  | 'provider_insufficient_balance'
  | 'provider_timeout'
  | 'provider_http_error';

export class UpstreamModelError extends Error {
  code: UpstreamModelErrorCode;
  status?: number;
  providerMessage?: string;

  constructor(input: {
    code: UpstreamModelErrorCode;
    message: string;
    providerMessage?: string;
    status?: number;
  }) {
    super(input.message);
    this.name = 'UpstreamModelError';
    this.code = input.code;
    this.status = input.status;
    this.providerMessage = input.providerMessage;
  }
}

export function isUpstreamModelError(error: unknown, code?: UpstreamModelErrorCode): error is UpstreamModelError {
  return error instanceof UpstreamModelError && (!code || error.code === code);
}

export function classifyUpstreamModelError(input: {
  message: string;
  status?: number;
}): UpstreamModelError | undefined {
  const message = input.message.trim();
  if (/insufficient\s+balance|insufficient_balance|余额不足|余额不够|积分不足|点数不足/i.test(message)) {
    return new UpstreamModelError({
      code: 'provider_insufficient_balance',
      message: '供应商账户余额不足',
      providerMessage: message,
      status: input.status,
    });
  }
  if (input.status === 524 || /524:\s*A timeout occurred/i.test(message)) {
    return new UpstreamModelError({
      code: 'provider_timeout',
      message: '图片模型上游服务超时（524），请稍后重试或检查图片模型 Base URL/服务商可用性',
      providerMessage: message,
      status: input.status,
    });
  }
  return undefined;
}

export function normalizeUpstreamModelError(input: {
  message: string;
  status?: number;
}) {
  return classifyUpstreamModelError(input)
    || new UpstreamModelError({
      code: 'provider_http_error',
      message: input.message,
      providerMessage: input.message,
      status: input.status,
    });
}
