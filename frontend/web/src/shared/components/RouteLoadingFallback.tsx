import { ContentStudioLayout } from '../layouts/ContentStudioLayout';

function FullBleedRouteFallback({ background }: { background: string }) {
  return (
    <div
      aria-hidden="true"
      style={{ background, flex: '1 1 auto', height: '100%', minHeight: 0, width: '100%' }}
    />
  );
}

export function ContentStudioRouteFallback() {
  return (
    <ContentStudioLayout>
      <div
        aria-hidden="true"
        style={{ background: '#ffffff', flex: '1 1 auto', height: '100%', minHeight: 0, width: '100%' }}
      />
    </ContentStudioLayout>
  );
}

export function WorkspaceRouteFallback() {
  return (
    <div
      aria-hidden="true"
      style={{ background: '#ffffff', borderRadius: 12, flex: '1 1 auto', height: '100%', minHeight: 0, width: '100%' }}
    />
  );
}

export function ChatRouteFallback() {
  return <FullBleedRouteFallback background="#ffffff" />;
}

export function ImmersiveRouteFallback() {
  return <FullBleedRouteFallback background="#ffffff" />;
}
