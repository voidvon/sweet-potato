import { Clapperboard, Image, Music2 } from 'lucide-react';
import type { MaterialKey } from '../types';

export function materialIcon(key: MaterialKey) {
  if (key === 'audio') return <Music2 size={15} />;
  if (key === 'video') return <Clapperboard size={15} />;
  return <Image size={15} />;
}
