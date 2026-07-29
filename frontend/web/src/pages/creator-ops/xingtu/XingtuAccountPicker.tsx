import { Button, Empty, Popover, Tooltip } from 'antd';
import { ArrowRightOutlined, CaretDownOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons';
import type { XingtuAccount } from './pageTypes';

type XingtuAccountPickerProps = {
  accountPickerOpen: boolean;
  accounts: XingtuAccount[];
  displayedAccount: XingtuAccount | null;
  displayedAccountAvatar: string;
  isElectronEgg: boolean;
  isLoginRunning: boolean;
  isStartingLogin: boolean;
  openingProfileIds: string[];
  onAddAccount: () => void;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (account: XingtuAccount) => void;
  onSelectAccount: (account: XingtuAccount) => void;
};

export function XingtuAccountPicker({
  accountPickerOpen,
  accounts,
  displayedAccount,
  displayedAccountAvatar,
  isElectronEgg,
  isLoginRunning,
  isStartingLogin,
  openingProfileIds,
  onAddAccount,
  onOpenChange,
  onOpenProfile,
  onSelectAccount,
}: XingtuAccountPickerProps) {
  const content = (
    <div className="xingtu-account-popover">
      {accounts.length ? (
        <div className="xingtu-account-list" role="list">
          {accounts.map((account) => {
            const selected = account.profileId === displayedAccount?.profileId;
            return (
              <div className="xingtu-account-list-item" key={account.id} role="listitem">
                <div
                  className={`xingtu-account-item${selected ? ' selected' : ''}`}
                  onClick={() => {
                    void onSelectAccount(account);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void onSelectAccount(account);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="xingtu-account-name">
                    {selected ? <CheckOutlined /> : null}
                    <span>{account.name}</span>
                  </span>
                  <Tooltip title="进入后台">
                    <Button
                      className="xingtu-account-backstage"
                      disabled={!isElectronEgg}
                      icon={<ArrowRightOutlined />}
                      loading={openingProfileIds.includes(account.profileId)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onOpenProfile(account);
                      }}
                      shape="circle"
                      type="text"
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty className="xingtu-account-list-empty" description="暂无账号" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
      <div className="xingtu-account-popover-footer">
        <Button
          block
          disabled={!isElectronEgg || isLoginRunning}
          icon={<PlusOutlined />}
          loading={isStartingLogin || isLoginRunning}
          onClick={onAddAccount}
        >
          新增账号
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={onOpenChange}
      open={accountPickerOpen}
      placement="bottomLeft"
      trigger="click"
    >
      <Button className="xingtu-account-trigger" type="text">
        {displayedAccount?.avatarUrl ? (
          <img
            alt=""
            className="xingtu-account-trigger-avatar-image"
            referrerPolicy="no-referrer"
            src={displayedAccount.avatarUrl}
          />
        ) : (
          <span className="xingtu-account-trigger-avatar" aria-hidden="true">{displayedAccountAvatar}</span>
        )}
        <span className="xingtu-account-trigger-name">{displayedAccount?.name || '未选择账号'}</span>
        <CaretDownOutlined />
      </Button>
    </Popover>
  );
}
