/** Package-owned invariant companion for the graphify memory provider. @module @deepseek-ai/dsh-memory-graphify/invariant */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "memory-graphify-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/** Register this package's invariant companion. */
export declare const apply: (ctx: Context) => Promise<() => void>;
