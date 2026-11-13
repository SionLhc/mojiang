import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 一张素材卡 */
export interface MaterialCard {
    id: string;
    title: string;
    content: string;
    tags: string[];
    updatedAt: string;
}

/** 素材文件结构 */
interface MaterialFile {
    cards: MaterialCard[];
}

/**
 * 素材卡片盒
 * 灵感、摘录、台词都往这里扔，打标签管起来，要用时一键插进正文
 * 数据存在书里的 素材.json，跟着书走
 */
export default function MaterialsView() {
    const book = useAppStore((state) => state.book);
    const appendToChapter = useAppStore((state) => state.appendToChapter);
    const pushToast = useAppStore((state) => state.pushToast);

    const [cards, setCards] = useState<MaterialCard[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tagFilter, setTagFilter] = useState('');
    const [titleInput, setTitleInput] = useState('');
    const [contentInput, setContentInput] = useState('');
    const [tagsInput, setTagsInput] = useState('');

    /**
     * 读素材文件
     */
    const reload = useCallback(async () => {
        if (!book) {
            return;
        }
        try {
            const file = await window.api.file.readJson<MaterialFile>(book.id, '素材.json', { cards: [] });
            setCards(Array.isArray(file.cards) ? file.cards : []);
        } catch (error) {
            pushToast('error', `读素材失败：${errorMessage(error)}`);
        }
    }, [book, pushToast]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /** 全部标签，去重排序，供筛选条用 */
    const allTags = useMemo(() => {
        const set = new Set<string>();
        for (const card of cards) {
            for (const tag of card.tags) {
                set.add(tag);
            }
        }
        return [...set].sort();
    }, [cards]);

    /** 按标签筛选后的卡片 */
    const visibleCards = useMemo(() => {
        if (tagFilter.length === 0) {
            return cards;
        }
        return cards.filter((card) => card.tags.includes(tagFilter));
    }, [cards, tagFilter]);

    /**
     * 选中一张卡，把内容填进编辑区
     * @param card 素材卡
     */
    function selectCard(card: MaterialCard): void {
        setSelectedId(card.id);
        setTitleInput(card.title);
        setContentInput(card.content);
        setTagsInput(card.tags.join('、'));
    }

    /**
     * 清空编辑区，准备新建
     */
    function startNew(): void {
        setSelectedId(null);
        setTitleInput('');
        setContentInput('');
        setTagsInput('');
    }

    /**
     * 把编辑区存成一张卡（有选中就更新，没有就新建）
     */
    async function saveCard(): Promise<void> {
        if (!book) {
            return;
        }
        const title = titleInput.trim();
        if (title.length === 0) {
            pushToast('error', '给素材起个名字吧');
            return;
        }
        const tags = tagsInput
            .split(/[、,，\s]+/)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        const now = new Date().toISOString();
        const next: MaterialCard[] = selectedId
            ? cards.map((card) =>
                  card.id === selectedId
                      ? { ...card, title, content: contentInput, tags, updatedAt: now }
                      : card,
              )
            : [...cards, { id: crypto.randomUUID(), title, content: contentInput, tags, updatedAt: now }];
        try {
            await window.api.file.writeJson(book.id, '素材.json', { cards: next } satisfies MaterialFile);
            setCards(next);
            pushToast('success', '素材已保存');
        } catch (error) {
            pushToast('error', `保存素材失败：${errorMessage(error)}`);
        }
    }

    /**
     * 删掉当前选中的卡
     */
    async function removeCard(): Promise<void> {
        if (!book || !selectedId) {
            return;
        }
        const next = cards.filter((card) => card.id !== selectedId);
        try {
            await window.api.file.writeJson(book.id, '素材.json', { cards: next } satisfies MaterialFile);
            setCards(next);
            startNew();
            pushToast('success', '素材已删除');
        } catch (error) {
            pushToast('error', `删除素材失败：${errorMessage(error)}`);
        }
    }

    return (
        <main className="flex min-h-0 flex-1 overflow-hidden bg-ink-950">
            {/* 左：卡片列表 */}
            <div className="flex w-64 shrink-0 flex-col border-r border-ink-800">
                <div className="flex items-center justify-between px-3 py-2.5">
                    <p className="text-sm font-medium text-ink-200">素材卡片</p>
                    <button type="button" className="btn-outline h-7 text-[13px]" onClick={startNew}>
                        + 新建
                    </button>
                </div>
                {/* 标签筛选 */}
                {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-3 pb-2">
                        <button
                            type="button"
                            className={`rounded px-1.5 py-0.5 text-[12px] ${
                                tagFilter === '' ? 'bg-jade-600/20 text-jade-400' : 'bg-ink-800 text-ink-400'
                            }`}
                            onClick={() => setTagFilter('')}
                        >
                            全部
                        </button>
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                className={`rounded px-1.5 py-0.5 text-[12px] ${
                                    tagFilter === tag ? 'bg-jade-600/20 text-jade-400' : 'bg-ink-800 text-ink-400'
                                }`}
                                onClick={() => setTagFilter(tag)}
                            >
                                #{tag}
                            </button>
                        ))}
                    </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    {visibleCards.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[13px] leading-relaxed text-ink-600">
                            还没有素材。点「+ 新建」记一条灵感、摘录或台词。
                        </p>
                    ) : (
                        visibleCards.map((card) => (
                            <button
                                key={card.id}
                                type="button"
                                onClick={() => selectCard(card)}
                                className={`mb-1 w-full rounded px-2 py-1.5 text-left transition-colors ${
                                    selectedId === card.id ? 'bg-ink-800' : 'hover:bg-ink-900'
                                }`}
                            >
                                <p className="truncate text-[13px] text-ink-100">{card.title}</p>
                                <p className="mt-0.5 truncate text-[12px] text-ink-500">
                                    {card.tags.map((tag) => `#${tag}`).join(' ') || card.content.slice(0, 20)}
                                </p>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* 右：编辑区 */}
            <div className="flex min-w-0 flex-1 flex-col px-6 py-5">
                <div className="mx-auto flex h-full w-full max-w-prose flex-col gap-3">
                    <input
                        className="field h-9 text-sm"
                        placeholder="素材名字，如「第三章要用的台词」"
                        value={titleInput}
                        onChange={(event) => setTitleInput(event.target.value)}
                    />
                    <input
                        className="field h-8 text-[13px]"
                        placeholder="标签，用顿号隔开，如「灵感、场景」"
                        value={tagsInput}
                        onChange={(event) => setTagsInput(event.target.value)}
                    />
                    <textarea
                        className="field min-h-0 flex-1 resize-none p-3 text-sm leading-relaxed"
                        placeholder="素材内容，随便写，Markdown 也认"
                        value={contentInput}
                        onChange={(event) => setContentInput(event.target.value)}
                    />
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" className="btn-primary h-8 text-[13px]" onClick={() => void saveCard()}>
                            保存素材
                        </button>
                        <button
                            type="button"
                            className="btn-outline h-8 text-[13px]"
                            onClick={() => void appendToChapter(contentInput)}
                            disabled={contentInput.trim().length === 0}
                            title="追加到当前打开的文档末尾"
                        >
                            插入正文
                        </button>
                        {selectedId && (
                            <button type="button" className="btn-ghost h-8 text-[13px] text-red-400" onClick={() => void removeCard()}>
                                删除
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
