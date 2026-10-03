#!/usr/bin/env node
/**
 * 构建 vendor/codemirror-sql.cjs：CodeMirror 6 + lang-sql + sql-formatter 单文件 bundle（esbuild JS API）。
 *
 * 模式与 scripts/build-mongodb.mjs 一致：esbuild bundle:true + platform:node（node 平台默认
 * format=cjs），产物为 CJS，供 client.js 运行时经 createRequire 以相对路径加载。
 * 差异点：CM6 分包（@codemirror/state|view|language|commands|autocomplete|lang-sql）与
 * sql-formatter 均为纯浏览器/纯 JS 代码，无 node 内置依赖，无需 external；入口代码以
 * esbuild stdin 内嵌（resolveDir 指向仓库根），不产生中间文件。
 *
 * 每次执行全量重建（esbuild 亚秒级），不做幂等跳过，避免"源升级产物旧"。
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'vendor', 'codemirror-sql.cjs');

/** bundle 所需 npm 包（均为 devDependencies 或其传递依赖），缺失则要求先 npm install */
const pkgs = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@codemirror/commands',
  '@codemirror/autocomplete',
  '@codemirror/lang-sql',
  '@lezer/highlight',
  'sql-formatter',
];
for (const pkg of pkgs) {
  if (!statSync(path.join(root, 'node_modules', pkg), { throwIfNoEntry: false })) {
    console.error(`[build-codemirror] 未找到 node_modules/${pkg} —— 请先 npm install`);
    process.exit(1);
  }
}

