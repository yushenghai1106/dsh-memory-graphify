/** Package-owned invariant companion for the graphify memory provider. @module @deepseek-ai/dsh-memory-graphify/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'memory-graphify-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the provider registry rejects duplicate ids, and graphify owns the graph this provider reads. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-memory-graphify', install))
