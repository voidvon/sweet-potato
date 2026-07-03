import { SoundOutlined } from '@ant-design/icons';
import { mergeAttributes, type JSONContent } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import './MentionRichTextarea.scss';

export type MentionRichTextareaOption = {
  label: string;
  mimeType?: string;
  previewUrl?: string;
  subtitle?: string;
  token: string;
};

type MentionRichTextareaProps = {
  disabled?: boolean;
  minRows?: number;
  onChange: (value: string) => void;
  options: MentionRichTextareaOption[];
  placeholder?: string;
  value: string;
};

type MentionSuggestionItem = MentionRichTextareaOption;
type MentionDomChild = ['img', { alt: string; src: string }] | ['span', { class: string }, string] | ['b', Record<string, never>, string];

type MentionListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type MentionListProps = SuggestionProps<MentionSuggestionItem, MentionSuggestionItem>;

const mentionPattern = /@(?:图片|视频|音频)\d+/gu;

function isAudioMention(option: Pick<MentionRichTextareaOption, 'label' | 'mimeType' | 'token'>) {
  return option.mimeType?.startsWith('audio/') || /音频/u.test(`${option.token} ${option.label}`);
}

function isVideoMention(option: Pick<MentionRichTextareaOption, 'label' | 'mimeType' | 'token'>) {
  return option.mimeType?.startsWith('video/') || /视频/u.test(`${option.token} ${option.label}`);
}

function mentionKind(option: Pick<MentionRichTextareaOption, 'label' | 'mimeType' | 'token'>) {
  if (isAudioMention(option)) {
    return 'audio';
  }
  if (isVideoMention(option)) {
    return 'video';
  }
  return 'image';
}

function mentionFallbackIcon(option: Pick<MentionRichTextareaOption, 'label' | 'mimeType' | 'token'>) {
  if (isAudioMention(option)) {
    return '♪';
  }
  if (isVideoMention(option)) {
    return '视';
  }
  return option.label.slice(0, 1);
}

function mentionOptionIcon(option: Pick<MentionRichTextareaOption, 'label' | 'mimeType' | 'token'>) {
  if (isAudioMention(option)) {
    return <SoundOutlined />;
  }
  if (isVideoMention(option)) {
    return '视';
  }
  return option.label.slice(0, 1);
}

const ReferenceMention = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView);
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      previewUrl: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-preview-url'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const previewUrl = typeof attributes.previewUrl === 'string' ? attributes.previewUrl : '';
          return previewUrl ? { 'data-preview-url': previewUrl } : {};
        },
      },
      mimeType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-mime-type'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const mimeType = typeof attributes.mimeType === 'string' ? attributes.mimeType : '';
          return mimeType ? { 'data-mime-type': mimeType } : {};
        },
      },
    };
  },
});

function MentionChipView({ node }: NodeViewProps) {
  const previewUrl = String(node.attrs.previewUrl ?? '');
  const mimeType = String(node.attrs.mimeType ?? '');
  const token = String(node.attrs.id ?? '');
  const label = String(node.attrs.label ?? token).replace(/^@/, '');
  const mentionInfo = { label, mimeType, token };
  const fallbackIcon = mentionFallbackIcon(mentionInfo);
  const shouldShowPreview = Boolean(previewUrl && !isAudioMention(mentionInfo));
  const kind = mentionKind(mentionInfo);
  return (
    <NodeViewWrapper
      as="span"
      className="mention-rich-textarea-chip"
      data-mention-kind={kind}
      data-mime-type={mimeType || undefined}
      data-preview-url={previewUrl || undefined}
      data-token={token}
    >
      {shouldShowPreview ? <img alt={label} src={previewUrl} /> : <span className="mention-rich-textarea-chip-icon">{fallbackIcon}</span>}
      <b>{label}</b>
    </NodeViewWrapper>
  );
}

function textNode(text: string): JSONContent {
  return { type: 'text', text };
}

function paragraph(content: JSONContent[]): JSONContent {
  return { type: 'paragraph', content: content.length > 0 ? content : undefined };
}

function plainTextToDoc(value: string, options: MentionRichTextareaOption[]): JSONContent {
  const optionByToken = new Map(options.map((option) => [option.token, option]));
  const paragraphs = value.split('\n').map((line) => {
    const content: JSONContent[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(mentionPattern)) {
      const token = match[0];
      const index = match.index ?? 0;
      if (index > lastIndex) {
        content.push(textNode(line.slice(lastIndex, index)));
      }

      const option = optionByToken.get(token);
      if (option) {
        content.push({
          type: 'mention',
          attrs: {
            id: option.token,
            label: option.label,
            mimeType: option.mimeType ?? '',
            previewUrl: option.previewUrl ?? '',
          },
        });
      } else {
        content.push(textNode(token));
      }
      lastIndex = index + token.length;
    }

    if (lastIndex < line.length) {
      content.push(textNode(line.slice(lastIndex)));
    }

    return paragraph(content);
  });

  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [paragraph([])],
  };
}

