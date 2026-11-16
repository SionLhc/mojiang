/**
 * 自检脚本
 * 只在 --smoke 时执行，用来确认核心算法在 Electron 主进程里真的跑得通。
 * 生产环境不会调用这个文件里的任何函数。
 */

import { rmSync } from 'fs';
import { join } from 'path';
import {
    activeHeadingIndex,
    answerQuestion,
    applyPatch,
    computeStreak,
    assembleWritingPackage,
    buildChapterReport,
    buildLedgerPath,
    canGenerateOutline,
    checkOoc,
    compareVoices,
    composeSystemPrompt,
    computeBaseline,
    createMindBoardNode,
    createPlotNode,
    autoArrangeMindBoard,
    layoutToMindBoard,
    mergeLayoutToMindBoard,
    mindBoardToOutline,
    chatRolePrompt,
    parseChatOptions,
    parseOutlineChapters,
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
    extractHeadings,
    getProjectFeatures,
    layoutFlow,
    layoutMindmap,
    parseFlow,
    parseMindmap,
    recordWritingDay,
    scanSensitiveWords,
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
import {
    createChapter,
    deleteChapter,
    listChapterRecycle,
    readChapter,
    restoreChapterRecycle,
    writeChapter,
    writeJsonFile,
    writeTextFile,
} from './services/content';
import { splitChapters } from './services/import';
import { buildDocx, buildEpub, buildPlainText, markdownToBlocks } from './services/export-format';
import { createBook } from './services/library';
import { buildWritingPackage } from './services/package-builder';
import { logError } from './services/logger';
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
    /** 大纲导航的标题提取与当前小节定位是否正常 */
    outlineNavOk: boolean;
    /** 码字统计的累加与连续天数是否正确 */
    statsOk: boolean;
    /** 敏感词扫描的命中定位是否正确 */
    sensitiveOk: boolean;
    /** 图表解析与自动布局是否正常 */
    diagramOk: boolean;
    /** 画板与文本源互转是否正常 */
    outlineOk: boolean;
    /** 画板增量同步是否只动变化部分 */
    mergeOk: boolean;
    /** AI 大纲能否切成章节（正文骨架 + 细纲） */
    outlineParseOk: boolean;
    /** AI 回复的选项块解析是否正常 */
    optionsOk: boolean;
    /** 章节回收站删除→列表→恢复往返是否正常 */
    recycleOk: boolean;
    /** AI 角色提示是否按项目类型分开 */
    roleOk: boolean;
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
 * 含章节回收站往返，需要读写文件所以是异步的
 * @returns 结果摘要，主进程会把它写进日志
 */
export async function runSelfTest(): Promise<SelfTestResult> {
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

    // 大纲导航：标题要按行号提取，代码块里的 # 注释不能算标题，当前小节要能定位
    const outlineText = [
        '# 全书',
        '正文一段。',
        '## 第一章 起',
        '```',
        '# 这是代码里的注释，不是标题',
        '```',
        '### 1.1 小节',
        '## 第二章 承',
    ].join('\n');
    const outlineItems = extractHeadings(outlineText);
    const outlineNavOk =
        outlineItems.length === 4 &&
        outlineItems[0].level === 1 &&
        outlineItems[0].text === '全书' &&
        outlineItems[1].line === 3 &&
        outlineItems[2].text === '1.1 小节' &&
        outlineItems[3].text === '第二章 承' &&
        activeHeadingIndex(outlineItems, 5) === 1 &&
        activeHeadingIndex(outlineItems, 1) === 0 &&
        activeHeadingIndex([], 3) === -1;

    // 新工具三件套：统计累加与连续天数、敏感词命中、图表解析布局
    const statsBase = { dailyGoal: 2000, days: {} };
    const statsAfter = recordWritingDay(recordWritingDay(statsBase, 500, 60), 300, 0);
    const todayKey = Object.keys(statsAfter.days)[0];
    const statsOk =
        statsAfter.days[todayKey].chars === 800 &&
        statsAfter.days[todayKey].seconds === 60 &&
        computeStreak({ [todayKey]: { chars: 100, seconds: 0 } }) === 1 &&
        computeStreak({}) === 0;

    const sensitiveHits = scanSensitiveWords('可以加微信聊，或者转账付款。\n这行干净。', [
        '加微信',
        '转账',
        '没有的词',
    ]);
    const sensitiveOk =
        sensitiveHits.length === 2 &&
        sensitiveHits[0].count + sensitiveHits[1].count === 2 &&
        sensitiveHits.some((hit) => hit.word === '加微信' && hit.lines[0].line === 1);

    const mindRoots = parseMindmap('- 根\n  - 子\n    - 孙\n  - 子二');
    const mindLayout = layoutMindmap(mindRoots);
    const flowGraph = parseFlow('(开始) -> 步骤[解析] : 走\n步骤[解析] -> 判断{行吗?}');
    const flowLayout = layoutFlow(flowGraph);
    const diagramOk =
        mindRoots.length === 1 &&
        mindRoots[0].children.length === 2 &&
        mindLayout.boxes.length === 4 &&
        mindLayout.boxes.every((box) => box.x >= 0 && box.y >= 0) &&
        flowGraph.nodes.length === 3 &&
        flowGraph.edges.length === 2 &&
        flowGraph.edges[0].label === '走' &&
        flowGraph.nodes.find((node) => node.id === '判断')?.shape === 'diamond' &&
        flowLayout.boxes.length === 3;

    // 导图铺导图画板：编号要续在已有节点后面（已有 b1 → 新节点从 b2 起），坐标随偏移避让
    const boardItems = layoutToMindBoard(
        mindLayout,
        [createMindBoardNode('已有节点', 0, 0, 0, 'b1')],
        { x: 320, y: 0 },
    );
    // 自动排版：树形展开后所有坐标非负，节点数不变
    const arranged = autoArrangeMindBoard({
        nodes: boardItems.nodes.map((node) => ({ ...node })),
        edges: boardItems.edges.map((edge) => ({ ...edge })),
        updatedAt: new Date().toISOString(),
    });
    const diagramBoardOk =
        boardItems.nodes.length === 4 &&
        boardItems.nodes[0].id === 'b2' &&
        boardItems.nodes.every((node) => node.x >= 320) &&
        boardItems.edges.length === 3 &&
        arranged.nodes.length === 4 &&
        arranged.nodes.every((node) => node.x >= 0 && node.y >= 0);

    // 画板 → 文本：导图出缩进列表、流程出边列表，孤立节点都不能丢
    const roundTripGraph = {
        nodes: [
            { id: 'b1', title: '根', depth: 0, x: 0, y: 0 },
            { id: 'b2', title: '子', depth: 1, x: 0, y: 0 },
            { id: 'b3', title: '孤', depth: 0, x: 0, y: 0 },
        ],
        edges: [{ id: 'e1', source: 'b1', target: 'b2', label: '是' }],
        updatedAt: '',
    };
    const boardOutlineText = mindBoardToOutline(roundTripGraph, 'mindmap');
    // 流程序列化的单行孤立项要能被 parseFlow 认回来
    const flowBack = parseFlow(mindBoardToOutline(roundTripGraph, 'flow'));
    const outlineOk =
        boardOutlineText === '- 根\n  - 子\n- 孤' &&
        flowBack.nodes.length === 3 &&
        flowBack.edges.length === 1 &&
        flowBack.edges[0].label === '是';

    // 增量同步：同名/同序配对保 id 保位置，新增进父旁，多余的删
    const mergedBoard = mergeLayoutToMindBoard(
        {
            nodes: [
                { id: 'b1', title: '根', depth: 0, x: 10, y: 10 },
                { id: 'b2', title: '旧的', depth: 1, x: 300, y: 40 },
            ],
            edges: [{ id: 'e1', source: 'b1', target: 'b2' }],
            updatedAt: '',
        },
        layoutMindmap(parseMindmap('- 根\n  - 改名了\n  - 新来的')),
    );
    const mergedRoot = mergedBoard.nodes.find((node) => node.title === '根');
    const renamed = mergedBoard.nodes.find((node) => node.title === '改名了');
    const added = mergedBoard.nodes.find((node) => node.title === '新来的');
    const mergeOk =
        mergedBoard.nodes.length === 3 &&
        // 同名节点：id 和坐标都不动
        mergedRoot?.id === 'b1' &&
        mergedRoot.x === 10 &&
        mergedRoot.y === 10 &&
        // 改名的按同父顺序配对上旧节点，位置原地不动
        renamed?.id === 'b2' &&
        renamed.x === 300 &&
        renamed.y === 40 &&
        // 真新增的落在父节点右边
        added !== undefined &&
        added.x === 330 &&
        // 连线按新结构重建，两条
        mergedBoard.edges.length === 2;

    // AI 回复的选项块：正文与选项分开，没有选项块时原样返回
    const optionParsed = parseChatOptions('正文在这里。\n\n【选项】\n1. 方案甲\n2. 方案乙');
    const noOptionParsed = parseChatOptions('只有正文，没有选项');

    // 大纲解析：AI 的「第X章」大纲要能切成章节，书名等杂项不能混进来
    const parsedOutline = parseOutlineChapters(
        '书名《测试》\n\n第一章 开端\n主角醒来。\n\n第二章 转折：他走了\n门开了。\n',
    );
    const outlineParseOk =
        parsedOutline.length === 2 &&
        // 标题只留冒号前，冒号后的剧情进 summary（进细纲要点）
        parsedOutline[0].title === '第一章 开端' &&
        parsedOutline[0].summary === '' &&
        parsedOutline[0].content === '主角醒来。' &&
        parsedOutline[1].title === '第二章 转折' &&
        parsedOutline[1].summary === '他走了' &&
        parsedOutline[1].content === '门开了。';
    const optionsOk =
        optionParsed.body === '正文在这里。' &&
        optionParsed.options.length === 2 &&
        optionParsed.options[0] === '方案甲' &&
        noOptionParsed.body === '只有正文，没有选项' &&
        noOptionParsed.options.length === 0;

    // AI 角色提示按项目类型分开：小说/文档/笔记各一套，选项块约定都保留
    const novelRole = chatRolePrompt('novel');
    const docsRole = chatRolePrompt('docs');
    const notesRole = chatRolePrompt('notes');
    const roleOk =
        novelRole.includes('网文') &&
        docsRole.includes('工作文档') &&
        notesRole.includes('笔记') &&
        novelRole !== docsRole &&
        novelRole !== notesRole &&
        docsRole !== notesRole &&
        [novelRole, docsRole, notesRole].every((prompt) => prompt.includes('【选项】'));

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

    // 章节回收站：删了能列出来，恢复后内容不丢、区归属正确；临时书用完即删
    const recycleBookName = '__selftest_recycle__';
    const recycleBookDir = join(getLibraryDir(), recycleBookName);
    rmSync(recycleBookDir, { recursive: true, force: true });
    let recycleOk = false;
    try {
        const recycleMeta = createBook({
            title: recycleBookName,
            genre: '测试',
            chapterWordTarget: 3000,
        });
        const created = await createChapter(recycleMeta.id, 'zhengwen', '回收站测试章');
        await writeChapter(recycleMeta.id, 'zhengwen', created.id, '这段内容删了要能捞回来', {
            autoSnapshot: false,
            keep: 0,
        });
        await deleteChapter(recycleMeta.id, 'zhengwen', created.id);
        const recycleList = await listChapterRecycle(recycleMeta.id);
        const restoredId = await restoreChapterRecycle(
            recycleMeta.id,
            recycleList[0]?.fileName ?? '',
        );
        const restoredText = await readChapter(recycleMeta.id, 'zhengwen', restoredId);
        // 小说项目章节文件名是编号（001），回收站标题和恢复 id 都对得上编号才算通过
        const fileBase = created.id.split('/').pop() ?? created.id;
        recycleOk =
            recycleList.length === 1 &&
            recycleList[0].title === fileBase &&
            recycleList[0].section === 'zhengwen' &&
            restoredId === created.id &&
            restoredText.includes('捞回来');
    } catch (error) {
        logError('回收站自检失败', error);
    } finally {
        rmSync(recycleBookDir, { recursive: true, force: true });
    }

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
        outlineNavOk,
        statsOk,
        sensitiveOk,
        diagramOk: diagramOk && diagramBoardOk,
        outlineOk,
        mergeOk,
        outlineParseOk,
        optionsOk,
        recycleOk,
        roleOk,
        promptOk,
        plotOk,
        importOk,
        importChapters: importedChapters.length,
        blocksOk,
    };
}
