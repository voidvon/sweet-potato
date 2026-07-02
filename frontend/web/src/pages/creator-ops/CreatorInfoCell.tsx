import { Tag } from 'antd';
import type { CreatorOpsPlatform } from './creatorOpsPlatforms';
import type { CreatorSearchResult } from './CreatorResultsTable';
import './CreatorInfoCell.scss';

type CreatorInfoCellVariant = CreatorOpsPlatform | 'douyin';

type CreatorInfoCellProps = {
  onOpenProfile?: (record: CreatorSearchResult) => void;
  record: CreatorSearchResult;
  variant: CreatorInfoCellVariant;
};

function renderCreatorName(record: CreatorSearchResult, onOpenProfile?: (record: CreatorSearchResult) => void) {
  if (record.href && onOpenProfile) {
    return (
      <span
        className="douyin-cell-link-text"
        onClick={() => {
          onOpenProfile(record);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenProfile(record);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {record.name || '-'}
      </span>
    );
  }

  if (record.href) {
    return <a href={record.href} rel="noreferrer" target="_blank">{record.name || '-'}</a>;
  }

  return <span>{record.name || '-'}</span>;
}

function renderAvatar(record: CreatorSearchResult, onOpenProfile?: (record: CreatorSearchResult) => void) {
  const avatarContent = record.avatarUrl ? (
    <img
      alt={record.name}
      referrerPolicy="no-referrer"
      src={record.avatarUrl}
    />
  ) : (
    <span>{record.name.slice(0, 1) || '-'}</span>
  );

  if (record.href && onOpenProfile) {
    return (
      <button
        className="douyin-cell-avatar-button"
        onClick={() => {
          onOpenProfile(record);
        }}
        type="button"
      >
        {avatarContent}
      </button>
    );
  }

  return avatarContent;
}

function renderGeneralCreatorInfo(record: CreatorSearchResult, onOpenProfile?: (record: CreatorSearchResult) => void) {
  return (
    <div className="xingtu-cell-creator">
      <div className="xingtu-cell-avatar">
        {renderAvatar(record, onOpenProfile)}
      </div>
      <div className="xingtu-cell-creator-main">
        <div className="xingtu-cell-creator-title">
          {renderCreatorName(record, onOpenProfile)}
        </div>
        <div className="xingtu-cell-creator-badges">
          {record.creatorBadgeIconUrl ? (
            <span className="xingtu-cell-creator-icon-tag">
              <img
                alt=""
                className="xingtu-cell-creator-icon"
                referrerPolicy="no-referrer"
                src={record.creatorBadgeIconUrl}
              />
            </span>
          ) : null}
          {record.gender ? <Tag bordered={false}>{record.gender}</Tag> : null}
          {record.location ? <Tag bordered={false}>{record.location}</Tag> : null}
          {record.badges?.slice(0, 3).map((badge) => (
            <Tag bordered={false} key={badge}>{badge}</Tag>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderDouyinCreatorInfo(record: CreatorSearchResult, onOpenProfile?: (record: CreatorSearchResult) => void) {
  return (
    <div className="douyin-cell-creator">
      <div className="douyin-cell-avatar">
        {renderAvatar(record, onOpenProfile)}
      </div>
      <div className="douyin-cell-creator-main">
        <div className="douyin-cell-creator-title">
          {renderCreatorName(record, onOpenProfile)}
        </div>
        <div className="douyin-cell-creator-meta">
          {record.profileName ? <Tag bordered={false}>{record.profileName}</Tag> : null}
        </div>
      </div>
    </div>
  );
}

export function CreatorInfoCell({
  onOpenProfile,
  record,
  variant,
}: CreatorInfoCellProps) {
  if (variant === 'douyin') {
    return renderDouyinCreatorInfo(record, onOpenProfile);
  }

  return renderGeneralCreatorInfo(record, onOpenProfile);
}
