import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Flex, Modal, Skeleton, Tag, Typography, message } from 'antd';
import { CloudDownloadOutlined, GithubOutlined, ReloadOutlined } from '@ant-design/icons';
import { API_BASE_URL } from '@shared/api/core/request';
import { getLocale, t } from '@shared/i18n';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { checkSystemUpdate, installSystemUpdate, type SystemUpdateInfo } from '../../api/system-update';
import './AboutPage.scss';

type AboutPageProps = {
  canUpdate: boolean;
};

function formatPublishedAt(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function waitForUpdatedServer(expectedVersion: string) {
  await new Promise((resolve) => window.setTimeout(resolve, 1500));
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health?update=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json() as { version?: string };
        if (payload.version === expectedVersion) return true;
      }
    } catch {
      // The server is expected to be briefly unavailable while restarting.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  return false;
}

export function AboutPage({ canUpdate }: AboutPageProps) {
  const [info, setInfo] = useState<SystemUpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await checkSystemUpdate());
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('版本检测失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  async function performUpdate() {
    setUpdating(true);
    try {
      const result = await installSystemUpdate();
      message.loading({ content: t('新版已下载，服务器正在重启…'), duration: 0, key: 'system-update' });
      if (await waitForUpdatedServer(result.version)) {
        message.success({ content: t('服务器已更新到 v{{0}}', { '0': result.version }), key: 'system-update' });
        window.location.reload();
        return;
      }
      message.warning({ content: t('更新已安装，但未能确认服务器重新上线，请检查服务状态。'), key: 'system-update' });
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('服务器更新失败'));
    } finally {
      setUpdating(false);
    }
  }

  function confirmUpdate() {
    if (!info?.latestVersion) return;
    Modal.confirm({
      title: t('更新到 v{{0}}', { '0': info.latestVersion }),
      content: t('更新期间服务会短暂重启，当前程序将保留为备份。'),
      okText: t('立即更新'),
      cancelText: t('取消'),
      centered: true,
      onOk: performUpdate,
    });
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page about-page">
        <section className="settings-header about-page-header">
          <Typography.Paragraph>{t('查看应用版本、开源仓库与服务器更新状态。')}</Typography.Paragraph>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadInfo()}>
            {t('检测更新')}
          </Button>
        </section>

        <section className="about-page-content">
          {loading && !info ? (
            <Skeleton active paragraph={{ rows: 5 }} />
          ) : (
            <Flex vertical gap={18}>
              <Descriptions bordered column={{ xs: 1, sm: 1, md: 2 }} size="middle">
                <Descriptions.Item label={t('当前版本')}>
                  <Tag color="blue">v{info?.currentVersion || '-'}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t('最新版本')}>
                  {info?.latestVersion ? <Tag color={info.updateAvailable ? 'orange' : 'green'}>v{info.latestVersion}</Tag> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('发布时间')}>{formatPublishedAt(info?.publishedAt)}</Descriptions.Item>
                <Descriptions.Item label={t('运行平台')}>{info?.assetName || '-'}</Descriptions.Item>
                <Descriptions.Item label="GitHub" span={2}>
                  <Button
                    href={info?.githubUrl || 'https://github.com/voidvon/sweet-potato'}
                    icon={<GithubOutlined />}
                    rel="noreferrer"
                    target="_blank"
                    type="link"
                  >
                    voidvon/sweet-potato
                  </Button>
                </Descriptions.Item>
              </Descriptions>

              {info?.checkError ? (
                <Alert showIcon type="warning" message={t('版本检测未完成')} description={info.checkError} />
              ) : info?.updateAvailable ? (
                <Alert
                  showIcon
                  type="info"
                  message={t('发现新版本 v{{0}}', { '0': info.latestVersion })}
                  description={t('新版本已在 GitHub Release 发布。')}
                  action={canUpdate ? (
                    <Button
                      icon={<CloudDownloadOutlined />}
                      loading={updating}
                      onClick={confirmUpdate}
                      type="primary"
                    >
                      {t('立即更新')}
                    </Button>
                  ) : undefined}
                />
              ) : info ? (
                <Alert showIcon type="success" message={t('当前已是最新版本')} />
              ) : null}

              {info?.releaseUrl && (
                <Typography.Link href={info.releaseUrl} rel="noreferrer" target="_blank">
                  {t('查看 GitHub Release')}
                </Typography.Link>
              )}
            </Flex>
          )}
        </section>
      </section>
    </ContentStudioLayout>
  );
}
