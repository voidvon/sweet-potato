import { BlockList, isIP } from 'node:net';
import { normalizeClientIp } from '../../shared/client-ip.js';

export type CompiledIpRules = {
  rules: string[];
  matches(ip: string): boolean;
};

function parseRule(value: string) {
  const rule = value.trim();
  if (!rule) {
    throw new Error('IP 黑名单中存在空规则');
  }

  const parts = rule.split('/');
  if (parts.length > 2) {
    throw new Error(`无效的 IP 或 CIDR：${rule}`);
  }

  const address = normalizeClientIp(parts[0]);
  const family = isIP(address);
  if (!family) {
    throw new Error(`无效的 IP 地址：${rule}`);
  }

  if (parts.length === 1) {
    return { rule: address, address, family, prefix: null };
  }

  const prefix = Number(parts[1]);
  const maxPrefix = family === 4 ? 32 : 128;
  if (!/^\d+$/.test(parts[1]) || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new Error(`无效的 CIDR 前缀：${rule}`);
  }

  return { rule: `${address}/${prefix}`, address, family, prefix };
}

export function normalizeIpRules(values: unknown) {
  if (!Array.isArray(values)) {
    throw new Error('IP 黑名单格式不正确');
  }
  if (values.length > 1000) {
    throw new Error('IP 黑名单最多支持 1000 条规则');
  }

  const rules = values.map((value) => parseRule(String(value)).rule);
  return Array.from(new Set(rules));
}

export function compileIpRules(values: string[]): CompiledIpRules {
  const parsedRules = values.map(parseRule);
  const blockList = new BlockList();

  for (const item of parsedRules) {
    const type = item.family === 4 ? 'ipv4' : 'ipv6';
    if (item.prefix === null) {
      blockList.addAddress(item.address, type);
    } else {
      blockList.addSubnet(item.address, item.prefix, type);
    }
  }

  return {
    rules: parsedRules.map((item) => item.rule),
    matches(value: string) {
      const ip = normalizeClientIp(value);
      const family = isIP(ip);
      if (!family) return false;
      return blockList.check(ip, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}
