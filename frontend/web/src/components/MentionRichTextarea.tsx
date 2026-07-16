import { SoundOutlined } from '@ant-design/icons';
import { Image } from 'antd';
import { mergeAttributes, type Editor, type JSONContent } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import './MentionRichTextarea.scss';

export type MentionRichTextareaOption = {
  attachmentId?: string;
  isPlaceholder?: boolean;
  label: string;
  mimeType?: string;
  name?: string;
  previewUrl?: string;
  subtitle?: string;
  token: string;
};

type MentionRichTextareaProps = {
  className?: string;
  disabled?: boolean;
  editorClassName?: string;
  emptyText?: string;
  fallbackMentionMenu?: boolean;
  menuDescription?: string;
  menuTitle?: string;
  minRows?: number;
  onChange: (value: string) => void;
  onPlaceholderClick?: (option: MentionRichTextareaOption) => void;
  onSubmit?: () => void;
  options: MentionRichTextareaOption[];
  placeholder?: string;
  suggestionContainer?: string | HTMLElement;
  value: string;
};

export type MentionRichTextareaRef = {
  focus: () => void;
};

type MentionSuggestionItem = MentionRichTextareaOption;
type MentionDomChild = ['img', { alt: string; src: string }] | ['span', { class: string }, string] | ['b', Record<string, never>, string];

type MentionListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type MentionListProps = SuggestionProps<MentionSuggestionItem, MentionSuggestionItem> & {
  emptyText: string;
  menuDescription: string;
  menuTitle: string;
};

type FallbackMentionRange = {
  from: number;
  query: string;
  to: number;
};

type MentionPreviewImage = {
  alt: string;
  src: string;
};

type MentionPlaceholderRequest = {
  token: string;
};

const mentionPreviewEventName = 'mention-rich-textarea-preview';
const mentionPlaceholderEventName = 'mention-rich-textarea-placeholder';

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

function mentionOptionTitle(option: Pick<MentionRichTextareaOption, 'token'>) {
  return option.token;
}

function mentionOptionDescription(option: Pick<MentionRichTextareaOption, 'label' | 'name' | 'subtitle'>) {
  return option.name || option.subtitle || option.label;
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
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const attachmentId = typeof attributes.attachmentId === 'string' ? attributes.attachmentId : '';
          return attachmentId ? { 'data-attachment-id': attachmentId } : {};
        },
      },
      isPlaceholder: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-placeholder') === 'true',
        renderHTML: (attributes: Record<string, unknown>) => (
          attributes.isPlaceholder === true ? { 'data-placeholder': 'true' } : {}
        ),
      },
    };
  },
});

function MentionChipView({ node }: NodeViewProps) {
  const previewUrl = String(node.attrs.previewUrl ?? '');
  const mimeType = String(node.attrs.mimeType ?? '');
  const attachmentId = String(node.attrs.attachmentId ?? '');
  const isPlaceholder = node.attrs.isPlaceholder === true;
  const token = String(node.attrs.id ?? '');
  const label = String(node.attrs.label ?? token).replace(/^@/, '');
  const mentionInfo = { label, mimeType, token };
  const fallbackIcon = mentionFallbackIcon(mentionInfo);
  const shouldShowPreview = Boolean(!isPlaceholder && previewUrl && !isAudioMention(mentionInfo));
  const kind = mentionKind(mentionInfo);
  const canPreviewImage = Boolean(previewUrl && kind === 'image');
  return (
    <NodeViewWrapper
      as="span"
      className={[
        'mention-rich-textarea-chip',
        canPreviewImage ? 'is-previewable' : '',
        isPlaceholder ? 'is-placeholder' : '',
      ].filter(Boolean).join(' ')}
      data-mention-kind={kind}
      data-mime-type={mimeType || undefined}
      data-preview-url={previewUrl || undefined}
      data-attachment-id={attachmentId || undefined}
      data-token={token}
      onClick={(event: MouseEvent<HTMLSpanElement>) => {
        if (isPlaceholder) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.dispatchEvent(new CustomEvent<MentionPlaceholderRequest>(mentionPlaceholderEventName, {
            bubbles: true,
            detail: { token },
          }));
          return;
        }
        if (!canPreviewImage) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.dispatchEvent(new CustomEvent<MentionPreviewImage>(mentionPreviewEventName, {
          bubbles: true,
          detail: {
            alt: label,
            src: previewUrl,
          },
        }));
      }}
    >
      {shouldShowPreview ? <img alt={label} src={previewUrl} /> : (
        <span className="mention-rich-textarea-chip-icon">{isPlaceholder ? '+' : fallbackIcon}</span>
      )}
      <b>{isPlaceholder ? token : label}</b>
    </NodeViewWrapper>
  );
}

