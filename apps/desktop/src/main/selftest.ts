/**
 * 自检脚本
 * 只在 --smoke 时执行，用来确认核心算法在 Electron 主进程里真的跑得通。
 * 生产环境不会调用这个文件里的任何函数。
 */

import { rmSync } from 'fs';
import { join } from 'path';
import {
    answerQuestion,
    applyPatch,
    assembleWritingPackage,
    buildChapterReport,
    buildLedgerPath,
    canGenerateOutline,
    checkOoc,
    compareVoices,
    composeSystemPrompt,
    computeBaseline,
    createPlotNode,
    parsePlotDiagnosis,
    serializePlotForPrompt,
    computeTextMetrics,
    createCharacterCard,
    createForeshadow,
    createOutlineState,
    detectLedgerConflicts,
    diagnoseGoldenChapter,
    diffLines,
    extractDialogueForCharacter,
    getProjectFeatures,
    lastTouchedChapter,
    parseCharacterMarkdown,
    parseFrontMatter,
    parseLedgerMarks,
    parseRankingText,
    renderCharacterMarkdown,
    renderMarketReport,
    renderMarkdownToHtml,
    renderOutlineMarkdown,
    renderWritingPackagePrompt,
    runLexiconCheck,
    scanForeshadow,
    summarizeDiff,
    touchForeshadow,
    writeTags,
    type LedgerFile,
} from '@mojiang/core';
import { splitProseBlocks } from '@mojiang/core';
import { writeJsonFile, writeTextFile } from './services/content';
import { splitChapters } from './services/import';
import { buildDocx, buildEpub, buildPlainText, markdownToBlocks } from './services/export-format';
import { createBook } from './services/library';
import { buildWritingPackage } from './services/package-builder';
import { getLibraryDir } from './services/paths';

/** 自检用的样例正文，故意写得很"差"，把规则都触发一遍 */
const SAMPLE_TEXT = [
    '# 第一章 收徒',
    '',
    '天刚亮，林胜就醒了。他顿时觉得今天不一样，似乎有什么东西在等他……',
    '',
    '"你来了。"田峰说，"我等你很久了，从你还没出生就在等。你父亲欠我的东西，你母亲欠我的东西，你自己欠我的东西，今天都要一样一样还清，少一样都不行。你知道你父亲当年做了什么吗？你知道那座井下面埋着什么吗？你什么都不知道，就敢一个人来，你听明白了吗？"',
    '',
    '他心中一动，不由自主地想起了昨晚的事。',
    '',
    '不由自主地想起了那口井。',
    '',
    '不由自主地想起了井底的声音。',
    '',
    '这一刻，他终于明白，命运从来不会给人选择的机会。',
    '',
    '他怒火中烧，猛地站起身。转身。抬头。低头。伸手。握紧。',
    '',
    '[[账本|林胜|realm|开八门第二门]]',
    '',
].join('\n');

/** 自检结果 */
export interface SelfTestResult {
    charCount: number;
    lexiconScore: number;
    hitCategories: string[];
    repeatHit: boolean;
    rhythmHit: boolean;
    dialogueHit: boolean;
    metrics: Record<string, number>;
    baselineScore: number;
    ledgerMarks: number;
    ledgerConflicts: number;
    goldenScore: number;
    outlineGateOk: boolean;
    outlineLength: number;
    packageDegraded: number;
    /** 人设卡 Markdown 往返是否一致 */
    characterRoundTrip: boolean;
    /** 从正文里提取到的田峰台词数 */
    extractedLines: number;
    /** OOC 检出条数 */
    oocHits: number;
    /** 千人一腔相似度 */
    voiceSimilarity: number;
    /** 伏笔超期告警数 */
    foreshadowAlerts: number;
    /** 账本 patch 是否真的落到树上 */
    ledgerPatched: boolean;
    /** 行级 diff 统计是否正确 */
    diffOk: boolean;
    /** 三种导出格式的结构是否合法 */
    exportOk: boolean;
    /** 导出的 docx / epub 体积，用来确认不是空包 */
    exportSizes: { docx: number; epub: number; txt: number };
    /** 榜单文本解析与报告生成是否正常 */
    marketOk: boolean;
    /** 项目类型能力矩阵与 frontmatter 标签是否正常 */
    workspaceOk: boolean;
    /** Markdown 对照预览的渲染与转义是否正常 */
    markdownOk: boolean;
    /** 作者指令是否真的拼进了系统提示 */
    promptOk: boolean;
    /** 剧情图的序列化与 AI 输出校验是否正常 */
    plotOk: boolean;
    /** 稿件导入的分章是否正确 */
    importOk: boolean;
    /** 分章结果，便于排查 */
    importChapters: number;
    /** AI 回复的段落切分是否正确 */
    blocksOk: boolean;
}

