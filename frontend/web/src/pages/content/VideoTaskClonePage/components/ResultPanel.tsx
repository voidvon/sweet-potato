import { Clapperboard, Filter, Search } from 'lucide-react';
import { filterGroups } from '../constants';
import type { FilterValues } from '../types';

type ResultPanelProps = {
  filters: FilterValues;
  isFilterOpen: boolean;
  onClearFilters: () => void;
  onFilterChange: (filters: FilterValues) => void;
  onFilterToggle: () => void;
};

export function ResultPanel({
  filters,
  isFilterOpen,
  onClearFilters,
  onFilterChange,
  onFilterToggle,
}: ResultPanelProps) {
  return (
    <section className="video-task-result" aria-label="视频结果">
      <header className="video-task-result-header">
        <h1>视频结果</h1>
        <button className="video-task-filter" onClick={onFilterToggle} type="button">
          <Filter size={18} />
          筛选
        </button>
      </header>

      {isFilterOpen && (
        <aside className="video-task-filter-panel">
          <div className="video-task-popover-head">
            <strong>筛选生成记录</strong>
            <button onClick={onClearFilters} type="button">清空</button>
          </div>
          <label className="video-task-search">
            <Search size={16} />
            <input placeholder="搜索" />
          </label>
          {filterGroups.map((group) => (
            <div className="video-task-filter-group" key={group.label}>
              <span>{group.label}</span>
              <div>
                {group.options.map((option) => (
                  <button
                    className={filters[group.label] === option ? 'is-active' : ''}
                    key={option}
                    onClick={() => onFilterChange({ ...filters, [group.label]: option })}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>
      )}

      <div className="video-task-empty-state">
        <div className="video-task-empty-icon">
          <Clapperboard size={27} />
        </div>
        <strong>暂无视频结果</strong>
        <p>左侧提交任务后，结果会显示在这里。</p>
      </div>
    </section>
  );
}
