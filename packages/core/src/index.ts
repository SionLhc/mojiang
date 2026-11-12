/**
 * @mojiang/core 统一出口
 * 这个包不依赖 Electron / Node，任何环境都能跑，方便以后做 CLI 或网页版。
 */

export * from './types';
export * from './text/segment';
export * from './text/metrics';
export * from './text/diff';
export * from './text/frontmatter';
export * from './text/markdown';
export * from './prompt';
export * from './project';
export * from './lexicon/word-lists';
export * from './lexicon/rules';
export * from './lexicon/detector';
export * from './baseline';
export * from './ledger';
export * from './foreshadow';
export * from './golden3';
export * from './outline8';
export * from './character';
export * from './writing-package';
export * from './chapter-report';
export * from './market';
