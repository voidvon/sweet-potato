import { Modal } from 'antd';
import { X } from 'lucide-react';
import { modelPickerOptions } from '../constants';

type ModelPickerProps = {
  onClose: () => void;
  onSelect: (name: string) => void;
  selectedModelAvatar: string;
};

export function ModelPicker({ onClose, onSelect, selectedModelAvatar }: ModelPickerProps) {
  return (
    <Modal
      centered
      className="vc-model-picker video-task-model-picker"
      closable={false}
      footer={null}
      mask={{ closable: true }}
      onCancel={onClose}
      open
      styles={{
        body: { padding: 0 },
      }}
      title={null}
      width={720}
    >
      <section className="vc-model-picker__panel">
        <header className="vc-model-picker__head">
          <div className="vc-model-picker__head-text">
            <strong>选择模特</strong>
            <p>从系统模特库挑一张，会作为参考图加进合成区</p>
          </div>
          <button aria-label="关闭模特库" className="vc-model-picker__close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="vc-model-picker__body">
          <div className="vc-model-picker__grid">
            {modelPickerOptions.map((name, index) => (
              <button
                className={`vc-model-picker__card${selectedModelAvatar === name ? ' is-active' : ''}`}
                key={name}
                onClick={() => onSelect(name)}
                type="button"
              >
                <span style={{ backgroundImage: `url(${getModelPreviewUrl(index)})` }} />
                <small>{name}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </Modal>
  );
}

function getModelPreviewUrl(index: number) {
  const seed = [
    'portrait-child-boy-studio',
    'portrait-child-girl-cap',
    'portrait-young-man-studio',
    'portrait-young-woman-studio',
    'portrait-toddler-boy-hoodie',
    'portrait-girl-white-shirt',
    'portrait-man-tanktop',
    'portrait-woman-fashion',
    'portrait-boy-clean-background',
    'portrait-girl-green-dress',
  ][index % 10];

  return `https://images.unsplash.com/400x520/?${seed}&sig=${index + 11}`;
}