function textNode(text: string): JSONContent {
  return { type: 'text', text };
}

function paragraph(content: JSONContent[]): JSONContent {
  return { type: 'paragraph', content: content.length > 0 ? content : undefined };
}

function mentionContentNode(option: MentionRichTextareaOption): JSONContent {
  return {
    type: 'mention',
    attrs: {
      attachmentId: option.attachmentId ?? '',
      id: option.token,
      isPlaceholder: option.isPlaceholder === true,
      label: option.label,
      mimeType: option.mimeType ?? '',
      previewUrl: option.previewUrl ?? '',
    },
  };
}

function normalizeMentionDoc(node: JSONContent, options: MentionRichTextareaOption[]): JSONContent | null {
  const optionByAttachmentId = new Map(
    options
      .filter((option) => option.attachmentId)
      .map((option) => [option.attachmentId as string, option]),
  );
  const optionByToken = new Map(options.map((option) => [option.token, option]));

  const normalizeNode = (currentNode: JSONContent): JSONContent | null => {
    if (currentNode.type === 'mention') {
      const attachmentId = typeof currentNode.attrs?.attachmentId === 'string' ? currentNode.attrs.attachmentId : '';
      const token = typeof currentNode.attrs?.id === 'string' ? currentNode.attrs.id : '';
      const option = (attachmentId ? optionByAttachmentId.get(attachmentId) : undefined) ?? optionByToken.get(token);
      if (!option) {
        return null;
      }
      const normalizedMention = mentionContentNode(option);
      return {
        ...currentNode,
        attrs: {
          ...currentNode.attrs,
          ...normalizedMention.attrs,
        },
      };
    }

    if (!currentNode.content) {
      return currentNode;
    }

    const content = currentNode.content
      .map(normalizeNode)
      .filter((item): item is JSONContent => Boolean(item));

    return {
      ...currentNode,
      content: content.length > 0 ? content : undefined,
    };
  };

  return normalizeNode(node);
}

