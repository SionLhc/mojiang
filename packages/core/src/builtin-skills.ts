/**
 * 内置技能
 *
 * 首次启动时写到「技能」目录，作者可以看、可以改、可以禁用。
 * 校验规则刻意只留强信号（字数、禁用词、解释腔），避免误判导致多花钱重试。
 *
 * 模块归属的原则：技能指令里不写"小说"字样，凡是不依赖小说文体的技能就让它三个模块通用，
 * 文体差异交给各模块自己的系统提示去管。
 */

import type { Skill } from './skill';

/**
 * 取内置技能列表
 * 每次都返回新对象，调用方随便改不会污染模块级常量
 * @returns 内置技能
 */
export function builtinSkills(): Skill[] {
    return [
        {
            id: 'novel-continue',
            name: '续写正文',
            version: '1.1.0',
            author: '墨匠内置',
            description: '接着当前正文往下写，紧贴文风，只出正文',
            // 文档里"接着写下一节"同样成立，笔记一般不续写
            modules: ['novel', 'docs'],
            icon: '✍️',
            triggers: ['续写', '接着写', '往下写', '继续写'],
            prompt: [
                '任务：接着给定的正文往下写 800 字左右。',
                '要求：',
                '1. 句长、用词、标点习惯都要接得上上一段，不要突然变文风。',
                '2. 用动作、细节、对话推进，不要写心理总结，不要直接报情绪名。',
                '3. 只输出正文本身，不要标题、不要解释、不要"以下是"之类的开场。',
            ].join('\n'),
            rules: [
                '不替作者决定剧情走向，遇到关键选择停下来问',
                '不写章末总结升华',
                '不编造上下文里没有的设定和人物',
            ],
            checkers: [
                { type: 'minChars', value: 300, message: '续写太短，撑不起一段正文' },
                { type: 'noExplanation', message: '不能带解释性开场白或结尾客套话' },
                {
                    type: 'forbiddenWords',
                    value: ['本章完', '未完待续'],
                    message: '不要在正文里写章节结束语',
                },
            ],
            examples: [],
            enabled: true,
            builtin: true,
        },
        {
            id: 'novel-polish',
            name: '润色',
            version: '1.1.0',
            author: '墨匠内置',
            description: '保持原意润色选中段，只出改后正文',
            // 三个模块都要润色，只是文体门槛不同，由各模块系统提示去管
            modules: ['novel', 'docs', 'notes'],
            icon: '🪶',
            triggers: ['润色', '顺一下', '改得顺', '打磨'],
            prompt: [
                '任务：润色作者选中的这一段，保持原意、视角和文风。',
                '要求：',
                '1. 只改表达，不增删事实，不改专有名词、数字和编号。',
                '2. 拆长句、去重复用词、把空泛的形容词换成具体描述。',
                '3. 只输出改后的这一段文字本身，不要引号、不要解释、不要对比格式。',
            ].join('\n'),
            rules: ['不改事实和结论', '不改专有名词与数字', '改后字数和原文接近'],
            checkers: [
                { type: 'noExplanation', message: '只输出正文，不要任何解释' },
                {
                    type: 'forbiddenWords',
                    value: ['原文：', '改后：', '以下是'],
                    message: '不要输出对比格式',
                },
            ],
            examples: [
                {
                    input: '他缓缓地转过身，眼中闪过一丝不易察觉的慌乱，仿佛被什么东西吓到了。',
                    output: '他转过身，手在袖口停了一下，又缩回去。',
                },
            ],
            enabled: true,
            builtin: true,
        },
        {
            id: 'novel-deai',
            name: '去 AI 腔',
            version: '1.1.0',
            author: '墨匠内置',
            description: '专治"仿佛""不禁"和排比堆砌，改成人话',
            modules: ['novel', 'docs', 'notes'],
            icon: '🧹',
            triggers: ['AI 腔', 'AI腔', '机器味', '去AI'],
            prompt: [
                '任务：重写作者选中的这一段，把 AI 腔洗掉。',
                '要处理的典型症状：',
                '- "仿佛""似乎""不禁""缓缓""眼中闪过一丝"这类套话',
                '- 排比堆砌、四字成语连用、每句都是同样的长度',
                '- 用形容词概括感受，而不是写具体的东西和动作',
                '要求：句子长短交错、动词要实、多写具体的物和声音。只输出改后的正文。',
            ].join('\n'),
            rules: ['不改事实', '不堆形容词', '保留原段落的信息量'],
            checkers: [
                { type: 'noExplanation', message: '只输出正文' },
                {
                    type: 'forbiddenWords',
                    value: ['仿佛', '似乎', '不禁', '闪过一丝', '缓缓'],
                    message: '还有 AI 味套话没洗掉',
                },
            ],
            examples: [
                {
                    input: '随着科技的不断发展，我们不禁思考，这一切究竟意味着什么。',
                    output: '工具变得越来越便宜，人反而不值钱了。这件事没人愿意先说出口。',
                },
            ],
            enabled: true,
            builtin: true,
        },
        {
            id: 'novel-problems',
            name: '挑问题',
            version: '1.1.0',
            author: '墨匠内置',
            description: '查漏洞、重复和空话，分条列问题不改正文',
            modules: ['novel', 'docs', 'notes'],
            icon: '🔍',
            triggers: ['挑问题', '挑毛病', '检查一下', '看看有啥问题'],
            prompt: [
                '任务：检查作者选中的这段内容，分条列出问题，不要改正文。',
                '检查维度：事实/逻辑矛盾、前后不一致、重复表达、空话套话、结构顺序、信息缺口。',
                '每条写清楚"哪句有问题 + 为什么 + 怎么改"，没有问题的维度不要凑数。',
            ].join('\n'),
            rules: ['只列问题不改正文', '不硬凑问题数量', '指出问题时引用原句'],
            checkers: [{ type: 'noExplanation', message: '直接列问题，不要客套开场' }],
            examples: [],
            enabled: true,
            builtin: true,
        },
        {
            id: 'docs-report',
            name: '周报整理',
            version: '1.1.0',
            author: '墨匠内置',
            description: '把零散记录整理成周报：结论先行、分类清晰',
            // 笔记里记的一周流水账，最后也是要变周报的
            modules: ['docs', 'notes'],
            icon: '📋',
            triggers: ['周报', '写个周报', '整理成周报'],
            prompt: [
                '任务：把作者给的内容整理成一份周报。',
                '结构：本周结论（2-3 句）→ 分项进展（按项目/模块分）→ 风险与阻塞 → 下周计划。',
                '要求：结论先行，数字和版本号保持原样，不编造没提过的事项。',
            ].join('\n'),
            rules: ['不编造数据', '保留原文术语和编号', '用 Markdown 清单'],
            checkers: [
                { type: 'noExplanation', message: '直接输出周报正文' },
                { type: 'paragraphs', value: 3, message: '周报至少要分 3 个部分' },
            ],
            examples: [],
            enabled: true,
            builtin: true,
        },
        {
            id: 'notes-extract',
            name: '提炼要点',
            version: '1.1.0',
            author: '墨匠内置',
            description: '把大段内容提炼成要点清单 + 行动项',
            // 会议记录、访谈速记这类笔记，经常要落进文档
            modules: ['notes', 'docs'],
            icon: '📌',
            triggers: ['提炼', '总结要点', '提取要点'],
            prompt: [
                '任务：把作者的笔记提炼成两份清单。',
                '1. 要点：原文的核心信息，每条一行，不扩写。',
                '2. 行动项：原文里出现的待办，没有就写"无"。',
                '不添加原文没有的信息，不合并不同主题的条目。',
            ].join('\n'),
            rules: ['不扩写', '不丢原始信息', '行动项单独列'],
            checkers: [{ type: 'noExplanation', message: '直接输出清单' }],
            examples: [],
            enabled: true,
            builtin: true,
        },
    ];
}
