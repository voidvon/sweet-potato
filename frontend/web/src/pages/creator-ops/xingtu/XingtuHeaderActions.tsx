import type { AutomationTask } from '../../../ipc';
import { AutomationTaskLogTrigger } from '../AutomationTaskLogTrigger';
import { XingtuAccountPicker } from './XingtuAccountPicker';
import type { XingtuAccount } from './pageTypes';

type XingtuHeaderActionsProps = {
  accountPickerOpen: boolean;
  accounts: XingtuAccount[];
  displayedAccount: XingtuAccount | null;
  displayedAccountAvatar: string;
  isElectronEgg: boolean;
  isLoginRunning: boolean;
  isStartingLogin: boolean;
  openingProfileIds: string[];
  searchTask: AutomationTask | null;
  setAccountPickerOpen: (open: boolean) => void;
  onAddAccount: () => void;
  onOpenProfile: (account: XingtuAccount) => void;
  onSelectAccount: (account: XingtuAccount) => void;
};

export function XingtuHeaderActions(props: XingtuHeaderActionsProps) {
  return (
    <div className="xingtu-creator-header-actions">
      <AutomationTaskLogTrigger
        emptyText="暂无达人搜索任务日志"
        label="最近一次达人搜索"
        task={props.searchTask}
      />

      <XingtuAccountPicker
        accountPickerOpen={props.accountPickerOpen}
        accounts={props.accounts}
        displayedAccount={props.displayedAccount}
        displayedAccountAvatar={props.displayedAccountAvatar}
        isElectronEgg={props.isElectronEgg}
        isLoginRunning={props.isLoginRunning}
        isStartingLogin={props.isStartingLogin}
        openingProfileIds={props.openingProfileIds}
        onAddAccount={props.onAddAccount}
        onOpenChange={props.setAccountPickerOpen}
        onOpenProfile={props.onOpenProfile}
        onSelectAccount={props.onSelectAccount}
      />
    </div>
  );
}
