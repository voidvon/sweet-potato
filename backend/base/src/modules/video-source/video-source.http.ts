import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { VideoSourceError } from './video-source.types.js';

export const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1';

type SafeFetchOptions = {
  allowedHostSuffixes?: readonly string[];
  maxRedirects?: number;
  timeoutMs?: number;
};

export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
) {
  const maxRedirects = options.maxRedirects ?? 6;
  let currentUrl = new URL(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertSafeRemoteUrl(currentUrl, options.allowedHostSuffixes);
    const signal = AbortSignal.timeout(options.timeoutMs ?? 15000);
    const response = await fetch(currentUrl, {
      ...init,
      headers: {
        'user-agent': MOBILE_USER_AGENT,
        accept: '*/*',
        ...init.headers,
      },
      redirect: 'manual',
      signal,
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) {
      throw new VideoSourceError('视频平台返回了无效重定向', 502);
    }
    if (redirectCount === maxRedirects) {
      throw new VideoSourceError('视频链接重定向次数过多', 400);
    }
    currentUrl = new URL(location, currentUrl);
  }

  throw new VideoSourceError('视频链接解析失败', 502);
}

async function assertSafeRemoteUrl(url: URL, allowedHostSuffixes?: readonly string[]) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new VideoSourceError('仅支持 HTTP 或 HTTPS 视频链接');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (allowedHostSuffixes?.length && !allowedHostSuffixes.some((suffix) => (
    hostname === suffix || hostname.endsWith(`.${suffix}`)
  ))) {
    throw new VideoSourceError('视频链接跳转到了不受支持的域名');
  }
  if (isPrivateAddress(hostname)) {
    throw new VideoSourceError('不允许访问本地或内网地址');
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) {
    throw new VideoSourceError('视频链接域名无法解析', 502);
  }
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new VideoSourceError('不允许访问解析到内网的视频地址');
  }
}

function isPrivateAddress(value: string) {
  const address = value.toLowerCase();
  if (address === 'localhost' || address === '::1' || address === '0.0.0.0') return true;
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19))
      || octets[0] === 0
      || octets[0] >= 224;
  }
  if (isIP(address) === 6) {
    const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    if (mappedIpv4) return isPrivateAddress(mappedIpv4);
    return address.startsWith('fc')
      || address.startsWith('fd')
      || address.startsWith('fe8')
      || address.startsWith('fe9')
      || address.startsWith('fea')
      || address.startsWith('feb')
      || address === '::'
      || address.startsWith('2001:db8:');
  }
  return false;
}
