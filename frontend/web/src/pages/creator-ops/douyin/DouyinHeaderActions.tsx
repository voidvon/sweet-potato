import { Button, Popover } from 'antd'
import { CaretDownOutlined } from '@ant-design/icons'
import type { AutomationTask } from '../../../ipc'
import { AutomationTaskLogTrigger } from '../AutomationTaskLogTrigger'
import { DouyinAccountPicker } from './DouyinAccountPicker'
import type { DouyinAccount } from './pageTypes'
import './DouyinHeaderActions.scss'

type DouyinHeaderActionsProps = {
  accountPickerOpen: boolean
  accounts: DouyinAccount[]
  displayedAccount: DouyinAccount | null
  displayedAccountAvatar: string
  isElectronEgg: boolean
  isLoginRunning: boolean
  isStartingLogin: boolean
  isSwitchingProfile: boolean
  openingProfileIds: string[]
  searchTask: AutomationTask | null
  onAddAccount: () => void
  onOpenChange: (open: boolean) => void
  onOpenProfile: (account: DouyinAccount) => void
  onSelectAccount: (account: DouyinAccount) => void
}

export function DouyinHeaderActions(props: DouyinHeaderActionsProps) {
  return (
    <div className="douyin-creator-header-actions">
      <AutomationTaskLogTrigger
        emptyText="????????"
        label="????????"
        task={props.searchTask}
      />

      <Popover
        arrow={false}
        content={(
          <DouyinAccountPicker
            accounts={props.accounts}
            displayedAccount={props.displayedAccount}
            isElectronEgg={props.isElectronEgg}
            isLoginRunning={props.isLoginRunning}
            isStartingLogin={props.isStartingLogin}
            isSwitchingProfile={props.isSwitchingProfile}
            openingProfileIds={props.openingProfileIds}
            onAddAccount={props.onAddAccount}
            onOpenProfile={props.onOpenProfile}
            onSelectAccount={props.onSelectAccount}
          />
        )}
        onOpenChange={props.onOpenChange}
        open={props.accountPickerOpen}
        placement="bottomLeft"
        trigger="click"
      >
        <Button className="douyin-account-trigger" type="text">
          <span className="douyin-account-trigger-avatar" aria-hidden="true">
            {props.displayedAccountAvatar}
          </span>
          <span className="douyin-account-trigger-name">
            {props.displayedAccount?.name || '??? Profile'}
          </span>
          <CaretDownOutlined />
        </Button>
      </Popover>
    </div>
  )
}
