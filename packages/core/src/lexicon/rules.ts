/**
 * 12 类词库规则表
 * 每类规则都对应作者能听懂的一句话，界面上直接展示 category 和 message。
 * tolerancePerKilo 是"每千字容忍次数"，低于这个密度不报，避免把正常写作判成毛病。
 */

import type { Severity } from '../types';

export type RuleKind = 'phrase' | 'pattern' | 'repetition' | 'rhythm' | 'dialogue';

export interface LexiconRule {
    /** 规则唯一 id */
    id: string;
    /** 分类中文名 */
    category: string;
    kind: RuleKind;
    severity: Severity;
    /** 词表类规则的触发词 */
    words?: string[];
    /** 正则类规则的匹配式（不带斜杠） */
    patternSource?: string;
    patternFlags?: string;
    message: string;
    /** 替换建议，能覆盖整个命中片段时才有意义 */
    suggestion?: string;
    /** 每千字允许的次数，0 表示出现即报 */
    tolerancePerKilo?: number;
}

/** 12 类默认规则 */
export const DEFAULT_RULES: LexiconRule[] = [
    {
        id: 'cliche_tone',
        category: '措辞腔调',
        kind: 'phrase',
        severity: 'warn',
        words: ['顿时', '瞬间', '旋即', '猛地', '骤然', '陡然', '霎时', '一下子'],
        message: '这类"一瞬间"的词用多了会让节奏变假，试试换成具体动作',
        tolerancePerKilo: 1.2,
    },
    {
        id: 'cliche_psychology',
        category: '心理套话',
        kind: 'phrase',
        severity: 'warn',
        words: [
            '心中暗想', '心里想着', '脑海中浮现', '不由自主', '忍不住',
            '不禁', '暗暗想着', '心里一动', '心中一动', '心底泛起',
        ],
        message: '心理活动直接说出来最没劲，改成让读者从动作里看出来',
        tolerancePerKilo: 0.8,
    },
    {
        id: 'cliche_environment',
        category: '环境滥喻',
        kind: 'phrase',
        severity: 'info',
        words: ['宛如', '仿佛', '好似', '如同', '犹如', '像是'],
        message: '比喻词密集出现会稀释画面，同类比喻留一个就够',
        tolerancePerKilo: 2.0,
    },
    {
        id: 'connector',
        category: '连接词',
        kind: 'phrase',
        severity: 'info',
        words: ['然而', '而且', '此外', '与此同时', '因此', '总之', '于是', '紧接着'],
        message: '书面连接词在网文里显得端着，中文可以靠语序直接接',
        tolerancePerKilo: 2.5,
    },
    {
        id: 'summary_cliche',
        category: '总结升华',
        kind: 'phrase',
        severity: 'error',
        words: [
            '这一刻', '他终于明白', '不禁感叹', '不得不承认', '若有所思',
            '意味深长', '似懂非懂', '说不出的滋味', '五味杂陈',
        ],
        message: '章末总结升华是读者弃书高发区，把结论留给读者自己得',
        tolerancePerKilo: 0.6,
    },
    {
        id: 'sentence_template',
        category: '句式模板',
        kind: 'pattern',
        severity: 'warn',
        patternSource: '不是[^，。！？]{1,12}而是|与其说[^，。！？]{1,12}不如说|之所以[^，。！？]{1,18}是因为',
        patternFlags: 'g',
        message: '排比式说理句在小说里很出戏，改成人物直接说话',
        tolerancePerKilo: 0.8,
    },
    {
        id: 'emotion_direct',
        category: '情绪直述',
        kind: 'phrase',
        severity: 'warn',
        words: [
            '怒火中烧', '心中一喜', '心中一惊', '心中一沉', '内心充满',
            '脸上露出', '满脸震惊', '神色复杂', '心情复杂', '无比愤怒',
        ],
        message: '直接报情绪名是偷懒，写他做了什么、身体有什么反应',
        tolerancePerKilo: 1.0,
    },
    {
        id: 'rhythm',
        category: '节奏',
        kind: 'rhythm',
        severity: 'warn',
        message: '连续太多三五个字的短句会把段落打散，长句短句要咬着走',
        tolerancePerKilo: 0.5,
    },
    {
        id: 'repetition',
        category: '重复',
        kind: 'repetition',
        severity: 'warn',
        message: '同一串字反复出现会显得词穷（专有名词已豁免，情绪高点会降级）',
        tolerancePerKilo: 0.8,
    },
    {
        id: 'dialogue',
        category: '对话',
        kind: 'dialogue',
        severity: 'info',
        message: '对话行太长或引号没配平，读者会读串',
        tolerancePerKilo: 0.5,
    },
    {
        id: 'colloquial',
        category: '口语化',
        kind: 'phrase',
        severity: 'warn',
        words: [
            '绝了', '离谱', '破防', '社死', '绷不住', '秒懂',
            '真的会谢', '爷青回', '蚌埠住了', '笑不活了',
        ],
        message: '现代网络梗放进古代或异世界设定里会让人瞬间出戏',
        tolerancePerKilo: 0.2,
    },
    {
        id: 'punctuation_emotion',
        category: '标点情绪',
        kind: 'pattern',
        severity: 'warn',
        patternSource: '[！!]{2,}|[？?]{2,}|[。，]{4,}',
        patternFlags: 'g',
        message: '叠标点表达情绪是在替读者使劲，情绪靠内容推',
        tolerancePerKilo: 0.6,
    },
];
