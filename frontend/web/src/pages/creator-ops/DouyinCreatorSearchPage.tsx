import { useEffect, useMemo } from 'react'
import { Alert, Button, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout'
import { useDouyinCreatorSearchController } from './douyin/controller'
import { DouyinHeaderActions } from './douyin/DouyinHeaderActions'
import { DouyinSearchResults } from './douyin/DouyinSearchResults'
import { useDouyinResultColumns } from './douyin/useDouyinResultColumns'
import './DouyinCreatorSearchPage.scss'

export function DouyinCreatorSearchPage() {
  const { setHeaderExtra } = useWorkspaceHeader()
  const controller = useDouyinCreatorSearchController()
  const columns = useDouyinResultColumns({
    favoriteCreatorKeySet: controller.favoriteCreatorKeySet,
    onOpenCreatorProfile: controller.handleOpenCreatorProfile,
    onToggleFavoriteCreator: controller.handleToggleFavoriteCreator,
  })

  const headerActions = useMemo(() => (
    <DouyinHeaderActions
      accountPickerOpen={controller.accountPickerOpen}
      accounts={controller.accounts}
      displayedAccount={controller.displayedAccount}
      displayedAccountAvatar={controller.displayedAccountAvatar}
      isElectronEgg={controller.isElectronEgg}
      isLoginRunning={controller.isLoginRunning}
      isStartingLogin={controller.isStartingLogin}
      isSwitchingProfile={controller.isSwitchingProfile}
      openingProfileIds={controller.openingProfileIds}
      searchTask={controller.searchTask}
      onAddAccount={() => {
        void controller.handleAddAccount()
      }}
      onOpenChange={controller.setAccountPickerOpen}
      onOpenProfile={(account) => {
        void controller.handleOpenProfile(account)
      }}
      onSelectAccount={(account) => {
        void controller.handleSelectAccount(account)
      }}
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
    controller.isSwitchingProfile,
    controller.openingProfileIds,
    controller.searchTask,
    controller.setAccountPickerOpen,
  ])

  useEffect(() => {
    setHeaderExtra(headerActions)
    return () => {
      setHeaderExtra(null)
    }
  }, [headerActions, setHeaderExtra])

  return (
    <div className="douyin-creator-page">
      {!controller.isElectronEgg ? (
        <Alert
          message="当前是 Web 预览模式，抖音达人入口仅支持在 Electron 应用内使用。"
          showIcon
          type="warning"
        />
      ) : null}

      {controller.loginTask ? (
        <Alert
          description={controller.loginTask.status === 'running'
            ? '请在弹出的抖音窗口完成登录，完成后会自动保存为可复用的 Profile。'
            : '正在准备抖音登录窗口。'}
          message="抖音登录进行中"
          showIcon
          type="info"
        />
      ) : null}

      {!controller.accounts.length ? (
        <Alert
          message="请先新增一个 Profile"
          description="每个 Profile 对应一套独立的抖音登录态。右上角点击 Profile 后新增账号，登录成功后会自动保留，下次可直接复用。"
          showIcon
          type="info"
        />
      ) : null}

      <section className="douyin-spotlight-panel">
        <div className="douyin-spotlight-bar">
          <Input
            className="douyin-command-input"
            disabled={!controller.isElectronEgg || controller.running || controller.isSwitchingProfile}
            onChange={(event) => controller.setKeyword(event.target.value)}
            onPressEnter={() => {
              void controller.handleSearch()
            }}
            placeholder="输入达人昵称、抖音号或业务关键词，直接打开抖音 PC 搜索"
            prefix={<SearchOutlined />}
            value={controller.keyword}
          />
          <Button
            className="douyin-search-button"
            disabled={!controller.isElectronEgg || controller.isSwitchingProfile}
            icon={<SearchOutlined />}
            loading={controller.running || controller.isLoadingMore}
            onClick={() => {
              void controller.handleSearch()
            }}
            shape="circle"
            type="primary"
          />
        </div>
      </section>

      <DouyinSearchResults
        columns={columns}
        hasMoreResults={controller.hasMoreResults}
        isLoadingMore={controller.isLoadingMore}
        onConnectSelected={() => {
          void controller.handleConnectSelectedAction()
        }}
        onLoadMore={() => {
          void controller.handleLoadMore()
        }}
        results={controller.searchResults}
        resultsHeaderRef={controller.resultsHeaderRef}
        resultsPanelRef={controller.resultsPanelRef}
        resultsTableScrollY={controller.resultsTableScrollY}
        rowSelection={controller.rowSelection}
        running={controller.running}
        searchTask={controller.searchTask}
        selectedCount={controller.selectedCount}
      />
    </div>
  )
}