function plainTextToDoc(value: string, options: MentionRichTextareaOption[]): JSONContent {
  const optionByToken = new Map(options.map((option) => [option.token, option]));
  const mentionTokens = [...optionByToken.keys()].sort((left, right) => right.length - left.length);
  const paragraphs = value.split('\n').map((line) => {
    const content: JSONContent[] = [];
    let index = 0;

    while (index < line.length) {
      const matchedToken = mentionTokens.find((token) => line.startsWith(token, index));
      if (matchedToken) {
        const option = optionByToken.get(matchedToken);
        if (option) {
          content.push(mentionContentNode(option));
          index += matchedToken.length;
          continue;
        }
      }

      const nextTokenIndex = mentionTokens
        .map((token) => line.indexOf(token, index + 1))
        .filter((tokenIndex) => tokenIndex !== -1)
        .sort((left, right) => left - right)[0] ?? line.length;
      content.push(textNode(line.slice(index, nextTokenIndex)));
      index = nextTokenIndex;
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

function isJsonContentEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => isJsonContentEqual(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(rightRecord, key)
      && isJsonContentEqual(leftRecord[key], rightRecord[key]));
}

function getActiveFallbackMentionRange(editor: Editor): FallbackMentionRange | null {
  const { from, empty } = editor.state.selection;
  if (!empty) {
    return null;
  }
  const $from = editor.state.selection.$from;
  const parentOffset = $from.parentOffset;
  const textBeforeCursor = $from.parent.textBetween(0, parentOffset, '\n', '\n');
  const match = /(?:^|\s)@(\S*)$/u.exec(textBeforeCursor);
  if (!match) {
    return null;
  }
  const triggerOffset = textBeforeCursor.lastIndexOf('@');
  return {
    from: from - (parentOffset - triggerOffset),
    query: match[1] ?? '',
    to: from,
  };
}

function filterMentionOptions(options: MentionRichTextareaOption[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return options
    .filter((option) => {
      if (!normalizedQuery) {
        return true;
      }
      return `${option.token} ${option.label} ${option.subtitle ?? ''}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 8);
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(function MentionList({
  command,
  emptyText,
  items,
  menuDescription,
  menuTitle,
}, ref) {
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
    return <div className="mention-rich-textarea-menu mention-rich-textarea-menu--empty">{emptyText}</div>;
  }

  return (
    <div className="mention-rich-textarea-menu">
      <div className="mention-rich-textarea-menu__header">
        <strong>{menuTitle}</strong>
        <span>{menuDescription}</span>
      </div>
      <div className="mention-rich-textarea-menu__list">
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
            <strong>{mentionOptionTitle(item)}</strong>
            <small>{mentionOptionDescription(item)}</small>
          </span>
        </button>
      ))}
      </div>
    </div>
  );
});

export const MentionRichTextarea = forwardRef<MentionRichTextareaRef, MentionRichTextareaProps>(function MentionRichTextarea({
  className,
  disabled,
  editorClassName,
  emptyText = '没有可用素材',
  fallbackMentionMenu = false,
  menuDescription = '选择素材会自动插入引用',
  menuTitle = '可引用素材',
  minRows = 8,
  onChange,
  onPlaceholderClick,
  onSubmit,
  options,
  placeholder,
  suggestionContainer,
  value,
}, ref) {
  const minHeight = Math.max(minRows, 1) * 25 + 40;
  const optionsRef = useRef(options);
  const onPlaceholderClickRef = useRef(onPlaceholderClick);
  const lastEmittedValueRef = useRef(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fallbackMenuOpen, setFallbackMenuOpen] = useState(false);
  const [fallbackMenuStyle, setFallbackMenuStyle] = useState<CSSProperties | undefined>();
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackSelectedIndex, setFallbackSelectedIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState<MentionPreviewImage | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const resolvedEditorClassName = ['mention-rich-textarea-editor', editorClassName].filter(Boolean).join(' ');
  const fallbackOptions = useMemo(() => filterMentionOptions(options, fallbackQuery), [fallbackQuery, options]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    onPlaceholderClickRef.current = onPlaceholderClick;
  }, [onPlaceholderClick]);

  useEffect(() => {
    setFallbackSelectedIndex(0);
  }, [fallbackMenuOpen, fallbackOptions]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const handlePreview = (event: Event) => {
      const detail = (event as CustomEvent<MentionPreviewImage>).detail;
      if (detail?.src) {
        setPreviewImage(detail);
        setPreviewVisible(true);
      }
    };
    const handlePlaceholder = (event: Event) => {
      const detail = (event as CustomEvent<MentionPlaceholderRequest>).detail;
      const option = optionsRef.current.find((item) => item.token === detail?.token);
      if (option?.isPlaceholder) {
        onPlaceholderClickRef.current?.(option);
      }
    };
    container.addEventListener(mentionPreviewEventName, handlePreview);
    container.addEventListener(mentionPlaceholderEventName, handlePlaceholder);
    return () => {
      container.removeEventListener(mentionPreviewEventName, handlePreview);
      container.removeEventListener(mentionPlaceholderEventName, handlePlaceholder);
    };
  }, []);

  const insertMention = (item: MentionRichTextareaOption) => {
    if (!editor) {
      return;
    }
    const activeRange = getActiveFallbackMentionRange(editor);
    const chain = editor.chain().focus();
    if (activeRange) {
      chain.deleteRange({ from: activeRange.from, to: activeRange.to });
    }
    chain.insertContent([mentionContentNode(item)]).run();
    setFallbackMenuOpen(false);
    setFallbackQuery('');
  };

  const handleContainerMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || !editor) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest('.mention-rich-textarea-menu')) {
      return;
    }
    if (target === containerRef.current || target.classList.contains('mention-rich-textarea-editor')) {
      editor.commands.focus('end');
    }
  };

  const handleFallbackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !fallbackMentionMenu) {
      return;
    }
    if (event.key === '@') {
      setFallbackMenuOpen(true);
      return;
    }
    if (!fallbackMenuOpen) {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && onSubmit) {
        event.preventDefault();
        onSubmit();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setFallbackMenuOpen(false);
      return;
    }
    if (!fallbackOptions.length) {
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFallbackSelectedIndex((index) => (index + fallbackOptions.length - 1) % fallbackOptions.length);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFallbackSelectedIndex((index) => (index + 1) % fallbackOptions.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      insertMention(fallbackOptions[fallbackSelectedIndex] || fallbackOptions[0]);
    }
  };

  const syncFallbackMenuVisibility = (currentEditor: Editor) => {
    if (!fallbackMentionMenu || disabled) {
      setFallbackMenuOpen(false);
      setFallbackQuery('');
      return;
    }
    const activeRange = getActiveFallbackMentionRange(currentEditor);
    if (!activeRange) {
      setFallbackMenuOpen(false);
      setFallbackQuery('');
      return;
    }
    const containerRect = containerRef.current?.getBoundingClientRect();
    const cursorRect = currentEditor.view.coordsAtPos(activeRange.to);
    setFallbackQuery(activeRange.query);
    setFallbackMenuStyle(containerRect ? {
      left: Math.max(0, Math.min(cursorRect.left - containerRect.left, containerRect.width - 248)),
      top: cursorRect.bottom - containerRect.top + 6,
    } : undefined);
    setFallbackMenuOpen(true);
  };

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
      Placeholder.configure({
        placeholder: () => placeholder ?? '',
      }),
      ReferenceMention.configure({
        deleteTriggerWithBackspace: true,
        HTMLAttributes: {
          class: 'mention-rich-textarea-chip',
        },
        renderHTML({ node, options: mentionOptions }) {
          const previewUrl = String(node.attrs.previewUrl ?? '');
          const mimeType = String(node.attrs.mimeType ?? '');
          const isPlaceholder = node.attrs.isPlaceholder === true;
          const label = String(node.attrs.label ?? node.attrs.id ?? '').replace(/^@/, '');
          const mentionInfo = {
            label,
            mimeType,
            token: String(node.attrs.id ?? ''),
          };
          const fallbackIcon = mentionFallbackIcon(mentionInfo);
          const shouldShowPreview = Boolean(!isPlaceholder && previewUrl && !isAudioMention(mentionInfo));
          const kind = mentionKind(mentionInfo);
          const children: MentionDomChild[] = shouldShowPreview
            ? [
                ['img', { alt: label, src: previewUrl }],
                ['b', {}, label],
              ]
            : [
                ['span', { class: 'mention-rich-textarea-chip-icon' }, isPlaceholder ? '+' : fallbackIcon],
                ['b', {}, isPlaceholder ? String(node.attrs.id ?? '') : label],
              ];
          return [
            'span',
            mergeAttributes(mentionOptions.HTMLAttributes, {
              'data-attachment-id': node.attrs.attachmentId,
              'data-placeholder': isPlaceholder ? 'true' : undefined,
              'data-mention-kind': kind,
              'data-mime-type': mimeType || undefined,
              'data-preview-url': previewUrl || undefined,
              'data-token': node.attrs.id,
              class: `mention-rich-textarea-chip${isPlaceholder ? ' is-placeholder' : ''}`,
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
          container: suggestionContainer,
          floatingUi: { strategy: 'fixed' },
          items: ({ query }) => {
            if (fallbackMentionMenu) {
              return [];
            }
            return filterMentionOptions(optionsRef.current, query);
          },
          command: ({ editor, range, props }) => {
            const item = props as unknown as MentionSuggestionItem;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [mentionContentNode(item)])
              .run();
          },
          render: () => {
            if (fallbackMentionMenu) {
              return {
                onStart: () => {},
                onUpdate: () => {},
                onKeyDown: () => false,
                onExit: () => {},
              };
            }
            let component: ReactRenderer<MentionListRef, MentionListProps> | null = null;
            let unmount: (() => void) | null = null;

            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, {
                  editor: props.editor,
                  props: {
                    ...props,
                    emptyText,
                    menuDescription,
                    menuTitle,
                  },
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
  }, [emptyText, fallbackMentionMenu, menuDescription, menuTitle, placeholder, suggestionContainer]);

  const editor = useEditor({
    content: plainTextToDoc(value, options),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: resolvedEditorClassName,
        'data-placeholder': placeholder ?? '',
        style: `min-height: ${minHeight}px`,
      },
    },
    extensions,
    immediatelyRender: false,
    onSelectionUpdate: ({ editor: currentEditor }) => {
      syncFallbackMenuVisibility(currentEditor);
    },
    onUpdate: ({ editor: currentEditor }) => {
      syncFallbackMenuVisibility(currentEditor);
      const nextValue = nodeToPlainText(currentEditor.getJSON());
      lastEmittedValueRef.current = nextValue;
      onChange(nextValue);
    },
  });

  useImperativeHandle(ref, () => ({
    focus() {
      editor?.commands.focus('end');
    },
  }), [editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const currentDoc = editor.getJSON();
    const currentValue = nodeToPlainText(currentDoc);
    if (currentValue !== value) {
      if (lastEmittedValueRef.current === value) {
        return;
      }
      editor.commands.setContent(plainTextToDoc(value, options), { emitUpdate: false });
      lastEmittedValueRef.current = value;
      return;
    }

    const normalizedDoc = normalizeMentionDoc(currentDoc, options);
    if (!normalizedDoc) {
      return;
    }
    const normalizedValue = nodeToPlainText(normalizedDoc);
    if (!isJsonContentEqual(normalizedDoc, currentDoc)) {
      editor.commands.setContent(normalizedDoc, { emitUpdate: false });
    }
    if (normalizedValue !== currentValue) {
      onChange(normalizedValue);
    }
  }, [editor, onChange, options, value]);

  return (
    <div
      className={[
        'mention-rich-textarea',
        disabled ? 'is-disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      onMouseDown={handleContainerMouseDown}
      onKeyDownCapture={handleFallbackKeyDown}
      ref={containerRef}
      style={{ minHeight }}
    >
      <EditorContent editor={editor} />
      {fallbackMentionMenu && fallbackMenuOpen ? (
        <div className="mention-rich-textarea-fallback-menu" style={fallbackMenuStyle}>
          <div className="mention-rich-textarea-menu">
            <div className="mention-rich-textarea-menu__header">
              <strong>{menuTitle}</strong>
              <span>{menuDescription}</span>
            </div>
            {fallbackOptions.length ? fallbackOptions.map((item, index) => (
              <button
                className={index === fallbackSelectedIndex ? 'is-selected' : ''}
                key={item.token}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(item);
                }}
                type="button"
              >
                {item.previewUrl && !isAudioMention(item) ? (
                  <img alt={item.label} src={item.previewUrl} />
                ) : (
                  <span data-mention-kind={mentionKind(item)}>{mentionOptionIcon(item)}</span>
                )}
                <span className="mention-rich-textarea-option__body">
                  <strong>{mentionOptionTitle(item)}</strong>
                  <small>{mentionOptionDescription(item)}</small>
                </span>
              </button>
            )) : <div className="mention-rich-textarea-menu--empty">{emptyText}</div>}
          </div>
        </div>
      ) : null}
      <Image
        alt={previewImage?.alt || '图片预览'}
        preview={{
          open: previewVisible,
          onOpenChange: (open) => {
            setPreviewVisible(open);
          },
        }}
        src={previewImage?.src}
        style={{ display: 'none' }}
        styles={{ root: { display: 'none' } }}
      />
    </div>
  );
});
