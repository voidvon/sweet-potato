import { useEffect, useRef, useState } from 'react';
import { MediaSlotStack, type MediaSlotItem } from './MediaSlotStack';

type AudioMaterialStackProps = {
  disablePopover?: boolean;
  items: MediaSlotItem[];
  onRemove: (item: MediaSlotItem) => void;
  renderAudioTitle?: (item: MediaSlotItem, index: number) => string;
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

  const removeAudio = (item: MediaSlotItem) => {
    audioRef.current?.pause();
    setPlayingId(null);
    onRemove(item);
  };

  const togglePlayback = (item: MediaSlotItem) => {
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
    <MediaSlotStack
      activeItemId={playingId}
      disablePopover={disablePopover}
      items={items}
      keepPopoverOnPreview
      onPreview={togglePlayback}
      onRemove={removeAudio}
      renderAudioTitle={renderAudioTitle}
    />
  );
}