/** 开写包往返测试的结果 */
export interface PackageSelfTestResult {
    ok: boolean;
    itemCount: number;
    readyCount: number;
    degradedLabels: string[];
    promptLength: number;
}

/**
 * 开写包往返测试
 * 在书库里真的建一本临时书，把各类文件写进去，组装一次，然后删干净。
 * 这样能验证"读文件 → 组装"的整条链路，而不是只验证纯函数。
 * @returns 结果摘要
 */
export async function runPackageSelfTest(): Promise<PackageSelfTestResult> {
    const tempName = '__selftest__';
    const tempDir = join(getLibraryDir(), tempName);
    // 上一次如果异常退出，先把残留清掉
    rmSync(tempDir, { recursive: true, force: true });

    try {
        const meta = createBook({ title: tempName, genre: '测试', chapterWordTarget: 3000 });
        const bookId = meta.id;

        await writeTextFile(
            bookId,
            '正文/001.md',
            '# 第一章\n\n林胜走进屋，田峰坐在窗边。\n\n"你来了。"田峰说。\n\n林胜没有回答。',
        );
        await writeTextFile(bookId, '正文/002.md', '# 第二章\n\n林胜把刀放在桌上。');
        await writeTextFile(bookId, '细纲/002.md', '- 林胜逼问田峰\n- 田峰说出井的位置');
        await writeTextFile(bookId, '锚段.md', '林胜走进屋，田峰坐在窗边。屋里没有点灯。');
        await writeTextFile(
            bookId,
            '人设/林胜.md',
            renderCharacterMarkdown({
                ...createCharacterCard('林胜'),
                identity: '主角，柴房的杂役',
                personality: ['沉默', '记仇'],
                flaw: '不敢求人',
            }),
        );
        await writeJsonFile(bookId, '账本.json', {
            tree: {
                林胜: { realm: '开八门第一门', 时间: '入夜', 地点: '柴房' },
                田峰: { 状态: '受伤' },
            },
            history: [],
        });
        await writeJsonFile(bookId, '伏笔.json', {
            items: [createForeshadow('井底的声音', 1, 5)],
        });
        await writeJsonFile(bookId, '基线.json', {
            sampleChapters: ['001'],
            dimensions: {
                syntaxComplexity: { mu: 14, sigma: 2, sampleCount: 1 },
                modifierDensity: { mu: 40, sigma: 5, sampleCount: 1 },
                abstraction: { mu: 8, sigma: 2, sampleCount: 1 },
                actionDensity: { mu: 25, sigma: 4, sampleCount: 1 },
                uncertainty: { mu: 4, sigma: 1, sampleCount: 1 },
                blankSpace: { mu: 18, sigma: 3, sampleCount: 1 },
            },
            updatedAt: new Date().toISOString(),
        });

        const pack = await buildWritingPackage(bookId, '002');
        const readyCount = pack.items.filter((item) => !item.degradedReason).length;

        return {
            ok: pack.items.length === 16 && readyCount >= 12,
            itemCount: pack.items.length,
            readyCount,
            degradedLabels: pack.items
                .filter((item) => item.degradedReason)
                .map((item) => item.label),
            promptLength: renderWritingPackagePrompt(pack).length,
        };
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * 跑一遍核心算法
 * @returns 结果摘要，主进程会把它写进日志
 */
export function runSelfTest(): SelfTestResult {
    const metrics = computeTextMetrics(SAMPLE_TEXT);
    const lexicon = runLexiconCheck(SAMPLE_TEXT);
    const baseline = computeBaseline([{ chapterId: '001', metrics }]);

    const report = buildChapterReport({
        chapterId: '001',
        title: '第一章',
        text: SAMPLE_TEXT,
        baseline,
        lexiconOptions: { properNouns: ['林胜', '田峰'] },
    });

    // 账本故意记一个和正文不一样的值，用来验证冲突检测
    const ledger: LedgerFile = {
        tree: { 林胜: { realm: '开八门第一门' } },
        history: [],
    };

    const marks = parseLedgerMarks(SAMPLE_TEXT);
    const conflicts = detectLedgerConflicts(SAMPLE_TEXT, ledger);

    const golden = diagnoseGoldenChapter(1, '第一章', SAMPLE_TEXT, 3000);

    // 八问只答一问，验证"没答完禁止生成大纲"
    const outlineState = answerQuestion(createOutlineState(), 'genre', '仙侠修真', false);
    const gate = canGenerateOutline(outlineState);
    const outlineMd = renderOutlineMarkdown(outlineState, '测试书');

    const pack = assembleWritingPackage({ hook: '一个悬念', characters: '林胜：短句，口头禅"哦"' });

    // 人设卡：渲染成 Markdown 再解析回来，字段不能丢
    const filledCard = {
        ...createCharacterCard('田峰'),
        identity: '井的看守人',
        personality: ['阴沉', '守诺'],
        flaw: '记仇',
        speech: {
            sentenceLength: 'short' as const,
            catchphrases: ['是吗'],
            forbiddenWords: ['你来了'],
            addressToProtagonist: ['小子'],
        },
        emotionBaseline: { normal: '沉默', triggers: ['被叫小名'] },
    };
    const parsedBack = parseCharacterMarkdown(renderCharacterMarkdown(filledCard));
    const characterRoundTrip =
        parsedBack !== null &&
        parsedBack.name === '田峰' &&
        parsedBack.speech.forbiddenWords.includes('你来了');

    // 台词提取：正文里田峰说了"你来了"，而人设卡把这句列进了语言禁区
    const tianfengLines = extractDialogueForCharacter(SAMPLE_TEXT, '田峰');
    const ooc = checkOoc(filledCard, tianfengLines);

    // 千人一腔：林胜在样例里几乎没有台词，和田峰应该不像
    const linshengLines = extractDialogueForCharacter(SAMPLE_TEXT, '林胜');
    const voice = compareVoices(
        { name: '林胜', lines: linshengLines },
        { name: '田峰', lines: tianfengLines },
    );

    // 伏笔：第 1 章埋、计划第 5 章回收，现在写到第 30 章，应该报计划超期
    const seeded = touchForeshadow(createForeshadow('井底的声音', 1, 5), 3);
    const foreshadowGap = 30 - lastTouchedChapter(seeded);
    const alerts = scanForeshadow({ items: [seeded] }, 30);

    // 账本 patch：中文主体名经过 encode/decode 后必须还能落到树上
    const patchedTree = applyPatch(
        { 林胜: { realm: '开八门第一门' } },
        {
            op: 'replace',
            path: buildLedgerPath('林胜', 'realm'),
            value: '开八门第三门',
            chapter: 4,
            at: new Date().toISOString(),
        },
    );

    // 版本 diff：两行没变、一行被替换、两行新增
    const diffStat = summarizeDiff(diffLines('第一段\n第二段\n第三段', '第一段\n第二段改\n第三段\n第四段'));
    const diffOk =
        diffStat.unchanged === 2 && diffStat.removed === 1 && diffStat.added === 2;

    // 导出格式：zip 签名、EPUB 的 mimetype 必须在最前面且不压缩、txt 去掉标记
    const exportMeta = { title: '测试书', genre: '都市', author: '' };
    const exportChapters = [
        {
            index: 1,
            title: '第一章 收徒',
            blocks: markdownToBlocks('# 第一章 收徒\n\n第一段**加粗**。\n\n第二段。'),
            markdown: '',
        },
    ];
    const docxBuffer = buildDocx(exportMeta, exportChapters);
    const epubBuffer = buildEpub(exportMeta, exportChapters);
    const plainText = buildPlainText(exportMeta, exportChapters);
    const epubHead = epubBuffer.subarray(0, 60).toString('utf8');

    const exportOk =
        docxBuffer.subarray(0, 4).toString('hex') === '504b0304' &&
        docxBuffer.includes('word/document.xml') &&
        epubHead.includes('mimetype') &&
        epubHead.includes('application/epub+zip') &&
        plainText.includes('第一段加粗。') &&
        !plainText.includes('**');

    // 榜单文本：三种常见复制格式都要能解析出书名和作者
    const parsedRanking = parseRankingText(
        '1 夜的命名术 会说话的肘子\n2、大奉打更人 | 卖报小郎君\n第3名\t诡秘之主\t爱潜水的乌贼',
    );
    const marketReportText = renderMarketReport({
        snapshots: [
            {
                platform: '起点',
                url: 'https://example.com',
                status: 'ok',
                entries: parsedRanking,
                fetchedAt: new Date().toISOString(),
            },
        ],
        generatedAt: new Date().toISOString(),
    });
    const marketOk =
        parsedRanking.length === 3 &&
        parsedRanking[0].title === '夜的命名术' &&
        parsedRanking[0].author === '会说话的肘子' &&
        parsedRanking[1].author === '卖报小郎君' &&
        parsedRanking[2].title === '诡秘之主' &&
        marketReportText.includes('事实观察') &&
        marketReportText.includes('夜的命名术');

    // 多类型工作区：小说保留体检，笔记走"文档"目录且关掉文风相关工具
    const novelFeature = getProjectFeatures('novel');
    const notesFeature = getProjectFeatures('notes');
    const untaggedFeature = getProjectFeatures(undefined);

    // frontmatter 往返：写进去再读出来，正文不能被污染
    const tagged = writeTags('# 会议记录\n\n讨论了三件事。', ['工作', '会议']);
    const parsedTagged = parseFrontMatter(tagged);
    const clearedTags = parseFrontMatter(writeTags(tagged, []));

    const workspaceOk =
        novelFeature.health === true &&
        novelFeature.contentDir === '正文' &&
        notesFeature.health === false &&
        notesFeature.ledger === false &&
        notesFeature.contentDir === '文档' &&
        // 老数据没有 kind 字段，必须按小说处理
        untaggedFeature.health === true &&
        parsedTagged.tags.length === 2 &&
        parsedTagged.tags.includes('工作') &&
        parsedTagged.body.includes('讨论了三件事') &&
        !parsedTagged.body.includes('---') &&
        clearedTags.tags.length === 0 &&
        clearedTags.body.includes('会议记录');

    // 对照预览：常用语法都要出正确标签，HTML 必须被转义
    const previewHtml = renderMarkdownToHtml(
        '# 标题\n\n**粗体**和*斜体*，还有 `code`。\n\n> 引用\n\n- 一\n- 二\n\n---\n',
    );
    const escapedHtml = renderMarkdownToHtml('<script>alert(1)</script>');
    // 技术文档要用的表格与代码块语言标签
    const tableHtml = renderMarkdownToHtml(
        '| 参数 | 类型 |\n|---|---|\n| level | number |\n| name | string |',
    );
    const codeHtml = renderMarkdownToHtml('```ts\nconst count = 1;\n```');
    const docBlocksOk =
        tableHtml.includes('<table>') &&
        tableHtml.includes('<th>参数</th>') &&
        tableHtml.includes('<td>level</td>') &&
        tableHtml.includes('<td>string</td>') &&
        codeHtml.includes('data-lang="ts"') &&
        codeHtml.includes('const count = 1;');

    const markdownOk =
        docBlocksOk &&
        previewHtml.includes('<h1>标题</h1>') &&
        previewHtml.includes('<strong>粗体</strong>') &&
        previewHtml.includes('<em>斜体</em>') &&
        previewHtml.includes('<code>code</code>') &&
        previewHtml.includes('<blockquote>引用</blockquote>') &&
        previewHtml.includes('<li>一</li>') &&
        previewHtml.includes('<hr/>') &&
        !escapedHtml.includes('<script>') &&
        escapedHtml.includes('&lt;script&gt;');

    // 作者指令必须真的进到系统提示里，且排在内置规则之后
    const basePrompt = '你是写作助手，遵守硬规则。';
    const mergedPrompt = composeSystemPrompt(basePrompt, '不要用形容词堆砌');
    const blankPrompt = composeSystemPrompt(basePrompt, '   ');
    const promptOk =
        mergedPrompt.startsWith(basePrompt) &&
        mergedPrompt.includes('不要用形容词堆砌') &&
        mergedPrompt.indexOf('不要用形容词堆砌') > basePrompt.length &&
        blankPrompt === basePrompt;

    // 剧情画布：序列化要带节点 id，AI 编造的 id 必须被丢弃
    const plotGraph = {
        nodes: [
            { ...createPlotNode('setup', 0, 0, 'n1'), title: '开端', summary: '主角登场' },
            { ...createPlotNode('climax', 300, 0, 'n2'), title: '高潮', summary: '摊牌' },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', kind: 'cause' as const, label: '因果推进' }],
        updatedAt: new Date().toISOString(),
    };
    const plotPrompt = serializePlotForPrompt(plotGraph);
    const diagnosis = parsePlotDiagnosis(
        '{"structureScore":70,"findings":[{"kind":"pacing","severity":"warn","nodeIds":["n1","n99"],"message":"节奏太快","suggestion":"中间加一场"}]}',
        ['n1', 'n2'],
    );
    const plotOk =
        plotPrompt.includes('[n1]') &&
        plotPrompt.includes('n1 → n2') &&
        diagnosis !== null &&
        diagnosis.structureScore === 70 &&
        // n99 不存在，必须被剔除，只留下 n1
        diagnosis.findings[0]?.nodeIds.length === 1 &&
        diagnosis.findings[0]?.nodeIds[0] === 'n1';

    // 导入分章：中文章节、阿拉伯数字章节、Markdown 标题都要认
    const importedChapters = splitChapters(
        ['第一章 开端', '正文一。', '', '第二章 转折', '正文二。', '', '第3章 高潮', '正文三。'].join('\n'),
        false,
    );
    const mdChapters = splitChapters('# 前言\n说明\n\n# 第二节\n内容', true);
    const importOk =
        importedChapters.length === 3 &&
        importedChapters[0].title === '第一章 开端' &&
        importedChapters[2].title === '第3章 高潮' &&
        importedChapters[2].content.includes('正文三') &&
        mdChapters.length === 2 &&
        mdChapters[0].title === '前言';

    // 段落切分：标准空行分段、一行一段、混合空白都要正确处理
    const blankLineBlocks = splitProseBlocks('第一段。\n\n第二段。\n\n\n第三段。');
    const singleLineBlocks = splitProseBlocks('第一段。\n第二段。\n第三段。');
    const blocksOk =
        blankLineBlocks.length === 3 &&
        blankLineBlocks[1] === '第二段。' &&
        singleLineBlocks.length === 3 &&
        singleLineBlocks[0] === '第一段。' &&
        splitProseBlocks('   \n\n  ').length === 0;

    return {
        charCount: metrics.charCount,
        lexiconScore: lexicon.score,
        hitCategories: lexicon.summaries.filter((item) => item.count > 0).map((item) => item.category),
        repeatHit: lexicon.summaries.some((item) => item.ruleId === 'repetition' && item.count > 0),
        rhythmHit: lexicon.summaries.some((item) => item.ruleId === 'rhythm' && item.count > 0),
        dialogueHit: lexicon.summaries.some((item) => item.ruleId === 'dialogue' && item.count > 0),
        metrics: {
            syntaxComplexity: metrics.syntaxComplexity,
            modifierDensity: metrics.modifierDensity,
            abstraction: metrics.abstraction,
            actionDensity: metrics.actionDensity,
            uncertainty: metrics.uncertainty,
            blankSpace: metrics.blankSpace,
            dialogueRatio: metrics.dialogueRatio,
        },
        baselineScore: report.baseline?.score ?? -1,
        ledgerMarks: marks.length,
        ledgerConflicts: conflicts.length,
        goldenScore: golden.score,
        outlineGateOk: gate.ok,
        outlineLength: outlineMd.length,
        packageDegraded: pack.degraded.length,
        characterRoundTrip,
        extractedLines: tianfengLines.length,
        oocHits: ooc.length,
        voiceSimilarity: voice.similarity,
        foreshadowAlerts: alerts.length,
        ledgerPatched: patchedTree['林胜']?.realm === '开八门第三门' && foreshadowGap === 27,
        diffOk,
        exportOk,
        exportSizes: {
            docx: docxBuffer.length,
            epub: epubBuffer.length,
            txt: Buffer.byteLength(plainText, 'utf8'),
        },
        marketOk,
        workspaceOk,
        markdownOk,
        promptOk,
        plotOk,
        importOk,
        importChapters: importedChapters.length,
        blocksOk,
    };
}
