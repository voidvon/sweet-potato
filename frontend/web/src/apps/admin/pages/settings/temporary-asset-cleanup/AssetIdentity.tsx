import { Typography } from 'antd';
import { resolveAssetUrl } from '@shared/api/core/request';

type AssetIdentityProps = {
  id: string;
  name: string;
  previewUrl?: string;
};

export function AssetIdentity({ id, name, previewUrl }: AssetIdentityProps) {
  return (
    <div className="cleanup-asset-identity">
      {previewUrl ? (
        <Typography.Link
          ellipsis
          href={resolveAssetUrl(previewUrl)}
          rel="noreferrer"
          strong
          target="_blank"
          title={name}
        >
          {name || '-'}
        </Typography.Link>
      ) : (
        <Typography.Text ellipsis={{ tooltip: name }} strong>{name || '-'}</Typography.Text>
      )}
      <Typography.Text copyable={{ text: id }} type="secondary">{id.slice(0, 12)}</Typography.Text>
    </div>
  );
}
