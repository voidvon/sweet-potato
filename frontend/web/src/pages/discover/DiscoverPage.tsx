import { useMemo, useState } from 'react';
import {
  HeartOutlined,
  SearchOutlined,
  StarFilled,
} from '@ant-design/icons';
import { Input } from 'antd';
import { Play } from 'lucide-react';
import './DiscoverPage.scss';

type DiscoverItem = {
  id: number;
  title: string;
  author: string;
  category: string;
  media: 'image' | 'video';
  image: string;
  likes: string;
  favorites: number;
};

const categories = ['女装', '鞋帽服饰', '童装', '口播', '男装', '家居用品'];
const items: DiscoverItem[] = [
  { id: 1, title: '春日甜心穿搭', author: 'Mia', category: '女装', media: 'video', image: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=760&q=85', likes: '1.3k', favorites: 14 },
  { id: 2, title: '轻松感日常搭配', author: 'Luna', category: '女装', media: 'image', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=760&q=85', likes: '1k', favorites: 9 },
  { id: 3, title: '夏日蓝色长裙', author: 'Suki', category: '女装', media: 'image', image: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=760&q=85', likes: '736', favorites: 7 },
  { id: 4, title: '黑色礼服灵感', author: 'Vivi', category: '女装', media: 'video', image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=760&q=85', likes: '832', favorites: 4 },
  { id: 5, title: '复古楼梯写真', author: 'Nana', category: '女装', media: 'video', image: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=760&q=85', likes: '678', favorites: 6 },
  { id: 6, title: '城市咖啡馆穿搭', author: 'June', category: '女装', media: 'video', image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=760&q=85', likes: '583', favorites: 5 },
  { id: 7, title: '博物馆的蓝色裙装', author: 'Kiki', category: '女装', media: 'video', image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=760&q=85', likes: '792', favorites: 8 },
  { id: 8, title: '夏日草帽搭配', author: 'Coco', category: '女装', media: 'image', image: 'https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=760&q=85', likes: '693', favorites: 4 },
  { id: 9, title: '花园里的梦幻裙', author: 'Yuki', category: '女装', media: 'image', image: 'https://images.unsplash.com/photo-1496217590455-aa63a8350eea?auto=format&fit=crop&w=760&q=85', likes: '521', favorites: 12 },
  { id: 10, title: '极简黑色长裙', author: 'Iris', category: '女装', media: 'image', image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=760&q=85', likes: '487', favorites: 3 },
];

export function DiscoverPage() {
  const [media, setMedia] = useState<'all' | DiscoverItem['media']>('all');
  const [category, setCategory] = useState('女装');
  const [query, setQuery] = useState('');

  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesMedia = media === 'all' || item.media === media;
    const matchesCategory = item.category === category;
    const matchesQuery = !query.trim() || `${item.title}${item.author}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesMedia && matchesCategory && matchesQuery;
  }), [category, media, query]);

  return (
    <main className="discover-page">
      <div className="discover-page-content">
        <div className="discover-toolbar">
          <div className="discover-tabs" role="tablist" aria-label="内容类型">
            {[['all', '全部'], ['image', '图片'], ['video', '视频']].map(([value, label]) => (
              <button className={media === value ? 'is-active' : ''} key={value} onClick={() => setMedia(value as typeof media)} role="tab" type="button">
                {label}
              </button>
            ))}
          </div>
          <Input allowClear className="discover-search" prefix={<SearchOutlined />} placeholder="搜索" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="discover-categories" role="tablist" aria-label="内容分类">
          {categories.map((item) => (
            <button className={category === item ? 'is-active' : ''} key={item} onClick={() => setCategory(item)} type="button">{item}</button>
          ))}
        </div>
        <section className="discover-grid" aria-label="生成作品">
          {visibleItems.map((item) => (
            <article className="discover-card" key={item.id}>
              <div className="discover-card-media">
                <img alt={item.title} loading="lazy" src={item.image} />
                {item.media === 'video' ? <span className="discover-play"><Play aria-hidden="true" fill="currentColor" size={12} strokeWidth={2} /></span> : null}
                <div className="discover-card-meta"><span><StarFilled /> {item.likes}</span><span><HeartOutlined /> {item.favorites}</span></div>
              </div>
            </article>
          ))}
        </section>
        {visibleItems.length === 0 ? <div className="discover-empty">没有找到匹配的作品</div> : null}
      </div>
    </main>
  );
}
