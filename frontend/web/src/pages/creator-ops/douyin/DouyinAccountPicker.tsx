import { Button, Empty, Tooltip } from 'antd'
import { ArrowRightOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons'
import type { DouyinAccount } from './pageTypes'
import './DouyinAccountPicker.scss'

type DouyinAccountPickerProps = {
  accounts: DouyinAccount[]
  displayedAccount: DouyinAccount | null
  isElectronEgg: boolean
  isLoginRunning: boolean
  isStartingLogin: boolean
  isSwitchingProfile: boolean
  openingProfileIds: string[]
  onAddAccount: () => void
  onOpenProfile: (account: DouyinAccount) => void
  onSelectAccount: (account: DouyinAccount) => void
}

export function DouyinAccountPicker({
  accounts,
  displayedAccount,
  isElectronEgg,
  isLoginRunning,
  isStartingLogin,
  isSwitchingProfile,
  openingProfileIds,
  onAddAccount,
  onOpenProfile,
  onSelectAccount,
}: DouyinAccountPickerProps) {
  return (
    <div className="douyin-account-popover">
      {accounts.length ? (
        <div className="douyin-account-list" role="list">
          {accounts.map((account) => {
            const selected = account.profileId === displayedAccount?.profileId
            return (
              <div className="douyin-account-list-item" key={account.id} role="listitem">
                <div
                  className={`douyin-account-item${selected ? ' selected' : ''}`}
                  onClick={() => {
                    onSelectAccount(account)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectAccount(account)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="douyin-account-name">
                    {selected ? <CheckOutlined /> : null}
                    <span>{account.name}</span>
                  </span>
                  <Tooltip title="打开主页">
                    <Button
                      className="douyin-account-backstage"
                      disabled={!isElectronEgg}
                      icon={<ArrowRightOutlined />}
                      loading={openingProfileIds.includes(account.profileId)}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenProfile(account)
                      }}
                      shape="circle"
                      type="text"
                    />
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty
          className="douyin-account-list-empty"
          description="暂无 Profile"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
      <div className="douyin-account-popover-footer">
        <Button
          block
          disabled={!isElectronEgg || isSwitchingProfile || isLoginRunning}
          icon={<PlusOutlined />}
          loading={isStartingLogin || isLoginRunning}
          onClick={onAddAccount}
        >
          新增 Profile
        </Button>
      </div>
    </div>
  )
}
