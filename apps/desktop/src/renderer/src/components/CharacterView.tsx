import { useCallback, useEffect, useState } from 'react';
import {
    checkOoc,
    compareVoices,
    createCharacterCard,
    extractDialogueForCharacter,
    parseCharacterMarkdown,
    renderCharacterMarkdown,
    type CharacterCard,
    type OocFinding,
    type SimilarVoicePair,
    type SpeechProfile,
} from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 把顿号/逗号/空格分隔的字符串拆成数组 */
function splitList(value: string): string[] {
    return value
        .split(/[、,，\s]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * 人设卡视图
 * 每张卡存成 Markdown（人读）+ 内嵌 JSON 块（程序读）
 */
export default function CharacterView() {
    const book = useAppStore((state) => state.book);
    const content = useAppStore((state) => state.content);
    const reloadBookData = useAppStore((state) => state.reloadBookData);
    const pushToast = useAppStore((state) => state.pushToast);

    const [names, setNames] = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [card, setCard] = useState<CharacterCard | null>(null);
    const [newName, setNewName] = useState('');
    const [dirty, setDirty] = useState(false);

    const [extractedCount, setExtractedCount] = useState(0);
    const [oocFindings, setOocFindings] = useState<OocFinding[]>([]);
    const [compareWith, setCompareWith] = useState('');
    const [voicePair, setVoicePair] = useState<SimilarVoicePair | null>(null);

    const [evoChapter, setEvoChapter] = useState('');
    const [evoReason, setEvoReason] = useState('');
    const [evoChange, setEvoChange] = useState('');

    /**
     * 重新扫人设目录
     */
    const refreshNames = useCallback(async (): Promise<string[]> => {
        if (!book) {
            return [];
        }
        try {
            const files = await window.api.file.list(book.id, '人设', '.md');
            const list = files.map((file) => file.replace(/\.md$/, ''));
            setNames(list);
            return list;
        } catch (error) {
            pushToast('error', errorMessage(error));
            return [];
        }
    }, [book, pushToast]);

    // 打开书时扫一次
    useEffect(() => {
        void (async () => {
            const list = await refreshNames();
            if (list.length > 0) {
                setSelected((current) => current ?? list[0]);
            }
        })();
    }, [refreshNames]);

    // 选中角色时读卡片
    useEffect(() => {
        if (!book || !selected) {
            setCard(null);
            return;
        }
        void (async () => {
            try {
                const text = await window.api.file.readText(book.id, `人设/${selected}.md`);
                const parsed = parseCharacterMarkdown(text);
                setCard(parsed ?? createCharacterCard(selected));
                setDirty(false);
                setOocFindings([]);
                setVoicePair(null);
                setExtractedCount(0);
            } catch (error) {
                pushToast('error', errorMessage(error));
            }
        })();
    }, [book, selected, pushToast]);

    /**
     * 改顶层字段
     * @param patch 部分字段
     */
    function patchCard(patch: Partial<CharacterCard>): void {
        setCard((previous) => (previous ? { ...previous, ...patch } : previous));
        setDirty(true);
    }

    /**
     * 改说话方式
     * @param patch 部分字段
     */
    function patchSpeech(patch: Partial<SpeechProfile>): void {
        setCard((previous) =>
            previous ? { ...previous, speech: { ...previous.speech, ...patch } } : previous,
        );
        setDirty(true);
    }

    /**
     * 保存当前卡片
     */
    async function handleSave(): Promise<void> {
        if (!book || !card) {
            return;
        }
        try {
            await window.api.file.writeText(
                book.id,
                `人设/${card.name}.md`,
                renderCharacterMarkdown(card),
            );
            setDirty(false);
            await refreshNames();
            await reloadBookData();
            pushToast('success', `已保存 ${card.name}`);
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 新建一张卡
     */
    async function handleCreate(): Promise<void> {
        const name = newName.trim();
        if (!book || name.length === 0) {
            return;
        }
        if (names.includes(name)) {
            pushToast('info', `已经有「${name}」了`);
            setSelected(name);
            setNewName('');
            return;
        }
        try {
            const fresh = createCharacterCard(name);
            await window.api.file.writeText(book.id, `人设/${name}.md`, renderCharacterMarkdown(fresh));
            await refreshNames();
            setSelected(name);
            setNewName('');
            await reloadBookData();
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * OOC 检测：用当前章里提取到的台词
     */
    function runOocCheck(): void {
        if (!card) {
            return;
        }
        const lines = extractDialogueForCharacter(content, card.name);
        setExtractedCount(lines.length);
        setOocFindings(checkOoc(card, lines));
    }

    /**
     * 千人一腔检测：和另一个角色的台词比
     */
    function runVoiceCompare(): void {
        if (!card || compareWith.length === 0) {
            return;
        }
        const linesA = extractDialogueForCharacter(content, card.name);
        const linesB = extractDialogueForCharacter(content, compareWith);
        setVoicePair(
            compareVoices({ name: card.name, lines: linesA }, { name: compareWith, lines: linesB }),
        );
    }

    /**
     * 追加一条语用演变
     */
    function addEvolution(): void {
        if (!card) {
            return;
        }
        const chapter = Number.parseInt(evoChapter, 10);
        if (!Number.isFinite(chapter) || chapter <= 0 || evoChange.trim().length === 0) {
            return;
        }
        patchCard({
            evolutions: [
                ...card.evolutions,
                {
                    chapter,
                    reason: evoReason.trim() || '未说明',
                    change: evoChange.trim(),
                },
            ],
        });
        setEvoChapter('');
        setEvoReason('');
        setEvoChange('');
    }

    if (!book) {
        return (
            <main className="flex flex-1 items-center justify-center text-sm text-ink-500">
                先打开一本书
            </main>
        );
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-medium text-ink-100">人设</h2>
                    <span className="text-[13px] text-ink-500">{names.length} 个角色</span>
                    {dirty && <span className="text-[13px] text-amber-500">未保存</span>}
                </div>
                <button
                    type="button"
                    className={dirty ? 'btn-primary text-[13px]' : 'btn-outline text-[13px]'}
                    onClick={() => void handleSave()}
                    disabled={!card}
                >
                    保存人设卡
                </button>
            </div>

            <div className="flex min-h-0 flex-1">
                {/* 角色列表 */}
                <aside className="w-44 shrink-0 border-r border-ink-800 p-2">
                    <div className="mb-2 flex gap-1">
                        <input
                            className="field h-7 text-[13px]"
                            placeholder="新角色名"
                            value={newName}
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleCreate();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="btn-outline h-7 shrink-0 px-2 text-[13px]"
                            onClick={() => void handleCreate()}
                        >
                            +
                        </button>
                    </div>
                    <ul className="space-y-0.5">
                        {names.map((name) => (
                            <li key={name}>
                                <button
                                    type="button"
                                    onClick={() => setSelected(name)}
                                    className={`w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] ${
                                        selected === name
                                            ? 'bg-jade-500/15 text-jade-400'
                                            : 'text-ink-300 hover:bg-ink-800'
                                    }`}
                                >
                                    {name}
                                </button>
                            </li>
                        ))}
                        {names.length === 0 && (
                            <li className="px-2 py-3 text-[13px] leading-relaxed text-ink-500">
                                还没有角色。先在上面加一个。
                            </li>
                        )}
                    </ul>
                </aside>

                {/* 表单 */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {!card ? (
                        <p className="text-[13px] text-ink-500">左边选一个角色，或者新建一个。</p>
                    ) : (
                        <div className="mx-auto max-w-3xl space-y-4">
                            <div className="flex items-baseline gap-2">
                                <h3 className="text-base font-medium text-ink-100">{card.name}</h3>
                                <span className="text-[13px] text-ink-600">
                                    文件名固定为 人设/{card.name}.md
                                </span>
                            </div>

                            <div>
                                <label className="label" htmlFor="cc-identity">
                                    身份与立场（和主角什么关系、利益站在哪边）
                                </label>
                                <textarea
                                    id="cc-identity"
                                    className="field h-20 resize-none text-[14px]"
                                    value={card.identity}
                                    onChange={(event) => patchCard({ identity: event.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="label" htmlFor="cc-personality">
                                        性格底色（一行一个，2-3 个特质）
                                    </label>
                                    <textarea
                                        id="cc-personality"
                                        className="field h-24 resize-none text-[14px]"
                                        value={card.personality.join('\n')}
                                        onChange={(event) =>
                                            patchCard({
                                                personality: event.target.value
                                                    .split('\n')
                                                    .map((line) => line.trim())
                                                    .filter((line) => line.length > 0),
                                            })
                                        }
                                    />
                                </div>
                                <div>
                                    <label className="label" htmlFor="cc-flaw">
                                        缺陷（1 个，制造麻烦的那个）
                                    </label>
                                    <input
                                        id="cc-flaw"
                                        className="field text-[14px]"
                                        value={card.flaw}
                                        onChange={(event) => patchCard({ flaw: event.target.value })}
                                    />
                                    <label className="label mt-3" htmlFor="cc-normal">
                                        情绪基线：平时什么状态
                                    </label>
                                    <input
                                        id="cc-normal"
                                        className="field text-[14px]"
                                        value={card.emotionBaseline.normal}
                                        onChange={(event) =>
                                            patchCard({
                                                emotionBaseline: {
                                                    ...card.emotionBaseline,
                                                    normal: event.target.value,
                                                },
                                            })
                                        }
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="label" htmlFor="cc-triggers">
                                    被什么激怒（顿号分隔）
                                </label>
                                <input
                                    id="cc-triggers"
                                    className="field text-[14px]"
                                    placeholder="例如：被人叫小名、别人动他的刀"
                                    value={card.emotionBaseline.triggers.join('、')}
                                    onChange={(event) =>
                                        patchCard({
                                            emotionBaseline: {
                                                ...card.emotionBaseline,
                                                triggers: splitList(event.target.value),
                                            },
                                        })
                                    }
                                />
                            </div>

                            {/* 说话方式 */}
                            <section className="rounded-md border border-ink-800 bg-ink-900 p-3">
                                <h4 className="mb-2 text-[13px] font-medium text-ink-300">说话方式</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="label" htmlFor="cc-length">
                                            句长习惯
                                        </label>
                                        <select
                                            id="cc-length"
                                            className="field text-[14px]"
                                            value={card.speech.sentenceLength}
                                            onChange={(event) =>
                                                patchSpeech({
                                                    sentenceLength: event.target.value as SpeechProfile['sentenceLength'],
                                                })
                                            }
                                        >
                                            <option value="short">短句，三五字一顿</option>
                                            <option value="medium">中等，十几二十字</option>
                                            <option value="long">长句，一口气说完</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="label" htmlFor="cc-address">
                                            对主角的称呼（顿号分隔，可写多个阶段）
                                        </label>
                                        <input
                                            id="cc-address"
                                            className="field text-[14px]"
                                            value={card.speech.addressToProtagonist.join('、')}
                                            onChange={(event) =>
                                                patchSpeech({
                                                    addressToProtagonist: splitList(event.target.value),
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="label" htmlFor="cc-catch">
                                            口头禅（顿号分隔）
                                        </label>
                                        <input
                                            id="cc-catch"
                                            className="field text-[14px]"
                                            value={card.speech.catchphrases.join('、')}
                                            onChange={(event) =>
                                                patchSpeech({ catchphrases: splitList(event.target.value) })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="label" htmlFor="cc-forbidden">
                                            语言禁区（这个角色绝不会说的词）
                                        </label>
                                        <input
                                            id="cc-forbidden"
                                            className="field text-[14px]"
                                            value={card.speech.forbiddenWords.join('、')}
                                            onChange={(event) =>
                                                patchSpeech({ forbiddenWords: splitList(event.target.value) })
                                            }
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 语用演变 */}
                            <section>
                                <h4 className="mb-1.5 text-[13px] font-medium text-ink-300">语用演变</h4>
                                {card.evolutions.length === 0 ? (
                                    <p className="text-[13px] text-ink-500">
                                        还没有记录。角色说话方式变了就来记一条，避免后面写崩。
                                    </p>
                                ) : (
                                    <ul className="space-y-1">
                                        {card.evolutions.map((evolution, index) => (
                                            <li
                                                key={`${evolution.chapter}-${index}`}
                                                className="rounded border border-ink-800 bg-ink-900 px-2 py-1.5 text-[13px] text-ink-300"
                                            >
                                                第 {evolution.chapter} 章：因为{evolution.reason}，
                                                {evolution.change}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <div className="mt-2 flex items-center gap-1">
                                    <input
                                        className="field h-7 w-20 text-[13px]"
                                        placeholder="章号"
                                        value={evoChapter}
                                        onChange={(event) => setEvoChapter(event.target.value)}
                                    />
                                    <input
                                        className="field h-7 w-32 text-[13px]"
                                        placeholder="因为什么"
                                        value={evoReason}
                                        onChange={(event) => setEvoReason(event.target.value)}
                                    />
                                    <input
                                        className="field h-7 flex-1 text-[13px]"
                                        placeholder="改成了什么"
                                        value={evoChange}
                                        onChange={(event) => setEvoChange(event.target.value)}
                                    />
                                    <button
                                        type="button"
                                        className="btn-outline h-7 shrink-0 text-[13px]"
                                        onClick={addEvolution}
                                    >
                                        加一条
                                    </button>
                                </div>
                            </section>

                            {/* 检测 */}
                            <section className="rounded-md border border-ink-800 bg-ink-900 p-3">
                                <h4 className="mb-2 text-[13px] font-medium text-ink-300">
                                    检测（用当前章正文）
                                </h4>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button type="button" className="btn-outline text-[13px]" onClick={runOocCheck}>
                                        OOC 检测
                                    </button>
                                    <select
                                        className="field h-7 w-32 text-[13px]"
                                        value={compareWith}
                                        onChange={(event) => setCompareWith(event.target.value)}
                                    >
                                        <option value="">选对比角色</option>
                                        {names
                                            .filter((name) => name !== card.name)
                                            .map((name) => (
                                                <option key={name} value={name}>
                                                    {name}
                                                </option>
                                            ))}
                                    </select>
                                    <button
                                        type="button"
                                        className="btn-outline text-[13px]"
                                        onClick={runVoiceCompare}
                                        disabled={compareWith.length === 0}
                                    >
                                        千人一腔检测
                                    </button>
                                    <span className="text-[13px] text-ink-600">
                                        台词是按名字附近 40 字的引号内容启发式提取的，可能串，结果只作参考
                                    </span>
                                </div>

                                {extractedCount > 0 && (
                                    <p className="mt-2 text-[13px] text-ink-500">
                                        本章提取到 {extractedCount} 句「{card.name}」的台词
                                    </p>
                                )}

                                {oocFindings.length > 0 && (
                                    <ul className="mt-2 space-y-1">
                                        {oocFindings.map((finding, index) => (
                                            <li
                                                key={`${finding.line}-${index}`}
                                                className={`text-[13px] ${
                                                    finding.severity === 'error'
                                                        ? 'text-red-300'
                                                        : finding.severity === 'warn'
                                                          ? 'text-amber-400'
                                                          : 'text-ink-400'
                                                }`}
                                            >
                                                · 「{finding.line.slice(0, 24)}…」{finding.reason}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {oocFindings.length === 0 && extractedCount > 0 && (
                                    <p className="mt-2 text-[13px] text-jade-400">没查出偏离。</p>
                                )}

                                {voicePair && (
                                    <p
                                        className={`mt-2 text-[13px] ${
                                            voicePair.similarity >= 0.75 ? 'text-amber-400' : 'text-jade-400'
                                        }`}
                                    >
                                        {voicePair.message}
                                    </p>
                                )}
                            </section>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
