import { DownloadOutlined } from '@ant-design/icons';
import { Image, message } from 'antd';
import {
  Children,
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { downloadUrlAsFile } from '@shared/utils/download';
import './AppImage.scss';

export type AppImageDownload = {
  fileName?: string;
  url: string;
};

type AppImageProps = ComponentProps<typeof Image> & {
  download?: AppImageDownload | false;
  onDownload?: (download: AppImageDownload) => Promise<void> | void;
};

type AppImagePreviewGroupProps = ComponentProps<typeof Image.PreviewGroup> & {
  downloads?: AppImageDownload[];
  onDownload?: (download: AppImageDownload, current: number) => Promise<void> | void;
};

function downloadFileName(url: string, fallback?: string) {
  if (fallback?.trim()) {
    return fallback;
  }
  try {
    return decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop() || '') || '图片';
  } catch {
    return '图片';
  }
}

function appendDownloadAction(originalNode: ReactNode, onDownload: () => void) {
  if (!isValidElement(originalNode)) {
    return originalNode;
  }
  const actionsNode = originalNode as ReactElement<{ children?: ReactNode; className?: string }>;
  const actionsClassName = actionsNode.props.className?.split(' ')[0] || 'ant-image-preview-actions';
  return cloneElement(actionsNode, undefined, [
    ...Children.toArray(actionsNode.props.children),
    <button
      aria-label="download"
      className={`${actionsClassName}-action app-image-preview-download`}
      key="download"
      onClick={onDownload}
      title="下载"
      type="button"
    >
      <DownloadOutlined />
    </button>,
  ]);
}

function runDownload(
  download: AppImageDownload,
  onDownload?: (download: AppImageDownload) => Promise<void> | void,
) {
  const operation = onDownload
    ? onDownload(download)
    : downloadUrlAsFile(download.url, downloadFileName(download.url, download.fileName));
  void Promise.resolve(operation).catch((error) => {
    message.error(error instanceof Error ? error.message : '图片下载失败');
  });
}

function AppImageBase({ download, onDownload, preview, ...props }: AppImageProps) {
  const previewConfig = preview && typeof preview === 'object' ? preview : {};
  const originalActionsRender = previewConfig.actionsRender;
  const defaultDownload = typeof props.src === 'string'
    ? { fileName: typeof props.alt === 'string' ? props.alt : undefined, url: props.src }
    : undefined;
  const resolvedDownload = download === false ? undefined : download || defaultDownload;

  return (
    <Image
      {...props}
      preview={preview === false || !resolvedDownload ? preview : {
        ...previewConfig,
        actionsRender: (originalNode, info) => appendDownloadAction(
          originalActionsRender?.(originalNode, info) || originalNode,
          () => runDownload(resolvedDownload, onDownload),
        ),
      }}
    />
  );
}

function AppImagePreviewGroup({ downloads, onDownload, preview, ...props }: AppImagePreviewGroupProps) {
  const previewConfig = preview && typeof preview === 'object' ? preview : {};
  const originalActionsRender = previewConfig.actionsRender;

  return (
    <Image.PreviewGroup
      {...props}
      preview={preview === false ? preview : {
        ...previewConfig,
        actionsRender: (originalNode, info) => {
          const image = info.image as { alt?: string; currentSrc?: string; src?: string; url?: string } | undefined;
          const imageUrl = image?.currentSrc || image?.src || image?.url;
          const currentDownload = downloads?.[info.current] || (imageUrl ? {
            fileName: image.alt,
            url: imageUrl,
          } : undefined);
          const renderedActions = originalActionsRender?.(originalNode, info) || originalNode;
          if (!currentDownload) {
            return renderedActions;
          }
          return appendDownloadAction(renderedActions, () => runDownload(
            currentDownload,
            onDownload ? (item) => onDownload(item, info.current) : undefined,
          ));
        },
      }}
    />
  );
}

export const AppImage = Object.assign(AppImageBase, {
  PreviewGroup: AppImagePreviewGroup,
});
