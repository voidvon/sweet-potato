import './VideoDurationPicker.scss';

export type VideoDurationOption = {
  label: string;
  value: string;
};

export function VideoDurationPicker({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: VideoDurationOption[];
  value: string;
}) {
  return (
    <div className="video-duration-picker">
      <h3>选择时长</h3>
      <div className="video-duration-picker__grid">
        {options.map((option) => (
          <button
            className={`video-duration-picker__option${option.value === value ? ' is-selected' : ''}`}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
