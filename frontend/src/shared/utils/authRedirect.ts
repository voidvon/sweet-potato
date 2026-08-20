type LocationLike = Pick<Location, 'hash' | 'pathname' | 'search'>;

export function currentReturnTo(location: LocationLike) {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function normalizeWorkspaceReturnTo(value: string | null | undefined) {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return null;
  }
  try {
    const parsed = new URL(candidate, 'https://workspace.local');
    if (parsed.origin !== 'https://workspace.local') {
      return null;
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '/app' && !parsed.pathname.startsWith('/app/')) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function loginPathWithReturnTo(loginPath: string, returnTo: string | null | undefined) {
  const normalized = normalizeWorkspaceReturnTo(returnTo);
  if (!normalized) {
    return loginPath;
  }
  const query = new URLSearchParams({ returnTo: normalized });
  return `${loginPath}?${query.toString()}`;
}

export function returnToFromLoginSearch(search: string) {
  return normalizeWorkspaceReturnTo(new URLSearchParams(search).get('returnTo'));
}