function nodeToPlainText(node: JSONContent): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (node.type === 'mention') {
    return String(node.attrs?.id ?? '');
  }
  const childText = (node.content ?? []).map(nodeToPlainText);
  if (node.type === 'doc') {
    return childText.join('\n');
  }
  if (node.type === 'paragraph') {
    return childText.join('');
  }
  return childText.join('');
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(function MentionList({ command, items }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) {
      command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) {
        return false;
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selected) => (selected + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selected) => (selected + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return <div className="mention-rich-textarea-menu mention-rich-textarea-menu--empty">没有可用素材</div>;
  }

  return (
    <div className="mention-rich-textarea-menu">
      <div className="mention-rich-textarea-menu__header">
        <strong>可引用素材</strong>
        <span>选择素材会自动插入引用</span>
      </div>
      {items.map((item, index) => (
        <button
          className={index === selectedIndex ? 'is-selected' : ''}
          key={item.token}
          onMouseDown={(event) => {
            event.preventDefault();
            selectItem(index);
          }}
          type="button"
        >
          {item.previewUrl && !isAudioMention(item) ? (
            <img alt={item.label} src={item.previewUrl} />
          ) : (
            <span data-mention-kind={mentionKind(item)}>{mentionOptionIcon(item)}</span>
          )}
          <span className="mention-rich-textarea-option__body">
            <strong>{item.token}</strong>
            {item.subtitle ? <small>{item.subtitle}</small> : null}
          </span>
        </button>
      ))}
    </div>
  );
});

export function MentionRichTextarea({
  disabled,
  minRows = 8,
  onChange,
  options,
  placeholder,
  value,
}: MentionRichTextareaProps) {
  const minHeight = Math.max(minRows, 1) * 25 + 40;
  const isEmpty = value.length === 0;
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const extensions = useMemo(() => {
    return [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
      }),
      ReferenceMention.configure({
        HTMLAttributes: {
          class: 'mention-rich-textarea-chip',
        },
        renderHTML({ node, options: mentionOptions }) {
          const previewUrl = String(node.attrs.previewUrl ?? '');
          const mimeType = String(node.attrs.mimeType ?? '');
          const label = String(node.attrs.label ?? node.attrs.id ?? '').replace(/^@/, '');
          const mentionInfo = {
            label,
            mimeType,
            token: String(node.attrs.id ?? ''),
          };
          const fallbackIcon = mentionFallbackIcon(mentionInfo);
          const shouldShowPreview = Boolean(previewUrl && !isAudioMention(mentionInfo));
          const kind = mentionKind(mentionInfo);
          const children: MentionDomChild[] = shouldShowPreview
            ? [
                ['img', { alt: label, src: previewUrl }],
                ['b', {}, label],
              ]
            : [
                ['span', { class: 'mention-rich-textarea-chip-icon' }, fallbackIcon],
                ['b', {}, label],
              ];
          return [
            'span',
            mergeAttributes(mentionOptions.HTMLAttributes, {
              'data-mention-kind': kind,
              'data-token': node.attrs.id,
            }),
            ...children,
          ];
        },
        renderText({ node }) {
          return String(node.attrs.id ?? '');
        },
        suggestion: {
          allowedPrefixes: null,
          char: '@',
          items: ({ query }) => {
            const normalizedQuery = query.trim().toLowerCase();
            return optionsRef.current
              .filter((option) => {
                if (!normalizedQuery) {
                  return true;
                }
                return `${option.token} ${option.label} ${option.subtitle ?? ''}`.toLowerCase().includes(normalizedQuery);
              })
              .slice(0, 8);
          },
          command: ({ editor, range, props }) => {
            const item = props as unknown as MentionSuggestionItem;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'mention',
                  attrs: {
                    id: item.token,
                    label: item.label,
                    mimeType: item.mimeType ?? '',
                    previewUrl: item.previewUrl ?? '',
                  },
                },
              ])
              .run();
          },
          render: () => {
            let component: ReactRenderer<MentionListRef, MentionListProps> | null = null;
            let unmount: (() => void) | null = null;

            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, {
                  editor: props.editor,
                  props,
                });
                unmount = props.mount(component.element, {
                  autoUpdate: {
                    animationFrame: true,
                  },
                });
              },
              onUpdate(props) {
                component?.updateProps(props);
              },
              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  unmount?.();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                unmount?.();
                component?.destroy();
                component = null;
                unmount = null;
              },
            };
          },
        },
      }),
    ];
  }, []);

  const editor = useEditor({
    content: plainTextToDoc(value, options),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'mention-rich-textarea-editor',
        'data-placeholder': placeholder ?? '',
        style: `min-height: ${minHeight}px`,
      },
    },
    extensions,
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      onChange(nodeToPlainText(currentEditor.getJSON()));
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const currentValue = nodeToPlainText(editor.getJSON());
    if (currentValue !== value) {
      editor.commands.setContent(plainTextToDoc(value, options), { emitUpdate: false });
    }
  }, [editor, options, value]);

  return (
    <div className={disabled ? 'mention-rich-textarea is-disabled' : 'mention-rich-textarea'} style={{ minHeight }}>
      {placeholder && isEmpty ? (
        <button
          className="mention-rich-textarea-placeholder"
          onClick={() => editor?.chain().focus().run()}
          tabIndex={-1}
          type="button"
        >
          {placeholder}
        </button>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
