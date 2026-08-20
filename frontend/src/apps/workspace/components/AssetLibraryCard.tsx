import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Skeleton } from 'antd';
import './AssetLibraryCard.scss';
import { t } from '@shared/i18n';

const audioWaveBars = Array.from({ length: 15 }, (_, index) => index);

type AssetLibraryCardProps = {
  audioSrc?: string;
  audioTitle?: string;
  className?: string;
  clickArea?: 'card' | 'body';
  displayMode?: 'default' | 'compact';
  preview?: ReactNode;
  previewClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  descriptionClassName?: string;
  status?: ReactNode;
  statusClassName?: string;
  meta?: ReactNode;
  metaClassName?: string;
  actions?: ReactNode;
  onClick?: () => void;
};

type AssetLibraryCreateCardProps = {
  className?: string;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  onClick: () => void;
};

type AssetLibraryPlaceholderCardProps = {
  className?: string;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

type AssetLibrarySkeletonCardProps = {
  className?: string;
};

type AssetLibrarySkeletonCardsProps = {
  count: number;
  className?: string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function AssetLibraryAudioWave({ className }: { className?: string }) {
  return (
    <div aria-hidden className={classNames('asset-library-card__audio-wave', className)}>
      {audioWaveBars.map((item) => <span key={item} style={{ '--bar-index': item } as CSSProperties} />)}
    </div>
  );
}

export function AssetLibraryCard({
  audioSrc,
  audioTitle,
  className,
  clickArea = 'card',
  displayMode = 'default',
  preview,
  previewClassName,
  title,
  description,
  descriptionClassName,
  status,
  statusClassName,
  meta,
  metaClassName,
  actions,
  onClick,
}: AssetLibraryCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }
    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
    };
  }, [audioSrc]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onClick || clickArea !== 'card') {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  const toggleAudio = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
      return;
    }
    audio.pause();
    setIsPlaying(false);
  };

  const bodyContent = (
    <>
      <strong className="asset-library-card__title">{title}</strong>
      {description ? (
        <div className={classNames('asset-library-card__description', descriptionClassName)}>
          {description}
        </div>
      ) : null}
      {status ? (
        <div className={classNames('asset-library-card__status', statusClassName)}>
          {status}
        </div>
      ) : null}
      {meta ? (
        <div className={classNames('asset-library-card__meta', metaClassName)}>
          {meta}
        </div>
      ) : null}
      {actions ? <div className="asset-library-card__actions">{actions}</div> : null}
    </>
  );

  const body = onClick && clickArea === 'body' ? (
    <button
      className="asset-library-card__body asset-library-card__body--interactive"
      onClick={onClick}
      type="button"
    >
      {bodyContent}
    </button>
  ) : (
    <div className="asset-library-card__body">
      {bodyContent}
    </div>
  );

  const content = (
    <>
      {preview || audioSrc ? (
        <div className={classNames('asset-library-card__preview', previewClassName)}>
          {audioSrc ? (
            <AssetLibraryAudioWave />
          ) : null}
          {preview}
          {audioSrc ? (
            <>
              <button
                aria-label={isPlaying ? t("暂停播放{{0}}", { "0": audioTitle || '' }) : t("播放{{0}}", { "0": audioTitle || t("声音") })}
                className="asset-library-card__preview-audio-button"
                onClick={(event) => { void toggleAudio(event); }}
                type="button"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <audio ref={audioRef} preload="none" src={audioSrc} />
            </>
          ) : null}
        </div>
      ) : null}
      {body}
    </>
  );

  if (onClick && clickArea === 'card') {
    return (
      <div
        className={classNames('asset-library-card', 'asset-library-card--interactive', displayMode === 'compact' && 'asset-library-card--compact', className)}
        onClick={onClick}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
      >
        {content}
      </div>
    );
  }

  return (
    <article className={classNames('asset-library-card', onClick && clickArea === 'body' && 'asset-library-card--body-interactive', displayMode === 'compact' && 'asset-library-card--compact', className)}>
      {content}
    </article>
  );
}

export function AssetLibraryCreateCard({
  className,
  icon,
  title,
  description,
  onClick,
}: AssetLibraryCreateCardProps) {
  return (
    <button
      className={classNames('asset-library-card', 'asset-library-card--interactive', 'asset-library-card--create', className)}
      onClick={onClick}
      type="button"
    >
      <span className="asset-library-card__create-icon">{icon}</span>
      <strong className="asset-library-card__create-title">{title}</strong>
      {description ? <small className="asset-library-card__create-description">{description}</small> : null}
    </button>
  );
}

export function AssetLibraryPlaceholderCard({
  className,
  icon,
  title,
  description,
  actions,
}: AssetLibraryPlaceholderCardProps) {
  return (
    <article className={classNames('asset-library-card', 'asset-library-card--create', className)}>
      <span className="asset-library-card__create-icon">{icon}</span>
      <strong className="asset-library-card__create-title">{title}</strong>
      {description ? <small className="asset-library-card__create-description">{description}</small> : null}
      {actions ? <div className="asset-library-card__actions">{actions}</div> : null}
    </article>
  );
}

export function AssetLibrarySkeletonCard({ className }: AssetLibrarySkeletonCardProps) {
  return (
    <article className={classNames('asset-library-card', 'asset-library-card--skeleton', className)}>
      <div className="asset-library-card__preview asset-library-card__preview--skeleton">
      </div>
      <div className="asset-library-card__body">
      </div>
    </article>
  );
}

export function AssetLibrarySkeletonCards({ count, className }: AssetLibrarySkeletonCardsProps) {
  return Array.from({ length: count }, (_, index) => (
    <AssetLibrarySkeletonCard key={`asset-library-skeleton-${index}`} className={className} />
  ));
}
