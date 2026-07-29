import { useEffect, useMemo } from 'react';
import { Alert, Button, Input, Radio } from 'antd';
import { SearchOutlined, XFilled } from '@ant-design/icons';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { BuyinCreatorFilters } from './BuyinCreatorFilters';
import { XingtuCreatorFilters } from './XingtuCreatorFilters';
import { type CreatorOpsPlatform } from './creatorOpsPlatforms';
import { useXingtuCreatorPageController } from './xingtu/controller';
import { XingtuHeaderActions } from './xingtu/XingtuHeaderActions';
import { SEARCH_MODE_LABELS } from './xingtu/pageTypes';
import { XingtuSearchResults } from './xingtu/XingtuSearchResults';
import './XingtuCreatorPage.scss';

type XingtuCreatorPageProps = {
  platform?: CreatorOpsPlatform;
};

export function XingtuCreatorPage({ platform = 'xingtu' }: XingtuCreatorPageProps) {
  const { setHeaderExtra } = useWorkspaceHeader();
  const controller = useXingtuCreatorPageController({ platform });

  const headerActions = useMemo(() => (
    <XingtuHeaderActions
      accountPickerOpen={controller.accountPickerOpen}
      accounts={controller.accounts}
      displayedAccount={controller.displayedAccount}
      displayedAccountAvatar={controller.displayedAccountAvatar}
      isElectronEgg={controller.isElectronEgg}
      isLoginRunning={controller.isLoginRunning}
      isStartingLogin={controller.isStartingLogin}
      openingProfileIds={controller.openingProfileIds}
      searchTask={controller.searchTask}
      setAccountPickerOpen={controller.setAccountPickerOpen}
      onAddAccount={controller.handleAddAccount}
      onOpenProfile={controller.handleOpenProfile}
      onSelectAccount={controller.handleSelectAccount}
    />
  ), [
    controller.accountPickerOpen,
    controller.accounts,
    controller.displayedAccount,
    controller.displayedAccountAvatar,
    controller.handleAddAccount,
    controller.handleOpenProfile,
    controller.handleSelectAccount,
    controller.isElectronEgg,
    controller.isLoginRunning,
    controller.isStartingLogin,
    controller.openingProfileIds,
    controller.searchTask,
    controller.setAccountPickerOpen,
  ]);

  useEffect(() => {
    setHeaderExtra(headerActions);

    return () => {
      setHeaderExtra(null);
    };
  }, [headerActions, setHeaderExtra]);

  return (
    <div className="xingtu-creator-page">
      {!controller.isElectronEgg ? (
        <Alert message={`当前是 Web 预览模式，${controller.platformConfig.platformName}登录 Profile 只能在 Electron 应用内创建。`} showIcon type="warning" />
      ) : null}

      {controller.loginTask ? (
        <Alert
          message={`${controller.platformConfig.platformName}登录进行中`}
          description={controller.loginTask.status === 'running' ? '请在弹出的浏览器窗口完成登录。登录成功后会自动读取昵称并关闭窗口。' : `正在准备${controller.platformConfig.platformName}登录窗口。`}
          showIcon
          type="info"
        />
      ) : null}

      <section className="xingtu-spotlight-panel">
        <div className={`xingtu-spotlight-bar${controller.platformConfig.supportsSearchModes ? '' : ' xingtu-spotlight-bar-single'}`}>
          {controller.platformConfig.supportsSearchModes ? (
            <Radio.Group
              buttonStyle="solid"
              className="xingtu-search-mode-group"
              onChange={(event) => controller.setSearchMode(event.target.value)}
              optionType="button"
              size="small"
              value={controller.searchMode}
            >
              <Radio.Button value="content">{SEARCH_MODE_LABELS.content}</Radio.Button>
              <Radio.Button value="nickname">{SEARCH_MODE_LABELS.nickname}</Radio.Button>
            </Radio.Group>
          ) : null}

          <Input
            className="xingtu-command-input"
            onChange={(event) => controller.setCommandText(event.target.value)}
            onPressEnter={controller.handleSearchCreators}
            placeholder={controller.commandInputPlaceholder}
            ref={controller.commandInputRef}
            size="large"
            value={controller.commandText}
            variant="borderless"
          />

          <Button
            aria-label={controller.isSearching ? '停止达人搜索' : '开始达人搜索'}
            className="xingtu-search-button"
            danger={controller.isSearching}
            disabled={controller.isSwitchingProfile || controller.isStoppingSearch}
            icon={controller.isSearching ? <XFilled /> : <SearchOutlined />}
            onClick={controller.handleSearchButtonClick}
            shape="circle"
            type="primary"
          />
        </div>
      </section>

      {controller.platformConfig.supportsFilters ? (
        <section className="xingtu-filter-panel xingtu-filter-panel-merged">
          <div className="xingtu-filter-panel-body xingtu-filter-panel-body-structured">
            {controller.platformConfig.key === 'buyin' ? (
              <BuyinCreatorFilters
                onChange={controller.setBuyinFilters}
                value={controller.buyinFilters}
              />
            ) : (
              <XingtuCreatorFilters
                actions={controller.filterActions}
                values={controller.filterValues}
              />
            )}
          </div>
        </section>
      ) : null}

      {controller.lastSearchKeyword ? (
        <XingtuSearchResults
          isSearching={controller.isSearching}
          lastExecutedSearch={controller.lastExecutedSearch}
          lastSearchKeyword={controller.lastSearchKeyword}
          onOpenProfile={controller.handleOpenCreatorProfile}
          onPageChange={controller.handleSearchPageChange}
          platform={controller.platformConfig.key}
          results={controller.searchResults}
          resultsFooterRef={controller.resultsFooterRef}
          resultsHeaderRef={controller.resultsHeaderRef}
          resultsPanelRef={controller.resultsPanelRef}
          resultsTableScrollY={controller.resultsTableScrollY}
          searchPagination={controller.searchPagination}
          supportsSearchModes={controller.platformConfig.supportsSearchModes}
        />
      ) : null}
    </div>
  );
}