// 入口源码内嵌：String.raw 保证正则（\w 等）不被模板字符串转义吞掉。
const ENTRY = String.raw`
// CodeMirror 6 SQL 控制台编辑器入口（由 scripts/build-codemirror.mjs 内嵌打包）。
// 颜色一律 var(--dbt-*, 字面回退)，跟随 client.js .dbt-panel 作用域 token（含浅色 media 覆盖）。

import { Compartment } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion } from '@codemirror/autocomplete';
import { MySQL, PLSQL, PostgreSQL, SQLite, sql } from '@codemirror/lang-sql';
import { tags } from '@lezer/highlight';
import {
  formatDialect,
  mysql as fmtMysql,
  plsql as fmtPlsql,
  postgresql as fmtPostgresql,
  sqlite as fmtSqlite,
} from 'sql-formatter';

// kind → lang-sql 内置方言（官方清单）。gaussdb 按 PG 方言、oracle/dmdb 按 PL/SQL。
const SQL_DIALECTS = {
  mysql: MySQL,
  postgresql: PostgreSQL,
  gaussdb: PostgreSQL,
  sqlite: SQLite,
  oracle: PLSQL,
  dmdb: PLSQL,
};

// kind → sql-formatter 方言对象。mongodb/redis 无 SQL 方言，format 原文返回。
const FMT_DIALECTS = {
  mysql: fmtMysql,
  postgresql: fmtPostgresql,
  gaussdb: fmtPostgresql,
  sqlite: fmtSqlite,
  oracle: fmtPlsql,
  dmdb: fmtPlsql,
};

// redis 常见命令表（大写原样补全）
const REDIS_COMMANDS = [
  'APPEND', 'AUTH', 'BGREWRITEAOF', 'BGSAVE', 'CLIENT', 'CLUSTER', 'CONFIG', 'DBSIZE', 'DECR', 'DECRBY',
  'DEL', 'DISCARD', 'DUMP', 'ECHO', 'EVAL', 'EXISTS', 'EXPIRE', 'EXPIREAT', 'FLUSHALL', 'FLUSHDB',
  'GET', 'GETDEL', 'GETRANGE', 'GETSET', 'HDEL', 'HEXISTS', 'HGET', 'HGETALL', 'HINCRBY', 'HKEYS',
  'HLEN', 'HMGET', 'HMSET', 'HSCAN', 'HSET', 'HSETNX', 'HVALS', 'INCR', 'INCRBY', 'INFO',
  'KEYS', 'LINDEX', 'LLEN', 'LPOP', 'LPUSH', 'LRANGE', 'LREM', 'LSET', 'LTRIM', 'MGET',
  'MSET', 'MULTI', 'PERSIST', 'PEXPIRE', 'PING', 'PSETEX', 'PTTL', 'PUBLISH', 'RANDOMKEY', 'RENAME',
  'RPOP', 'RPUSH', 'SADD', 'SCAN', 'SCARD', 'SDIFF', 'SELECT', 'SET', 'SETBIT', 'SETEX',
  'SETNX', 'SETRANGE', 'SINTER', 'SISMEMBER', 'SMEMBERS', 'SPOP', 'SRANDMEMBER', 'SREM', 'SSCAN', 'STRLEN',
  'SUBSCRIBE', 'SUNION', 'TIME', 'TTL', 'TYPE', 'UNWATCH', 'WATCH', 'XADD', 'XLEN',
  'XRANGE', 'XREAD', 'ZADD', 'ZCARD', 'ZCOUNT', 'ZINCRBY', 'ZRANGE', 'ZRANK', 'ZREM', 'ZSCORE',
];
// mongodb 常见集合/库方法（小写驼峰原样补全）
const MONGODB_METHODS = [
  'aggregate', 'bulkWrite', 'countDocuments', 'createIndex', 'createCollection', 'deleteMany', 'deleteOne',
  'distinct', 'drop', 'dropIndex', 'dropIndexes', 'estimatedDocumentCount', 'explain', 'find', 'findAndModify',
  'findOne', 'findOneAndDelete', 'findOneAndReplace', 'findOneAndUpdate', 'getIndexes', 'getIndexSpecs',
  'getCollectionNames', 'getCollectionInfos', 'insertMany', 'insertOne', 'isCapped', 'mapReduce',
  'renameCollection', 'replaceOne', 'stats', 'updateMany', 'updateOne', 'watch', 'listDatabases', 'listCollections',
];

// 语法高亮：CM6 无稳定 CSS 类名，用 HighlightStyle 按语法 tag 上色，颜色走 --dbt-* token 带字面回退。
const sqlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--dbt-accent, #0a84ff)' },
  { tag: [tags.typeName, tags.bool, tags.null], color: 'var(--dbt-warning, #ffd60a)' },
  { tag: tags.number, color: 'var(--dbt-warning, #ffd60a)' },
  { tag: tags.string, color: 'var(--dbt-success, #30d158)' },
  { tag: tags.special(tags.string), color: 'var(--dbt-success, #30d158)' },
  { tag: tags.standard(tags.name), color: 'var(--dbt-danger, #ff453a)' },
  { tag: tags.special(tags.name), color: 'var(--dbt-danger, #ff453a)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--dbt-text-secondary, rgba(235,235,245,.6))', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--dbt-text-secondary, rgba(235,235,245,.6))' },
]);

// 编辑器主题：外壳配色全部 var(--dbt-*) 带字面回退；dark 标志仅影响 CM 内部兜底（可见色均已自定义）。
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--dbt-text, rgba(235,235,245,.92))',
    backgroundColor: 'var(--dbt-surface, rgba(120,120,128,.12))',
    border: '1px solid var(--dbt-separator, rgba(120,120,128,.24))',
    borderRadius: 'var(--dbt-radius-ctrl, 8px)',
    fontSize: '12px',
    fontFamily: 'var(--dbt-mono, ui-monospace, SF Mono, Menlo, Consolas, monospace)',
  },
  '&.cm-focused': { outline: '1px solid var(--dbt-accent, #0a84ff)', outlineOffset: '-1px' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--dbt-accent, #0a84ff)', padding: '8px 0' },
  '.cm-line': { padding: '0 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dbt-accent, #0a84ff)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--dbt-seg-active, rgba(255,255,255,.14)) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--dbt-surface-strong, rgba(120,120,128,.18))' },
  '.cm-tooltip': {
    backgroundColor: 'var(--dbt-dialog-bg, rgba(40,40,44,.85))',
    border: '1px solid var(--dbt-separator, rgba(120,120,128,.24))',
    borderRadius: 'var(--dbt-radius-ctrl, 8px)',
    fontFamily: 'var(--dbt-mono, ui-monospace, SF Mono, Menlo, Consolas, monospace)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--dbt-accent, #0a84ff)', color: '#fff' },
}, { dark: true });

// mongodb/redis：无 SQL 高亮的纯文本 + 关键字补全（redis 用命令表，mongo 用方法表）。
function nosqlCompletion(kind) {
  const options = (kind === 'redis' ? REDIS_COMMANDS : MONGODB_METHODS).map((label) => ({
    label,
    type: kind === 'redis' ? 'keyword' : 'method',
  }));
  return (context) => {
    const word = context.matchBefore(/[\w$.]+/);
    if (!word && !context.explicit) return null;
    return { from: word ? word.from : context.pos, options, validFor: /^[\w$.]*$/ };
  };
}

// 语言扩展整体构建（SQL：lang-sql 官方 API；mongodb/redis：纯文本 + 关键字补全 override）。
// schema 为 SQLNamespace（{ 表名: [列名,...] } 或 {self,children}），经 sql({dialect, schema}) 生效。
function languageExtension(kind, schema) {
  const dialect = SQL_DIALECTS[kind];
  if (dialect) {
    return [
      sql({ dialect, schema, upperCaseKeywords: true }),
      autocompletion(),
    ];
  }
  if (kind === 'mongodb' || kind === 'redis') {
    return [autocompletion({ override: [nosqlCompletion(kind)] })];
  }
  // 未知 kind：降级纯文本，不炸编辑器
  return [];
}

// 创建控制台编辑器。opts: { kind, schema?, onRunAll?, onRunSelection?, onChange? }
export function createConsoleEditor(container, opts = {}) {
  const kind = typeof opts.kind === 'string' ? opts.kind : 'mysql';
  if (!SQL_DIALECTS[kind] && kind !== 'mongodb' && kind !== 'redis') {
    console.warn('[codemirror-sql] 未知 kind: ' + kind + '，按纯文本处理');
  }
  const languageCompartment = new Compartment();

  // 自定义运行快捷键，必须插在 defaultKeymap 之前保证优先
  const runKeymap = [];
  if (typeof opts.onRunAll === 'function') {
    runKeymap.push({ key: 'Mod-Enter', run: () => { opts.onRunAll(); return true; } });
  }
  if (typeof opts.onRunSelection === 'function') {
    runKeymap.push({ key: 'Mod-Shift-Enter', run: () => { opts.onRunSelection(); return true; } });
  }

  container.classList.add('dbt-cm-root');
  const view = new EditorView({
    parent: container,
    extensions: [
      languageCompartment.of(languageExtension(kind, opts.schema)),
      keymap.of(runKeymap),
      history(),
      keymap.of(defaultKeymap),
      keymap.of(historyKeymap),
      drawSelection(),
      syntaxHighlighting(sqlHighlight),
      EditorView.lineWrapping,
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && typeof opts.onChange === 'function') {
          opts.onChange(update.state.doc.toString());
        }
      }),
    ],
  });

  return {
    view,
    destroy() {
      view.destroy();
    },
    // 换连接/换库后动态更新表列元数据：Compartment 挂 language 扩展整体重建
    setSchema(schema) {
      view.dispatch({ effects: languageCompartment.reconfigure(languageExtension(kind, schema)) });
    },
    setDoc(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text == null ? '' : text) } });
    },
    getDoc() {
      return view.state.doc.toString();
    },
    getSelection() {
      const main = view.state.selection.main;
      return view.state.sliceDoc(main.from, main.to);
    },
    // 格式化：sql-formatter formatDialect；mongodb/redis 原文返回；解析失败回退原文不抛错
    format() {
      const text = view.state.doc.toString();
      const fmtDialect = FMT_DIALECTS[kind];
      if (!fmtDialect) return text;
      try {
        const formatted = formatDialect(text, { dialect: fmtDialect, tabWidth: 2, keywordCase: 'upper' });
        if (formatted !== text) {
          view.dispatch({ changes: { from: 0, to: text.length, insert: formatted } });
        }
        return formatted;
      } catch {
        return text;
      }
    },
  };
}
`;

mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'codemirror-entry.js', loader: 'js' },
  outfile,
  bundle: true,
  platform: 'node', // node 平台默认 format=cjs，与 vendor/mongodb-driver.cjs 一致
  format: 'cjs',
  target: 'node20',
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'warning',
});

const size = statSync(outfile).size;
console.log(`[build-codemirror] wrote vendor/codemirror-sql.cjs (${(size / 1024 / 1024).toFixed(2)} MB)`);
console.log('[build-codemirror] done');
