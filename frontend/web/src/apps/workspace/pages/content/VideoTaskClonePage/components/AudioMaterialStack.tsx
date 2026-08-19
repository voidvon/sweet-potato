import { useEffect, useRef, useState } from 'react';
import { MediaAttachmentStack, type MediaAttachmentItem } from '../../../../components/MediaAttachmentStack';

type AudioMaterialStackProps = {
  disablePopover?: boolean;
  items: MediaAttachmentItem[];
  onRemove: (item: MediaAttachmentItem) => void;
  renderAudioTitle?: (item: MediaAttachmentItem, index: number) => string;
};

export function AudioMaterialStack({ disablePopover, items, onRemove, renderAudioTitle }: AudioMaterialStackProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    if (!playingId || items.some((item) => item.id === playingId)) return;
    audioRef.current?.pause();
    setPlayingId(null);
  }, [items, playingId]);

  const removeAudio = (item: MediaAttachmentItem) => {
    audioRef.current?.pause();
    setPlayingId(null);
    onRemove(item);
  };

  const togglePlayback = (item: MediaAttachmentItem) => {
    if (!item.src) return;

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;
    if (playingId === item.id && !audio.paused) {
      audio.pause();
      setPlayingId(null);
      return;
    }

    audio.pause();
    audio.src = item.src;
    audio.currentTime = 0;
    audio.onended = () => setPlayingId(null);
    void audio.play().then(() => setPlayingId(item.id)).catch(() => setPlayingId(null));
  };

  return (
    <MediaAttachmentStack
      activeItemId={playingId}
      expandOnHover={!disablePopover}
      items={items}
      keepExpandedOnPreview
      layout="offset"
      onPreview={togglePlayback}
      onRemove={removeAudio}
      renderAudioTitle={renderAudioTitle}
    />
  );
}
